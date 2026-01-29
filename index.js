import express from "express";
import axios from "axios";
import { google } from "googleapis";

const app = express();
app.use(express.json({ limit: "2mb" }));

// ===== ENV =====
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v24.0";

const SHEET_ID = process.env.SHEET_ID || "";
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";

// ===== Basic checks =====
if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
  console.log("⚠️ Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID");
}
if (!SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.log("⚠️ Missing SHEET_ID or GOOGLE_SERVICE_ACCOUNT_JSON (Sheets logging will not work)");
}

console.log("Callback URL: /webhook");
console.log("Graph version:", GRAPH_VERSION);

// ===== WhatsApp API =====
async function sendWhatsAppText(to, text) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

  try {
    const res = await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );
    return res.data;
  } catch (err) {
    const data = err?.response?.data;
    console.log("WHATSAPP SEND FAIL:", err?.response?.status || "?", data || err.message);
    throw err;
  }
}

// ===== Google Sheets =====
function parseServiceAccountJson(raw) {
  // Render env può mettere JSON su più righe o con \n: gestiamo entrambi.
  // 1) se arriva come JSON string con \\n, converto a \n
  // 2) se arriva con newline reali, va bene lo stesso
  const cleaned = raw.trim();

  // Se qualcuno incolla solo la chiave e non tutto il JSON -> stop
  if (!cleaned.startsWith("{")) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must be the full JSON object (starts with '{').");
  }

  const obj = JSON.parse(cleaned);

  if (obj.private_key && obj.private_key.includes("\\n")) {
    obj.private_key = obj.private_key.replace(/\\n/g, "\n");
  }

  return obj;
}

let sheetsClient = null;

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  if (!SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_JSON) return null;

  const creds = parseServiceAccountJson(GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({ version: "v4", auth });
  sheetsClient = sheets;
  return sheetsClient;
}

async function appendLeadRow(rowValues) {
  const sheets = await getSheetsClient();
  if (!sheets) {
    console.log("⚠️ Sheets client not configured, skipping append.");
    return;
  }

  // Scrive su Foglio1 dalla riga 2 in poi (header è già su riga 1)
  // Se il tuo foglio si chiama diverso, cambia "Foglio1" qui sotto.
  const range = "'Leads'!A:L";

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [rowValues]
      }
    });
    console.log("✅ Sheet append OK");
  } catch (err) {
    console.log("❌ SHEET APPEND FAIL:", err?.response?.data || err.message);
    throw err;
  }
}

// ===== Mini state machine (in-memory) =====
const sessions = new Map(); // key: wa_id -> session

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      step: "VEHICLE", // VEHICLE -> LOCATION -> ISSUE -> NAME -> DONE
      nome: "",
      veicolo: "",
      problema: "",
      citta: "",
      zona: ""
    });
  }
  return sessions.get(waId);
}

function normalizeText(t) {
  return (t || "").trim();
}

function detectVehicleChoice(text) {
  const t = text.toLowerCase();
  if (t === "1" || t.includes("bici")) return "Bici";
  if (t === "2" || t.includes("monopatt")) return "Monopattino";
  if (t === "3" || t.includes("altro")) return "Altro";
  return "";
}

function parseCityZone(text) {
  // Accetta:
  // - "Roma, Eur"
  // - "Roma Eur"
  // - "Roma - Eur"
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return { citta: "", zona: "" };

  let parts = t.split(",");
  if (parts.length >= 2) {
    return { citta: parts[0].trim(), zona: parts.slice(1).join(",").trim() };
  }

  parts = t.split("-");
  if (parts.length >= 2) {
    return { citta: parts[0].trim(), zona: parts.slice(1).join("-").trim() };
  }

  // fallback: prima parola città, resto zona (grezzo ma funziona)
  const words = t.split(" ");
  if (words.length === 1) return { citta: words[0], zona: "" };
  return { citta: words[0], zona: words.slice(1).join(" ") };
}

// ===== Webhook verify (GET) =====
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ===== Webhook receiver (POST) =====
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const messages = value?.messages;
    if (!messages || !messages.length) {
      return res.sendStatus(200);
    }

    const msg = messages[0];
    const from = msg.from; // wa_id
    const text = msg.text?.body ? normalizeText(msg.text.body) : "";

    console.log("INCOMING MESSAGE:", { from, text });

    const session = getSession(from);

    // ===== Flow =====
    if (session.step === "VEHICLE") {
      // Messaggio di benvenuto + scelta veicolo
      // Se l'utente ha già scritto 1/2/3 nel primo messaggio, lo prendo.
      const vehicle = detectVehicleChoice(text);

      if (!vehicle) {
        const welcome =
          "Ciao 👋 sono Martina di Assistenza Bici e Monopattini a Domicilio.\n" +
          "Per aiutarti subito, dimmi che veicolo hai:\n" +
          "1️⃣ Bici\n" +
          "2️⃣ Monopattino\n" +
          "3️⃣ Altro";
        await sendWhatsAppText(from, welcome);
        console.log("SENT OK:", { to: from });
        return res.sendStatus(200);
      }

      session.veicolo = vehicle;
      session.step = "LOCATION";

      await sendWhatsAppText(
        from,
        "Perfetto. Ora scrivimi *città e zona* (es: “Roma, Eur”).\nTi contatteremo telefonicamente appena possibile."
      );
      console.log("SENT OK:", { to: from });
      return res.sendStatus(200);
    }

    if (session.step === "LOCATION") {
      const { citta, zona } = parseCityZone(text);
      if (!citta) {
        await sendWhatsAppText(from, "Ok, ma mi serve *città e zona* (es: “Roma, Eur”).");
        console.log("SENT OK:", { to: from });
        return res.sendStatus(200);
      }

      session.citta = citta;
      session.zona = zona || "";
      session.step = "ISSUE";

      await sendWhatsAppText(
        from,
        "Chiaro. Dimmi in 1 riga *qual è il problema* (es: “gomma a terra”, “freno che fischia”, “batteria non carica”)."
      );
      console.log("SENT OK:", { to: from });
      return res.sendStatus(200);
    }

    if (session.step === "ISSUE") {
      if (text.length < 3) {
        await sendWhatsAppText(from, "Scrivimi una descrizione un po’ più chiara del problema 🙂");
        console.log("SENT OK:", { to: from });
        return res.sendStatus(200);
      }

      session.problema = text;
      session.step = "NAME";

      await sendWhatsAppText(from, "Ultima cosa: come ti chiami?");
      console.log("SENT OK:", { to: from });
      return res.sendStatus(200);
    }

    if (session.step === "NAME") {
      session.nome = text || "";

      // Append su Google Sheet
      const now = new Date().toISOString();
      const row = [
        now,               // Timestamp
        "WhatsApp",         // Canale
        session.nome,       // Nome
        from,               // TelefonoWhatsApp (wa_id)
        session.veicolo,    // Veicolo
        session.problema,   // Problema
        session.citta,      // Citta
        session.zona,       // Zona
        "NUOVO",            // Stato
        "",                 // Note
        "SI",               // Richiamare
        ""                  // AssegnatoA
      ];

      try {
        await appendLeadRow(row);
      } catch (e) {
        // Non blocco il bot: risponde comunque
        console.log("⚠️ Append failed, but continuing.");
      }

      await sendWhatsAppText(
        from,
        "Perfetto ✅ Ho preso la richiesta.\nTi contattiamo telefonicamente a breve."
      );
      console.log("SENT OK:", { to: from });

      session.step = "DONE";
      return res.sendStatus(200);
    }

    // DONE o stato sconosciuto -> reset soft
    sessions.delete(from);
    await sendWhatsAppText(
      from,
      "Ricominciamo ✅\nDimmi che veicolo hai:\n1️⃣ Bici\n2️⃣ Monopattino\n3️⃣ Altro"
    );
    console.log("SENT OK:", { to: from });
    return res.sendStatus(200);
  } catch (err) {
    console.log("Webhook handler error:", err?.response?.data || err.message);
    return res.sendStatus(200);
  }
});

// ===== Health =====
app.get("/", (req, res) => res.status(200).send("OK"));

// ===== Start =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

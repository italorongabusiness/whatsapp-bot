import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json({ verify: rawBodySaver }));

// ====== ENV (Render -> Environment) ======
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "CHANGE_ME";
const APP_SECRET = process.env.APP_SECRET || ""; // opzionale, ma consigliato
const WABA_TOKEN = process.env.WABA_TOKEN || ""; // token Cloud API
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || ""; // id numero

// ====== UTILS ======
function rawBodySaver(req, res, buf) {
  // salva raw body per verifica firma
  req.rawBody = buf?.toString("utf8") || "";
}

function verifySignature(req) {
  if (!APP_SECRET) return true; // se non hai APP_SECRET, salta verifica (solo test)
  const sig = req.get("x-hub-signature-256");
  if (!sig || !sig.startsWith("sha256=")) return false;

  const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function sendWhatsAppText(to, text) {
  if (!WABA_TOKEN || !PHONE_NUMBER_ID) {
    console.log("WABA_TOKEN o PHONE_NUMBER_ID mancanti: non invio nulla.");
    return { ok: false, reason: "missing_env" };
  }

  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WABA_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) console.log("Errore invio WhatsApp:", r.status, data);
  return { ok: r.ok, status: r.status, data };
}

// ====== ROUTES ======

// Root: evita "Forbidden" e ti dà una pagina/risposta OK
app.get("/", (req, res) => {
  res.status(200).send("OK - whatsapp-bot live");
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

// Webhook VERIFY (Meta fa GET per verificare)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("WEBHOOK VERIFY GET:", { mode, tokenPresent: !!token });

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificato ✅");
    return res.status(200).send(challenge);
  }
  console.log("Webhook verify fallito ❌");
  return res.sendStatus(403);
});

// Webhook EVENT (Meta manda POST con i messaggi)
app.post("/webhook", async (req, res) => {
  if (!verifySignature(req)) {
    console.log("Firma non valida ❌");
    return res.sendStatus(401);
  }

  // Meta vuole 200 veloce, poi fai logica
  res.sendStatus(200);

  try {
    const body = req.body;
    console.log("---- INCOMING WEBHOOK ----");
    console.log(JSON.stringify(body, null, 2));

    // Estrazione messaggi WhatsApp
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const messages = value?.messages || [];
    if (!messages.length) return;

    const msg = messages[0];
    const from = msg.from; // numero mittente
    const text = msg?.text?.body || "";

    // Risposta demo: se scrive "ciao" o qualsiasi testo
    if (from) {
      const reply = text
        ? `Ricevuto ✅\n\nHai scritto: "${text}"\n\nRispondi con:\n1) Bici\n2) Monopattino\n3) Batteria`
        : "Ricevuto ✅";

      await sendWhatsAppText(from, reply);
    }
  } catch (e) {
    console.log("Errore gestione webhook:", e?.message || e);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

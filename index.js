const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ verify: (req, res, buf) => (req.rawBody = buf) }));

// ENV richieste (mettile su Render -> Environment)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v24.0";

// Health check (evita "Forbidden" quando apri l'URL nel browser)
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

// Webhook verification (Meta chiama GET /webhook)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Webhook receiver (Meta manda eventi su POST /webhook)
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    // Meta richiede 200 veloce
    res.sendStatus(200);

    // Filtra eventi WhatsApp
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const messages = value?.messages;
    if (!messages || !messages.length) return;

    const msg = messages[0];
    const from = msg.from; // numero utente (wa_id)
    const text = msg.text?.body || "";

    console.log("INCOMING:", { from, text });

    // Risposta demo (echo + testo fisso)
    const replyText = text
      ? `Ricevuto: "${text}". Dimmi che problema hai con il veicolo.`
      : "Ciao! Dimmi che problema hai con il veicolo.";

    await sendWhatsAppText(from, replyText);
    console.log("REPLIED:", { to: from });
  } catch (err) {
    console.log("ERROR webhook:", err?.response?.data || err.message);
  }
});

// Funzione invio messaggio WhatsApp Cloud API
async function sendWhatsAppText(to, message) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.log("Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID");
    return;
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Callback URL: /webhook");
});

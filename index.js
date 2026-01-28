const express = require("express");

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;

// ENV richieste
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v24.0";

// 1) Healthcheck: elimina "Forbidden"
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

// 2) Webhook verify (Meta challenge)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Helper: invio messaggio WhatsApp (opzionale per test)
async function sendTextMessage(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.log("sendTextMessage error:", r.status, data);
  } else {
    console.log("sendTextMessage ok:", data);
  }
}

// 3) Webhook receive
app.post("/webhook", async (req, res) => {
  try {
    // Meta vuole risposta rapida 200
    res.sendStatus(200);

    const body = req.body;

    // Log compatto ma utile
    console.log("INCOMING:", JSON.stringify(body));

    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const messages = value?.messages;
    if (!messages || !messages.length) return;

    const msg = messages[0];
    const from = msg.from;
    const type = msg.type;

    // Rispondi solo a messaggi di testo (evita loop su status)
    if (type === "text" && from) {
      // Messaggio test “secco”
      await sendTextMessage(from, "Ciao, ho un problema con il mio veicolo.");
    }
  } catch (e) {
    console.log("webhook error:", e?.message || e);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

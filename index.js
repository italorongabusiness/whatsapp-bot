const express = require("express");

const app = express();
app.use(express.json({ limit: "2mb" }));

// ENV richieste
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v24.0"; // su Meta v24.0 va benissimo

const PORT = process.env.PORT || 3000;

// Healthcheck (così NON vedi più "Forbidden" se apri la URL)
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

// STEP A — Verifica webhook (Meta farà GET con hub.challenge)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("---- WEBHOOK VERIFY (GET /webhook) ----");
  console.log("mode:", mode);
  console.log("token match:", token === VERIFY_TOKEN);

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }

  console.log("❌ Webhook verification failed");
  return res.sendStatus(403);
});

// STEP B — Ricezione eventi (Meta farà POST)
app.post("/webhook", async (req, res) => {
  try {
    console.log("---- WEBHOOK EVENT (POST /webhook) ----");
    console.log(JSON.stringify(req.body, null, 2));

    // Rispondi subito 200 a Meta (importante)
    res.sendStatus(200);

    // Se vuoi: qui puoi estrarre i messaggi e rispondere.
    // Nota: in fase test spesso arrivano "statuses" o "messages".
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const messages = value?.messages;
    if (!messages || !messages.length) return;

    const msg = messages[0];
    const from = msg.from; // numero del contatto (wa_id)
    const text = msg.text?.body || "";

    console.log("📩 Incoming message from:", from, "text:", text);

    // Risposta semplice (solo se hai token e phone id)
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
      console.log("⚠️ Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID, skipping reply.");
      return;
    }

    // Esempio risposta
    const replyText = "Ciao, ho ricevuto il tuo messaggio ✅";

    await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: { body: replyText }
      })
    });

    console.log("✅ Reply sent");
  } catch (err) {
    console.log("❌ Error in webhook handler:", err?.message || err);
    // Se abbiamo già risposto 200 sopra, non possiamo rispondere ancora: ok così.
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Callback URL: /webhook`);
});

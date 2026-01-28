const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === "verify123") return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body?.toLowerCase() || "";

    let reply = "Ciao 👋 Sono l’assistente. Dimmi pure il problema.";
    if (text.includes("problema")) reply = "Perfetto. È una bici o un monopattino?";

    await fetch(`https://graph.facebook.com/v22.0/${PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: { body: reply }
      })
    });

    res.sendStatus(200);
  } catch {
    res.sendStatus(200);
  }
});

app.listen(3000);

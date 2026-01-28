// Compat layer: se finisci in ESM, evita il crash
let express;
try {
  // CommonJS
  express = require("express");
} catch (e) {
  // ESM fallback (Node 20+)
  const mod = await import("express");
  express = mod.default;
}

const app = express();
app.use(express.json({ limit: "2mb" }));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v24.0";
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => res.status(200).send("OK - WhatsApp bot is running"));

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    res.sendStatus(200);

    const body = req.body;
    if (!body || body.object !== "whatsapp_business_account") return;

    const value = body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return;

    const from = msg.from;
    const text = msg.text?.body || "";
    console.log("INCOMING MESSAGE:", { from, text });

    await sendWhatsAppText(from, "Ciao, ho un problema con il mio veicolo.");
    console.log("SENT OK:", { to: from });
  } catch (err) {
    console.error("WEBHOOK ERROR:", err?.message || err);
  }
});

async function sendWhatsAppText(to, message) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error("Missing env: WHATSAPP_TOKEN or PHONE_NUMBER_ID");
    return;
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    text: { body: message }
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await r.json();
  if (!r.ok) console.error("WHATSAPP SEND FAIL:", r.status, data);
  return data;
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Callback URL: /webhook`);
  console.log(`Graph version: ${GRAPH_VERSION}`);
});

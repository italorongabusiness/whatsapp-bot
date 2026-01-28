import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "testtoken";

/* =========================
   HEALTH CHECK (RENDER)
========================= */
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

app.head("/", (req, res) => {
  res.sendStatus(200);
});

/* =========================
   WEBHOOK VERIFICA (META)
========================= */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("WEBHOOK VERIFY:", mode, token);

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK VERIFIED");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/* =========================
   WEBHOOK EVENTI WHATSAPP
========================= */
app.post("/webhook", (req, res) => {
  console.log("---- INCOMING WEBHOOK ----");
  console.dir(req.body, { depth: null });

  res.sendStatus(200);
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

import express from "express";

const app = express();

// prende il RAW body (serve per debug e per firme in futuro)
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf?.toString("utf8") || "";
    },
  })
);

// logga QUALSIASI richiesta in ingresso (questa è la tua “scatola nera”)
app.use((req, res, next) => {
  console.log("---- INCOMING ----");
  console.log(new Date().toISOString());
  console.log(req.method, req.originalUrl);
  console.log("headers:", JSON.stringify(req.headers));
  if (req.rawBody) console.log("rawBody:", req.rawBody);
  next();
});

// health check
app.get("/", (req, res) => res.status(200).send("OK"));

// webhook verify (Meta)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "verify123";

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK VERIFIED");
    return res.status(200).send(challenge);
  }
  console.log("WEBHOOK VERIFY FAILED", { mode, token });
  return res.sendStatus(403);
});

// webhook events (Meta)
app.post("/webhook", (req, res) => {
  console.log("WEBHOOK EVENT BODY:", JSON.stringify(req.body));
  return res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

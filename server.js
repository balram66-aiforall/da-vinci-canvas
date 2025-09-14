// server.js
require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();

// --- Security & payload size limits ---
// app.use(helmet());

// app.use(helmet({
//   contentSecurityPolicy: false,
//   crossOriginEmbedderPolicy: false
// }));
// app.use(cors({
//   origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true, // set to your domain(s) in prod
//   credentials: true
// }));

app.use(cors({origin:true}))
app.use(express.json({ limit: "12mb" })); // allow base64 images

// --- Basic rate limiting (tune as you like) ---
app.use("/api/", rateLimit({
  windowMs: 60_000, // 1 minute
  max: 30,          // 30 requests/min per IP
  standardHeaders: true,
  legacyHeaders: false
}));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY env var.");
  process.exit(1);
}

// Model endpoint (same as your client used, but key stays server-side)
const MODEL_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`;

/**
 * POST /api/generate-image
 * Body:
 *  {
 *    "prompt": "string",               // required if no image
 *    "stylePrompt": "string",          // optional (your selectedPrePrompt)
 *    "image": {                        // optional
 *      "dataUrl": "data:image/png;base64,..."
 *      // or
 *      "mimeType": "image/png",
 *      "base64": "<raw base64>"
 *    }
 *  }
 */


// log every request
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// quick health check
app.get('/api/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));



app.get("/", (req, res) => {
  console.log("Serving index.html");
  res.sendFile(path.join(__dirname, "index.html"));
});


// You should see this when you open http://localhost:3000/
// Serve index.html and static assets from the project root
app.use(express.static(path.join(__dirname)));

app.post("/api/generate-image", async (req, res) => {
  try {
    const { prompt, stylePrompt, image } = req.body || {};

    if (!prompt && !image) {
      return res.status(400).json({ error: "Provide at least a prompt or an image." });
    }

    // Build Gemini "parts"
    const parts = [];
    const fullPrompt = [prompt, stylePrompt].filter(Boolean).join(", ");
    if (fullPrompt) parts.push({ text: fullPrompt });

    // Accept either dataUrl or explicit mimeType/base64
    if (image) {
      let mimeType, base64;

      if (image.dataUrl) {
        const m = image.dataUrl.match(/^data:(.+);base64,(.+)$/);
        if (m) {
          mimeType = m[1];
          base64 = m[2];
        }
      } else {
        mimeType = image.mimeType;
        base64 = image.base64;
      }

      // Soft guardrails on upload size (tune as needed)
      if (base64 && base64.length > 10_000_000) {
        return res.status(413).json({ error: "Image too large." });
      }

      if (mimeType && base64) {
        parts.push({ inlineData: { mimeType, data: base64 } });
      }
    }

    const payload = {
      contents: [{ parts }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
    };

    console.log("payload,",  payload)

    const upstream = await fetch(MODEL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await upstream.json();

    console.log(data, "data123")

    if (!upstream.ok) {
      // Forward upstream error details for debugging
      return res.status(upstream.status).json({
        error: "Gemini API error",
        details: data
      });
    }

    // Extract the first image
    const base64Out = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
    if (!base64Out) {
      return res.status(502).json({ error: "No image found in model response.", modelResponse: data });
    }

    // Send a simple, stable shape back to the client
    return res.json({
      mimeType: "image/png",        // Gemini usually returns PNG for images
      imageBase64: base64Out,
      // If you want the text part too, you can surface it:
      text: data?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text ?? null
    });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server failed to generate image." });
  }
});




// // Optional explicit route (not strictly needed because of the static above)
// app.get("/", (req, res) => {
//   res.sendFile(path.join(__dirname, "index.html"));
// });
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));

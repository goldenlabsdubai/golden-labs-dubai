/**
 * Minimal Groq checks in **one process** after loading `backend/.env`:
 * 1) GET /openai/v1/models
 * 2) POST /openai/v1/chat/completions via **node https** (same transport as production support chat; avoids undici fetch POST auth bugs)
 * Uses `src/utils/supportAiKey.js` for the same normalization as the Express route.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env"), override: true });

const { getSupportAiApiKey } = await import("../src/utils/supportAiKey.js");

const key = getSupportAiApiKey();
const base = (process.env.SUPPORT_AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const model = (process.env.SUPPORT_AI_MODEL || "llama-3.1-8b-instant").trim();

if (!key) {
  console.error("SUPPORT_AI_API_KEY is empty after normalization.");
  process.exit(1);
}

const modelsUrl = `${base}/models`;
const r = await fetch(modelsUrl, { headers: { Authorization: `Bearer ${key}` } });
const text = await r.text();
let j;
try {
  j = JSON.parse(text);
} catch {
  j = { raw: text.slice(0, 200) };
}

console.log("GET", modelsUrl);
console.log("HTTP", r.status);
if (!r.ok) {
  console.log("Groq response:", j.error || j.message || j);
  process.exit(1);
}
const n = Array.isArray(j.data) ? j.data.length : "?";
console.log("OK — models count:", n);

const chatBody = {
  model,
  messages: [{ role: "user", content: "Reply with exactly: OK" }],
  max_tokens: 16,
  temperature: 0,
};
const chatUrl = `${base}/chat/completions`;
const { postHttpsJson } = await import("../src/utils/postHttpsJson.js");
const cr = await postHttpsJson(
  chatUrl,
  { Authorization: `Bearer ${key}` },
  chatBody,
  30000
);
const ctext = cr.text;
let cj;
try {
  cj = JSON.parse(ctext);
} catch {
  cj = { raw: ctext.slice(0, 200) };
}
console.log("POST", chatUrl, "(minimal chat, node https)");
const status = cr.statusCode;
console.log("HTTP", status);
if (status < 200 || status >= 300) {
  console.log("Chat error:", cj.error || cj.message || cj);
  console.log("\nIf this persists, open a ticket with Groq or switch SUPPORT_AI_BASE_URL to another OpenAI-compatible provider.");
  process.exit(1);
}
const reply = cj?.choices?.[0]?.message?.content?.trim();
console.log("OK — chat reply:", reply || "(empty)");

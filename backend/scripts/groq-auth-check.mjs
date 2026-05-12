/**
 * Minimal Groq checks in **one process** after loading `backend/.env`:
 * 1) GET /openai/v1/models
 * 2) POST /openai/v1/chat/completions (tiny body)
 *
 * If (1) is 200 but (2) is 401, the key works for listing but not chat (rare — contact Groq / new key).
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
const cr = await fetch(chatUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  },
  body: JSON.stringify(chatBody),
});
const ctext = await cr.text();
let cj;
try {
  cj = JSON.parse(ctext);
} catch {
  cj = { raw: ctext.slice(0, 200) };
}
console.log("POST", chatUrl, "(minimal chat)");
console.log("HTTP", cr.status);
if (!cr.ok) {
  console.log("Chat error:", cj.error || cj.message || cj);
  console.log("\nModels work but chat returns an error — key or account may lack inference; try a new key at https://console.groq.com/keys");
  process.exit(1);
}
const reply = cj?.choices?.[0]?.message?.content?.trim();
console.log("OK — chat reply:", reply || "(empty)");

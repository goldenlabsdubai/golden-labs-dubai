/**
 * Minimal Groq check: GET /openai/v1/models (same auth as chat).
 * Uses backend/.env next to this package (same path logic as app.js).
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env"), override: true });

const key = (process.env.SUPPORT_AI_API_KEY || "").trim();
const base = (process.env.SUPPORT_AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");

if (!key) {
  console.error("SUPPORT_AI_API_KEY is empty.");
  process.exit(1);
}

const url = `${base}/models`;
const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
const text = await r.text();
let j;
try {
  j = JSON.parse(text);
} catch {
  j = { raw: text.slice(0, 200) };
}

console.log("GET", url);
console.log("HTTP", r.status);
if (r.ok) {
  const n = Array.isArray(j.data) ? j.data.length : "?";
  console.log("OK — key accepted by Groq. models count:", n);
  process.exit(0);
}

console.log("Groq response:", j.error || j.message || j);
console.log("\n401 here means this exact key is invalid/revoked for Groq (not an app routing issue).");
console.log("Fix: https://console.groq.com/keys → create new key → one line in .env → no quotes/spaces → UTF-8 file → pm2 restart backend");
process.exit(1);

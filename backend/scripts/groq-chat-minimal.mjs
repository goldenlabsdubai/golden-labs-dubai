/**
 * Minimal POST /chat/completions — same auth style as groq-auth-check.
 * If this is 401 but groq-auth-check is 200, open an issue with Groq; if this is 200, the full test payload is the problem.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env"), override: true });

const key = (process.env.SUPPORT_AI_API_KEY || "").trim();
const base = (process.env.SUPPORT_AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const model = (process.env.SUPPORT_AI_MODEL || "llama-3.1-8b-instant").trim();

const r = await fetch(`${base}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "Say OK in one word." }],
    max_tokens: 32,
  }),
});
const data = await r.json().catch(() => ({}));
console.log("POST", `${base}/chat/completions`, "HTTP", r.status);
console.log(data?.error || data?.choices?.[0]?.message?.content || JSON.stringify(data).slice(0, 200));
process.exit(r.ok ? 0 : 1);

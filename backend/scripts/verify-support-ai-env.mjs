/**
 * Shows what Node sees for Groq env (masked) and cwd — use when PM2/npm disagree on SUPPORT_AI_API_KEY.
 * Does not print the full API key.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "..", ".env");

console.log("process.cwd() =", process.cwd());
console.log(".env path     =", envPath);

const r = dotenv.config({ path: envPath, override: true });
if (r.error && r.error.code !== "ENOENT") {
  console.warn("dotenv:", r.error.message);
}

const { getSupportAiApiKey } = await import("../src/utils/supportAiKey.js");
const k = getSupportAiApiKey();
const base = (process.env.SUPPORT_AI_BASE_URL || "").trim();
console.log("SUPPORT_AI_BASE_URL =", base || "(default groq)");
console.log(
  "SUPPORT_AI_API_KEY    =",
  k
    ? `len=${k.length} prefix=${k.slice(0, 7)}… suffix=…${k.slice(-4)} startsWith_gsk_=${k.startsWith("gsk_")}`
    : "(empty / missing)"
);

console.log("If len=0 here but `cat .env` shows a key, PM2 cwd was wrong (fixed in app.js) or you're not in backend/.");
console.log("Run `npm run groq-auth-check` — GET 200 + minimal chat 200 means the key is fine for support chat.");
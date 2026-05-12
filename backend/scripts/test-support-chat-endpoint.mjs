/**
 * POSTs to your **deployed** support chat URL (same path the web app uses).
 * Does not use SUPPORT_AI_API_KEY from .env — exercises nginx + Express + whatever Groq key the **server** has.
 *
 * Usage:
 *   npm run test-support-chat-url
 *   SUPPORT_CHAT_TEST_URL=https://api.goldenlabs.finance/api/public/support/chat npm run test-support-chat-url
 */
const url =
  (process.env.SUPPORT_CHAT_TEST_URL || "https://api.goldenlabs.finance/api/public/support/chat").trim();

const body = JSON.stringify({ message: process.env.SUPPORT_CHAT_TEST_MESSAGE || "hi" });

const r = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body,
});

const text = await r.text();
let data = {};
try {
  data = JSON.parse(text);
} catch {
  console.error("Non-JSON response", r.status, text.slice(0, 500));
  process.exit(1);
}

console.log("POST", url);
console.log("HTTP", r.status);
console.log("configured", data.configured, "fallback", data.fallback);
if (data.model) console.log("model", data.model);
if (typeof data.reply === "string") {
  console.log("reply preview:", data.reply.replace(/\n/g, " ").slice(0, 280) + (data.reply.length > 280 ? "…" : ""));
}
if (data.error) console.log("error", data.error);
if (data.debug) console.log("debug", JSON.stringify(data.debug));

if (!r.ok) process.exit(1);
if (data.fallback) {
  console.log("\nNote: fallback=true means Groq failed on the **server**; fix SUPPORT_AI_API_KEY there and pm2 restart.");
  process.exit(2);
}

/**
 * POSTs to the public support chat URL (same as the web app default).
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
console.log("configured", data.configured);
if (typeof data.reply === "string") {
  console.log("reply preview:", data.reply.replace(/\n/g, " ").slice(0, 280) + (data.reply.length > 280 ? "…" : ""));
}
if (data.error) console.log("error", data.error);

if (!r.ok) process.exit(1);
if (!(typeof data.reply === "string" && data.reply.trim())) {
  console.error("Missing reply in JSON");
  process.exit(1);
}

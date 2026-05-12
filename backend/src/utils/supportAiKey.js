/**
 * Groq / OpenAI-compatible API key from env (trim, optional Bearer / quotes).
 */
export function getSupportAiApiKey() {
  const raw = process.env.SUPPORT_AI_API_KEY;
  if (raw == null || typeof raw !== "string") return "";
  let s = raw.trim();
  s = s.replace(/^Bearer\s+/i, "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

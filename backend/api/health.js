/**
 * Lightweight health check for Vercel – no Express/Firebase load, so it responds fast (avoids cold-start timeout).
 */
export const config = { maxDuration: 10 };

export default function handler(_req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true });
}

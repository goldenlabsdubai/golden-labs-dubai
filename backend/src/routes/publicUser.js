import { Router } from "express";
import * as User from "../services/userFirestore.js";

const router = Router();

export function avatarToAbsoluteUrl(avatar) {
  if (!avatar || typeof avatar !== "string") return null;
  const trimmed = avatar.trim();
  if (!trimmed) return null;
  const base = (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`).trim();
  const baseUrl = base.replace(/\/$/, "");
  // Rewrite stored localhost URLs so they work when backend is deployed (EC2, Vercel, etc.)
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const u = new URL(trimmed);
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
        const pathPart = u.pathname + u.search;
        return `${baseUrl}${pathPart}`;
      }
      return trimmed;
    } catch {
      return trimmed;
    }
  }
  return `${baseUrl}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

/** Public profile by username – no auth. Returns limited fields. */
router.get("/:username", async (req, res) => {
  try {
    const username = (req.params.username || "").trim().toLowerCase();
    if (!username) return res.status(400).json({ error: "Username required" });
    const user = await User.findUserByUsername(username);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({
      username: user.username,
      name: user.name,
      avatar: avatarToAbsoluteUrl(user.avatar) ?? user.avatar,
      xUrl: user.xUrl ?? null,
      telegramUrl: user.telegramUrl ?? null,
      totalTrades: user.totalTrades ?? 0,
      createdAt: user.createdAt ?? null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

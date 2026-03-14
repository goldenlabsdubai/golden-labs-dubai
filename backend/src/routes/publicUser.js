import { Router } from "express";
import * as User from "../services/user.js";

const router = Router();

export function avatarToAbsoluteUrl(avatar) {
  if (!avatar || typeof avatar !== "string") return null;
  const trimmed = avatar.trim();
  if (!trimmed) return null;
  const base = (process.env.BACKEND_URL || "").trim();
  if (!base) return trimmed.startsWith("http") ? trimmed : `/${trimmed.replace(/^\//, "")}`;
  const baseUrl = (base.startsWith("http://") || base.startsWith("https://") ? base : `http://${base}`).replace(/\/$/, "");
  // Rewrite stored localhost or server-IP avatar URLs so HTTPS frontend can load (fix mixed content)
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const u = new URL(trimmed);
      const pathPart = (u.pathname + u.search).replace(/\/\/+/g, "/");
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || pathPart.includes("/uploads/avatars/")) {
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

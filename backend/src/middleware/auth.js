import jwt from "jsonwebtoken";
import * as User from "../services/user.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.wallet) req.wallet = payload.wallet;
    if (payload.firebaseUid) req.firebaseUid = payload.firebaseUid;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/** Optional auth: never 401; sets req.wallet when valid token present. Use for public endpoints (e.g. listings). */
export function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.wallet) req.wallet = payload.wallet;
    if (payload.firebaseUid) req.firebaseUid = payload.firebaseUid;
  } catch (_) {}
  next();
}

export async function requireProfile(req, res, next) {
  try {
    const user = await User.getUser(req);
    if (!user) return res.status(401).json({ error: "User not found" });
    if (!user.username) return res.status(403).json({ error: "Profile required", redirect: "profile" });
    req.user = user;
    req.wallet = user.wallet;
    next();
  } catch (e) {
    next(e);
  }
}

export async function requireSubscription(req, res, next) {
  try {
    const user = await User.getUser(req);
    if (!user) return res.status(401).json({ error: "User not found" });
    if (!["SUBSCRIBED", "MINTED", "ACTIVE_TRADER"].includes(user.state)) {
      return res.status(403).json({ error: "Subscription required", redirect: "subscription" });
    }
    req.user = user;
    req.wallet = user.wallet;
    next();
  } catch (e) {
    next(e);
  }
}

export async function requireMinted(req, res, next) {
  try {
    const user = await User.getUser(req);
    if (!user) return res.status(401).json({ error: "User not found" });
    if (!["MINTED", "ACTIVE_TRADER"].includes(user.state)) {
      return res.status(403).json({ error: "NFT mint required", redirect: "mint" });
    }
    req.user = user;
    req.wallet = user.wallet;
    next();
  } catch (e) {
    next(e);
  }
}

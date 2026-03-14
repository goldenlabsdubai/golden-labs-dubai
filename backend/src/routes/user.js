import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import * as User from "../services/user.js";
import { updateAuthUser } from "../config/firebase.js";
import { getOnChainUserStatus } from "../services/onChainUser.js";
import { syncReferrerToChain } from "../services/referralContractSync.js";
import { isAdminWallet, isConfiguredBotWallet } from "../services/botService.js";

const router = Router();

/** Turn avatar path from Firestore into absolute URL so frontend can load from backend. Rewrites stored localhost URLs for deployed backend. Set BACKEND_URL in .env. */
function avatarToAbsoluteUrl(avatar) {
  if (!avatar || typeof avatar !== "string") return null;
  const trimmed = avatar.trim();
  if (!trimmed) return null;
  const base = (process.env.BACKEND_URL || "").trim();
  if (!base) return trimmed.startsWith("http") ? trimmed : `/${trimmed.replace(/^\//, "")}`;
  let baseUrl = base.startsWith("http://") || base.startsWith("https://") ? base : `http://${base}`;
  baseUrl = baseUrl.replace(/\/$/, "");
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

/** Same shape as GET /me – used for profile response so frontend has full user from backend/Firestore. */
function toMeResponse(user) {
  if (!user) return null;
  return {
    wallet: user.wallet,
    email: user.email,
    username: user.username,
    state: user.state,
    name: user.name,
    bio: user.bio,
    avatar: avatarToAbsoluteUrl(user.avatar) ?? user.avatar,
    websiteUrl: user.websiteUrl,
    xUrl: user.xUrl,
    telegramUrl: user.telegramUrl,
    totalTrades: user.totalTrades,
    referrer: user.referrer,
    referrerUsername: user.referrerUsername ?? null,
    referralCountL1: user.referralCountL1 ?? 0,
    referralCountL2: user.referralCountL2 ?? 0,
    referralCountL3: user.referralCountL3 ?? 0,
    referralCountL4: user.referralCountL4 ?? 0,
    referralCountL5: user.referralCountL5 ?? 0,
    totalReferrals: user.totalReferrals ?? 0,
    referralEarningsL1: user.referralEarningsL1 ?? "0",
    referralEarningsL2: user.referralEarningsL2 ?? "0",
    referralEarningsL3: user.referralEarningsL3 ?? "0",
    referralEarningsL4: user.referralEarningsL4 ?? "0",
    referralEarningsL5: user.referralEarningsL5 ?? "0",
    referralEarningsTotal: user.referralEarningsTotal ?? "0",
    createdAt: user.createdAt,
  };
}

const AVATAR_MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png"];

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "avatars");

/** If avatar is our uploads/avatars path, delete that file from disk. No-op if not our path or file missing. */
function deleteOldAvatarFile(avatarUrl) {
  if (!avatarUrl || typeof avatarUrl !== "string") return;
  const trimmed = avatarUrl.trim();
  const match = trimmed.match(/\/uploads\/avatars\/([^/?#]+)$/);
  if (!match) return;
  const filename = match[1];
  if (!filename || filename.includes("..")) return;
  const filePath = path.join(UPLOADS_DIR, filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.warn("Could not delete old avatar file:", filePath, e?.message);
  }
}

const uploadAvatar = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      cb(null, UPLOADS_DIR);
    },
    filename: (_, file, cb) => {
      const ext = file.mimetype === "image/png" ? "png" : "jpg";
      const name = `avatar_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: AVATAR_MAX_SIZE },
  fileFilter: (_, file, cb) => {
    if (file && ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, JPG or PNG images allowed (max 2MB)"));
  },
}).single("avatar");

router.get("/activity", async (req, res) => {
  try {
    const user = await User.getUser(req);
    if (!user) return res.status(404).json({ error: "User not found" });
    const wallet = (user.wallet || req.wallet || "").toLowerCase();
    if (!wallet) return res.status(400).json({ error: "Wallet required" });
    const since = req.query.since != null ? req.query.since : null;
    if (since !== null && since !== "") {
      const { activities } = await User.getActivitiesSince(wallet, since, 10);
      return res.json({ activities, total: null });
    }
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 10), 20);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const { activities, total } = await User.getActivities(wallet, limit, offset);
    res.json({ activities, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/me", async (req, res) => {
  try {
    let user = await User.getUser(req);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Use connected wallet for on-chain check when frontend sends it and it matches signed-in user
    const userWallet = (user.wallet || req.wallet || "").toLowerCase();
    const connectedWalletHeader = (req.headers["x-connected-wallet"] || "").trim().toLowerCase();
    const walletForChain =
      connectedWalletHeader && connectedWalletHeader === userWallet && connectedWalletHeader.startsWith("0x")
        ? connectedWalletHeader
        : userWallet;

    const wallet = userWallet;
    if (wallet) {
      const walletIsBot = isConfiguredBotWallet(wallet);
      // Status is always read on-chain from Subscription contract using (connected) wallet address
      const { hasSubscribed, isSuspended, hasMinted, buyCount, subscriptionKnown, mintKnown } =
        await getOnChainUserStatus(walletForChain);
      const updates = {};
      const early = ["CONNECTED", "REGISTERED", "PROFILE_SET"];
      const later = ["SUBSCRIBED", "MINTED", "ACTIVE_TRADER", "SUSPENDED"];
      // Avoid false route/state flicker when RPC is temporarily unavailable.
      if (!walletIsBot && subscriptionKnown) {
        if (!hasSubscribed) {
          // On-chain: not subscribed → downgrade so UI shows correct step (profile then subscription)
          if (later.includes(user.state)) updates.state = user.username ? "PROFILE_SET" : "REGISTERED";
        } else if (isSuspended) {
          updates.state = "SUSPENDED";
        } else {
          if (early.includes(user.state)) updates.state = "SUBSCRIBED";
          if (
            mintKnown &&
            hasMinted &&
            (early.includes(user.state) || user.state === "SUBSCRIBED" || user.state === "SUSPENDED")
          ) {
            updates.state = "MINTED";
          }
        }
      }
      if (walletIsBot && user.username) {
        updates.state = "ACTIVE_TRADER";
      }
      const currentTrades = user.totalTrades ?? 0;
      const maxTrades = Math.max(buyCount, currentTrades);
      if (maxTrades > currentTrades) updates.totalTrades = maxTrades;
      if (Object.keys(updates).length > 0) {
        updates.lastActivity = new Date();
        await User.updateUser(user.id, updates);
        user = await User.getUser(req);
      }
      const walletUser = await User.getUserByWallet(wallet);
      if (walletUser) {
        user = {
          ...user,
          referralEarningsL1: walletUser.referralEarningsL1 ?? "0",
          referralEarningsL2: walletUser.referralEarningsL2 ?? "0",
          referralEarningsL3: walletUser.referralEarningsL3 ?? "0",
          referralEarningsL4: walletUser.referralEarningsL4 ?? "0",
          referralEarningsL5: walletUser.referralEarningsL5 ?? "0",
          referralEarningsTotal: walletUser.referralEarningsTotal ?? "0",
          referralCountL1: walletUser.referralCountL1 ?? 0,
          referralCountL2: walletUser.referralCountL2 ?? 0,
          referralCountL3: walletUser.referralCountL3 ?? 0,
          referralCountL4: walletUser.referralCountL4 ?? 0,
          referralCountL5: walletUser.referralCountL5 ?? 0,
          totalReferrals: walletUser.totalReferrals ?? 0,
        };
      }
    }

    let userForResponse = user;
    if (user.referrer) {
      const referrerUser = await User.getUserByWallet(user.referrer);
      userForResponse = { ...user, referrerUsername: referrerUser?.username ?? null };
    }
    const response = toMeResponse(userForResponse);
    if (response) response.isAdmin = await isAdminWallet(req.wallet || user.wallet);
    res.json(response || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/profile", async (req, res) => {
  try {
    const body = req.body || {};
    const { username, name, bio, avatar, websiteUrl, xUrl, telegramUrl, referralCode } = body;
    const usernameVal = (username != null && typeof username !== "string") ? String(username) : (username || "").trim();
    if (!usernameVal || usernameVal.length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters" });
    }
    const current = await User.getUser(req);
    if (!current) return res.status(404).json({ error: "User not found" });
    const usernameNormalized = usernameVal.toLowerCase();
    const existing = await User.findUserByUsername(usernameNormalized);
    if (existing && existing.id !== current.id) {
      return res.status(400).json({ error: "This username is already taken. Please choose another." });
    }
    const updates = { username: usernameNormalized };
    const earlyState = ["CONNECTED", "REGISTERED"].includes(current.state) || !current.state;
    if (earlyState) updates.state = isConfiguredBotWallet(current.wallet) ? "ACTIVE_TRADER" : "PROFILE_SET";
    if (name !== undefined) updates.name = (typeof name === "string" ? name.trim() : null) || null;
    if (bio !== undefined) updates.bio = (typeof bio === "string" ? bio.trim() : null) || null;
    if (avatar !== undefined) {
      const newAvatar = (typeof avatar === "string" ? avatar.trim() : null) || null;
      if (current.avatar && current.avatar !== newAvatar) deleteOldAvatarFile(current.avatar);
      updates.avatar = newAvatar;
    }
    if (websiteUrl !== undefined) updates.websiteUrl = (typeof websiteUrl === "string" ? websiteUrl.trim() : null) || null;
    if (xUrl !== undefined) updates.xUrl = (typeof xUrl === "string" ? xUrl.trim() : null) || null;
    if (telegramUrl !== undefined) updates.telegramUrl = (typeof telegramUrl === "string" ? telegramUrl.trim() : null) || null;

    if (referralCode && typeof referralCode === "string" && referralCode.trim() && !current.referrer) {
      const ref = referralCode.trim();
      let referrerWallet = null;
      if (/^0x[a-fA-F0-9]{40}$/.test(ref)) referrerWallet = ref.toLowerCase();
      else {
        const referrerUser = await User.findUserByUsername(ref.toLowerCase());
        if (referrerUser?.wallet) referrerWallet = referrerUser.wallet.toLowerCase();
      }
      if (referrerWallet && referrerWallet !== current.wallet?.toLowerCase()) {
        updates.referrer = referrerWallet;
      }
    }

    await User.updateUser(current.id, updates);
    if (updates.referrer) {
      await User.incrementReferralChain(updates.referrer);
      syncReferrerToChain(current.wallet, updates.referrer).catch(() => {});
    }

    const user = await User.getUser(req);

    let userForResponse = user;
    if (user?.referrer) {
      const referrerUser = await User.getUserByWallet(user.referrer);
      userForResponse = { ...user, referrerUsername: referrerUser?.username ?? null };
    }

    // Sync Firebase Auth profile (displayName, photoURL) for email/Firebase users
    if (req.firebaseUid && user) {
      await updateAuthUser(req.firebaseUid, {
        displayName: user.name ?? null,
        photoURL: user.avatar ?? null,
      });
    }
    const userIsBot = isConfiguredBotWallet(user.wallet);
    let redirect = userIsBot ? "marketplace" : "subscription";
    if (user.state === "MINTED" || (user.state && !["CONNECTED", "REGISTERED", "PROFILE_SET", "SUBSCRIBED"].includes(user.state))) {
      redirect = "dashboard";
    } else if (user.state === "SUBSCRIBED") {
      redirect = "mint";
    }
    if (userIsBot) redirect = "marketplace";
    res.json({
      user: toMeResponse(userForResponse),
      redirect,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Avatar upload saves to backend disk (uploads/avatars). Only the account owner (connected wallet) can change avatar. Old avatar file is deleted when new one is uploaded.
router.post("/avatar-upload", (req, res, next) => {
  uploadAvatar(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file || !req.file.path) return res.status(400).json({ error: "No image file" });
    const accountWallet = (req.wallet || "").toLowerCase();
    if (!accountWallet && !req.firebaseUid) return res.status(401).json({ error: "Sign in required" });

    // Only the connected wallet can change avatar for this account
    const connectedHeader = (req.headers["x-connected-wallet"] || "").trim().toLowerCase();
    if (connectedHeader && connectedHeader.startsWith("0x") && accountWallet) {
      if (connectedHeader !== accountWallet) {
        return res.status(403).json({ error: "Connected wallet does not match this account. Connect the correct wallet to change avatar." });
      }
    }

    if (accountWallet) {
      const user = await User.getUserByWallet(accountWallet);
      if (user?.avatar) deleteOldAvatarFile(user.avatar);
    }

    let baseUrl = (process.env.BACKEND_URL || "").trim();
    if (baseUrl && !baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) baseUrl = `http://${baseUrl}`;
    baseUrl = (baseUrl || "").replace(/\/$/, "");
    const filename = path.basename(req.file.path);
    const avatarUrl = baseUrl ? `${baseUrl}/uploads/avatars/${filename}` : `/uploads/avatars/${filename}`;
    res.json({ avatar: avatarUrl });
  } catch (e) {
    console.error("Avatar upload error:", e.message, e.stack);
    res.status(500).json({ error: e.message || "Avatar upload failed" });
  }
});

export default router;

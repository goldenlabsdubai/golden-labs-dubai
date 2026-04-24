import { Router } from "express";
import jwt from "jsonwebtoken";
import { ethers } from "ethers";
import { SiweMessage } from "siwe";
import * as AdminPg from "../services/adminPostgres.js";
import * as User from "../services/user.js";
import { isAdminWallet, isConfiguredBotWallet } from "../services/botService.js";
import { notifyActivity } from "../services/telegramNotify.js";
import { getPool } from "../config/postgres.js";
import { readReferrerOfOnChain } from "../services/referralContractRead.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

function redirectFor(user) {
  if (!user.username) return "profile";
  if (isConfiguredBotWallet(user.wallet)) return "marketplace";
  if (user.state === "SUSPENDED") return "subscription";
  if (["CONNECTED", "REGISTERED", "PROFILE_SET"].includes(user.state)) return "subscription";
  if (user.state === "SUBSCRIBED") return "mint";
  if (["MINTED", "ACTIVE_TRADER"].includes(user.state)) return "marketplace";
  return null;
}

// Removed: Firebase email/Google login. Use wallet SIWE (/verify).
router.post("/firebase", (_req, res) => {
  res.status(410).json({
    error: "Firebase auth has been removed. Sign in with your wallet (SIWE).",
  });
});

// Check if wallet has an account (public, no auth). New users go to profile first; existing users sign in.
router.get("/check/:wallet", async (req, res) => {
  try {
    const wallet = (req.params.wallet || "").trim().toLowerCase();
    if (!wallet || !wallet.startsWith("0x") || wallet.length < 42) {
      return res.status(400).json({ error: "Invalid wallet" });
    }
    const user = await User.getUserByWallet(wallet);
    res.json({ exists: Boolean(user) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get nonce for SIWE. For existing users we store nonce in users row.
router.get("/nonce/:wallet", async (req, res) => {
  try {
    const raw = req.params.wallet;
    if (!raw || typeof raw !== "string") {
      return res.status(400).json({ error: "Invalid wallet" });
    }
    const wallet = raw.trim().toLowerCase();
    if (!wallet.startsWith("0x") || wallet.length !== 42) {
      return res.status(400).json({ error: "Invalid wallet" });
    }
    const nonce = Math.random().toString(36).slice(2);
    const user = await User.getUserByWallet(wallet);
    if (user) {
      await User.updateUser(user.id, { nonce });
    }
    res.json({ nonce });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get nonce for admin SIWE. Stores nonce in PostgreSQL `admins`.
router.get("/admin-nonce/:wallet", async (req, res) => {
  try {
    const raw = req.params.wallet;
    if (!raw || typeof raw !== "string") {
      return res.status(400).json({ error: "Invalid wallet" });
    }
    const wallet = raw.trim().toLowerCase();
    if (!wallet.startsWith("0x") || wallet.length !== 42) {
      return res.status(400).json({ error: "Invalid wallet" });
    }
    if (!(await isAdminWallet(wallet))) {
      return res.status(403).json({ error: "Not an admin wallet" });
    }
    if (!getPool()) {
      return res.status(503).json({ error: "Database not configured" });
    }
    const nonce = Math.random().toString(36).slice(2);
    await AdminPg.setAdminNoncePg(wallet, nonce);
    res.json({ nonce });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Public: resolve referral username or 0x address to wallet (profile setup → setMyReferrer). */
router.get("/referrer-resolve", async (req, res) => {
  try {
    const ref = String(req.query.code || "").trim();
    if (!ref) return res.status(400).json({ error: "code query parameter required" });
    let referrerWallet = null;
    if (ref.startsWith("0x") && ref.length >= 42) {
      try {
        referrerWallet = ethers.getAddress(ref).toLowerCase();
      } catch {
        return res.status(400).json({ error: "Invalid referrer address" });
      }
    } else {
      const referrerUser = await User.findUserByUsername(ref);
      if (!referrerUser?.wallet) return res.status(404).json({ error: "Referrer not found" });
      referrerWallet = referrerUser.wallet.toLowerCase();
    }
    res.json({ wallet: referrerWallet });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Verify SIWE and issue JWT. New users must send profile (username etc.).
router.post("/verify", async (req, res) => {
  const { message, signature, referrer: referrerRaw, profile: profileRaw } = req.body;
  if (!message || !signature) {
    return res.status(400).json({ error: "message and signature required" });
  }

  let wallet;
  try {
    const siweMessage = new SiweMessage(message);
    const fields = await siweMessage.verify({ signature });
    wallet = fields.data.address.toLowerCase();
  } catch (e) {
    console.error("[auth/verify] SIWE verify failed:", e?.message || e);
    return res.status(401).json({ error: "Invalid signature" });
  }

  try {
    let referrerWallet = null;
    if (referrerRaw && typeof referrerRaw === "string" && referrerRaw.trim()) {
      const ref = referrerRaw.trim();
      if (ref.startsWith("0x") && ref.length >= 42) {
        try {
          referrerWallet = ethers.getAddress(ref).toLowerCase();
        } catch {
          return res.status(400).json({ error: "Invalid referrer address" });
        }
      } else {
        const referrerUser = await User.findUserByUsername(ref);
        if (referrerUser && referrerUser.wallet) referrerWallet = referrerUser.wallet.toLowerCase();
      }
      if (referrerWallet === wallet) referrerWallet = null; // no self-referral
    }

    let user = await User.getUserByWallet(wallet);
    if (!user) {
      // First-time user: create only when profile is provided (Save & Continue flow)
      const profile = profileRaw && typeof profileRaw === "object" ? profileRaw : null;
      const usernameVal = profile?.username != null ? String(profile.username).trim() : "";
      if (!usernameVal || usernameVal.length < 3) {
        return res.status(400).json({
          error: "Complete your profile to sign in. Username is required (at least 3 characters).",
        });
      }
      const usernameNormalized = usernameVal.toLowerCase();
      const existing = await User.findUserByUsername(usernameNormalized);
      if (existing) {
        return res.status(400).json({ error: "This username is already taken. Please choose another." });
      }
      if (referrerRaw && String(referrerRaw).trim()) {
        if (!referrerWallet) {
          return res.status(400).json({ error: "Invalid referral code or address." });
        }
        const onChainReferrer = await readReferrerOfOnChain(wallet);
        if (!onChainReferrer) {
          return res.status(400).json({
            error:
              "Confirm your referrer in your wallet first (one transaction), then tap Save again.",
          });
        }
        if (onChainReferrer !== referrerWallet) {
          return res.status(400).json({ error: "On-chain referrer does not match the code you entered." });
        }
      }
      await User.createUser({
        wallet,
        state: isConfiguredBotWallet(wallet) ? "ACTIVE_TRADER" : "PROFILE_SET",
        username: usernameNormalized,
        referrer: referrerWallet,
        name: profile?.name != null ? String(profile.name).trim() || null : null,
        bio: profile?.bio != null ? String(profile.bio).trim() || null : null,
        avatar: profile?.avatar != null ? String(profile.avatar).trim() || null : null,
        websiteUrl: profile?.websiteUrl != null ? String(profile.websiteUrl).trim() || null : null,
        xUrl: profile?.xUrl != null ? String(profile.xUrl).trim() || null : null,
        telegramUrl: profile?.telegramUrl != null ? String(profile.telegramUrl).trim() || null : null,
      });
      if (!isConfiguredBotWallet(wallet)) {
        notifyActivity("user_joined", { address: wallet }).catch(() => {});
      }
      user = await User.getUserByWallet(wallet);
      if (referrerWallet) {
        await User.incrementReferralChain(referrerWallet);
      }
    } else {
      const updates = { lastActivity: new Date() };
      if (isConfiguredBotWallet(wallet) && user.state !== "ACTIVE_TRADER") {
        updates.state = "ACTIVE_TRADER";
      }
      if (referrerWallet && !user.referrer) {
        const onChainReferrer = await readReferrerOfOnChain(wallet);
        if (!onChainReferrer || onChainReferrer !== referrerWallet) {
          return res.status(400).json({
            error: "Confirm your referrer in your wallet first, then sign in again.",
          });
        }
        updates.referrer = referrerWallet;
        await User.updateUser(user.id, updates);
        await User.incrementReferralChain(referrerWallet);
      } else {
        await User.updateUser(user.id, updates);
      }
      user = await User.getUserByWallet(wallet);
    }

    const token = jwt.sign({ wallet }, JWT_SECRET, { expiresIn: "7d" });
    const userResponse = { wallet: user.wallet, username: user.username, state: user.state, referrer: user.referrer };
    if (await isAdminWallet(wallet)) userResponse.isAdmin = true;
    res.json({
      token,
      user: userResponse,
      redirect: redirectFor(user),
    });
  } catch (e) {
    // DB / business logic errors — do not mask as "Invalid signature"
    console.error("[auth/verify] after SIWE:", e?.message || e);
    return res.status(500).json({
      error: e?.message || "Could not complete sign-in",
    });
  }
});

/** Admin panel login: SIWE verify, then require wallet to be in Postgres `admins` or env admin list. */
router.post("/admin-login", async (req, res) => {
  try {
    const { message, signature } = req.body;
    if (!message || !signature) return res.status(400).json({ error: "message and signature required" });
    const siweMessage = new SiweMessage(message);
    const fields = await siweMessage.verify({ signature });
    const wallet = fields.data.address.toLowerCase();
    if (!(await isAdminWallet(wallet))) {
      return res.status(403).json({ error: "Not an admin wallet" });
    }
    const token = jwt.sign({ wallet }, JWT_SECRET, { expiresIn: "7d" });
    res.json({
      token,
      user: { wallet, isAdmin: true },
    });
  } catch (e) {
    return res.status(401).json({ error: e?.message || "Invalid signature" });
  }
});

export default router;

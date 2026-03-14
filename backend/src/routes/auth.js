import { Router } from "express";
import jwt from "jsonwebtoken";
import { SiweMessage } from "siwe";
import { verifyIdToken, getFirestore } from "../config/firebase.js";
import * as AdminPg from "../services/adminPostgres.js";
import * as User from "../services/user.js";
import { syncReferrerToChain } from "../services/referralContractSync.js";
import { isAdminWallet, isConfiguredBotWallet } from "../services/botService.js";

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

// Firebase login (optional – app is wallet-only now)
router.post("/firebase", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: "idToken required" });
    const decoded = await verifyIdToken(idToken);
    if (!decoded) return res.status(401).json({ error: "Invalid Firebase token" });
    const { uid, email } = decoded;

    let user = await User.getUserByFirebaseUid(uid);
    if (!user) {
      await User.createUser({ firebaseUid: uid, email: email || null, state: "REGISTERED" });
      user = await User.getUserByFirebaseUid(uid);
    } else {
      await User.updateUser(user.id, { lastActivity: new Date() });
      user = await User.getUserByFirebaseUid(uid);
    }

    const token = jwt.sign({ firebaseUid: uid }, JWT_SECRET, { expiresIn: "7d" });
    res.json({
      token,
      user: { wallet: user.wallet, email: user.email, username: user.username, state: user.state },
      redirect: redirectFor(user),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// Get nonce for SIWE. For existing users we store nonce in users collection; for new users we only return a nonce (no DB create).
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

// Get nonce for admin SIWE. Stores nonce in Firestore admins collection only (separate from user nonce).
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
    const nonce = Math.random().toString(36).slice(2);
    try {
      await AdminPg.setAdminNoncePg(wallet, nonce);
    } catch (_) {
      const db = getFirestore();
      if (db) {
        await db.collection("admins").doc(wallet).set(
          { nonce, updatedAt: new Date(), wallet },
          { merge: true }
        );
      }
    }
    res.json({ nonce });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Verify SIWE and issue JWT. New users must send profile (username etc.); user is created in Firestore only then.
router.post("/verify", async (req, res) => {
  try {
    const { message, signature, referrer: referrerRaw, profile: profileRaw } = req.body;
    const siweMessage = new SiweMessage(message);
    const fields = await siweMessage.verify({ signature });
    const wallet = fields.data.address.toLowerCase();

    let referrerWallet = null;
    if (referrerRaw && typeof referrerRaw === "string" && referrerRaw.trim()) {
      const ref = referrerRaw.trim();
      if (ref.startsWith("0x") && ref.length >= 42) {
        referrerWallet = ref.toLowerCase();
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
      user = await User.getUserByWallet(wallet);
      if (referrerWallet) {
        await User.incrementReferralChain(referrerWallet);
        syncReferrerToChain(wallet, referrerWallet).catch(() => {});
      }
    } else {
      const updates = { lastActivity: new Date() };
      if (isConfiguredBotWallet(wallet) && user.state !== "ACTIVE_TRADER") {
        updates.state = "ACTIVE_TRADER";
      }
      if (referrerWallet && !user.referrer) {
        updates.referrer = referrerWallet;
        await User.updateUser(user.id, updates);
        await User.incrementReferralChain(referrerWallet);
        syncReferrerToChain(wallet, referrerWallet).catch(() => {});
      } else {
        await User.updateUser(user.id, updates);
      }
      user = await User.getUserByWallet(wallet);
      // Sync existing referrer to chain if not yet set (e.g. B so A can get L2 when C buys)
      if (user.referrer) syncReferrerToChain(wallet, user.referrer).catch(() => {});
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
    return res.status(401).json({ error: "Invalid signature" });
  }
});

/** Admin panel login: SIWE verify, then require wallet to be in Firestore config/admins or env admin list. */
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

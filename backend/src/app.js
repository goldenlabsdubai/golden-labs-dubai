/**
 * Express app – shared by local server (index.js) and Vercel serverless (api/[[...path]].js)
 */
import "dotenv/config";
import path from "path";
import express from "express";
import cors from "cors";

// Backend public URL (for avatar/upload links). On Vercel use VERCEL_URL; else PLATFORM_URL or BACKEND_URL.
const isVercel = Boolean(process.env.VERCEL);
if (isVercel && process.env.VERCEL_URL) {
  process.env.BACKEND_URL = `https://${process.env.VERCEL_URL}`.replace(/\/$/, "");
} else {
  const platformUrl = (process.env.PLATFORM_URL || "").trim().replace(/\/$/, "");
  if (platformUrl) {
    process.env.FRONTEND_URL = process.env.FRONTEND_URL || platformUrl;
    process.env.BACKEND_URL = process.env.BACKEND_URL || `${platformUrl}:${process.env.PORT || 3001}`;
  }
}

const app = express();

// CORS: on Vercel with no origins configured, allow all origins so the app works without CORS env (Hobby plan).
// When CORS_ORIGINS / FRONTEND_URL / ADMIN_PANEL_ORIGIN are set, only those origins are allowed.
const platformUrl = (process.env.PLATFORM_URL || "").trim().replace(/\/$/, "");
const allowedOrigins = Array.from(
  new Set(
    [
      process.env.PLATFORM_URL || "",
      process.env.CORS_ORIGINS || "",
      process.env.ADMIN_PANEL_ORIGIN || "",
      process.env.FRONTEND_URL || "",
      platformUrl ? `${platformUrl}:8080` : "",
    ]
      .join(",")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  )
);

const usePermissiveCors = isVercel && allowedOrigins.length === 0;

app.use(
  cors({
    origin(origin, callback) {
      if (usePermissiveCors) return callback(null, true);
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json());

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/user.js";
import publicUserRoutes from "./routes/publicUser.js";
import subscriptionRoutes from "./routes/subscription.js";
import mintRoutes from "./routes/mint.js";
import marketplaceRoutes, { ipfsProxyHandler } from "./routes/marketplace.js";
import referralRoutes from "./routes/referral.js";
import reservePoolRoutes from "./routes/reservepool.js";
import telegramRoutes from "./routes/telegram.js";
import topSellersRoutes from "./routes/topSellers.js";
import adminRoutes from "./routes/admin.js";
import botControlRoutes from "./routes/botControl.js";
import cronRoutes from "./routes/cron.js";
import { authMiddleware, optionalAuthMiddleware } from "./middleware/auth.js";
import { getFirestore } from "./config/firebase.js";

const uploadsPath = path.join(process.cwd(), "uploads");
app.use("/uploads", express.static(uploadsPath));

if (!getFirestore()) {
  console.warn("Firebase/Firestore not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON in backend/.env");
}

app.use("/api/auth", authRoutes);
app.use("/api/user/public", publicUserRoutes);
app.use("/api/user", authMiddleware, userRoutes);
app.use("/api/subscription", authMiddleware, subscriptionRoutes);
app.use("/api/mint", authMiddleware, mintRoutes);
app.get("/api/marketplace/ipfs-proxy", ipfsProxyHandler);
app.use("/api/marketplace", optionalAuthMiddleware, marketplaceRoutes);
app.use("/api/referral", authMiddleware, referralRoutes);
app.use("/api/reservepool", authMiddleware, reservePoolRoutes);
app.use("/api/telegram", telegramRoutes);
app.use("/api/top-sellers", topSellersRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/bot-control", botControlRoutes);
app.use("/api/cron", cronRoutes);

app.get("/api/health", (_, res) => res.json({ ok: true }));

export default app;

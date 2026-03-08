/**
 * Express app – shared by local server (index.js) and Vercel serverless (api/[[...path]].js)
 */
import "dotenv/config";
import path from "path";
import express from "express";
import cors from "cors";

// Derive FRONTEND_URL, BACKEND_URL, and CORS from PLATFORM_URL when set (EC2 / no domain – set URL once)
const platformUrl = (process.env.PLATFORM_URL || "").trim().replace(/\/$/, "");
if (platformUrl) {
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || platformUrl;
  // Always derive BACKEND_URL from PLATFORM_URL when set so avatar/upload URLs point to this server (not localhost)
  process.env.BACKEND_URL = `${platformUrl}:${process.env.PORT || 3001}`;
}

const app = express();

const allowedOrigins = Array.from(
  new Set(
    [
      process.env.PLATFORM_URL || "",
      process.env.CORS_ORIGINS || "",
      process.env.ADMIN_PANEL_ORIGIN || "",
      process.env.FRONTEND_URL || "",
      // Admin panel on same host, port 8080 (when PLATFORM_URL is set)
      platformUrl ? `${platformUrl}:8080` : "",
      "http://localhost:5173",
      "http://localhost:5174",
      "https://golden-labs-frontend.vercel.app",
    ]
      .join(",")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  )
);

app.use(
  cors({
    origin(origin, callback) {
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

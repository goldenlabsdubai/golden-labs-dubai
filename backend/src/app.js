/**
 * Express app – shared by local server (index.js) and Vercel serverless (api/[[...path]].js)
 */
import dotenv from "dotenv";
// EC2/PM2 often exports stale contract addresses; `.env` in app cwd must win.
dotenv.config({ override: true });
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
// When CORS_ORIGINS / FRONTEND_URL / ADMIN_PANEL_ORIGIN are set, those plus (unless STRICT_CORS=1) localhost
// Vite ports are allowed — admin dev server uses 5174 while the main app often uses 5173.
const platformUrl = (process.env.PLATFORM_URL || "").trim().replace(/\/$/, "");
const corsSegments = [
  process.env.PLATFORM_URL || "",
  process.env.CORS_ORIGINS || "",
  process.env.ADMIN_PANEL_ORIGIN || "",
  process.env.FRONTEND_URL || "",
  platformUrl ? `${platformUrl}:8080` : "",
];
// Do not add these on Vercel — an empty env list must stay empty so usePermissiveCors allows all origins.
if (process.env.STRICT_CORS !== "1" && !isVercel) {
  corsSegments.push("http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174");
}
const allowedOrigins = Array.from(
  new Set(
    corsSegments
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
import supportChatRoutes from "./routes/supportChat.js";
import { authMiddleware, optionalAuthMiddleware } from "./middleware/auth.js";
import { getPool, requirePostgres } from "./config/postgres.js";
import { getDeployedContractsSnapshot } from "./config/contractsEnv.js";
import * as AdminPg from "./services/adminPostgres.js";
import { publicMaintenanceDto, PLATFORM_MAINTENANCE_SETTINGS_ID } from "./services/platformMaintenance.js";

try {
  requirePostgres();
} catch (e) {
  console.error("FATAL:", e.message);
  process.exit(1);
}

const uploadsPath = path.join(process.cwd(), "uploads");
app.use("/uploads", express.static(uploadsPath));

setImmediate(() => {
  if (getPool()) {
    console.log("Database: PostgreSQL (AWS RDS)");
  }
});

app.get("/api/health", (_, res) => res.json({ ok: true }));
/** Public: scheduled maintenance overlay for the web app (no auth). */
app.get("/api/public/platform-maintenance", async (_, res) => {
  try {
    if (!getPool()) {
      return res.json({ active: false });
    }
    const stored = await AdminPg.getAdminSettingsByIdPg(PLATFORM_MAINTENANCE_SETTINGS_ID);
    res.json(publicMaintenanceDto(stored));
  } catch {
    res.json({ active: false });
  }
});
/** Public: which contract addresses this API uses (compare to Vercel VITE_* so wallet only hits one deployment). */
app.get("/api/health/contracts", (_, res) => res.json(getDeployedContractsSnapshot()));
/** Public: AI support chat (optional SUPPORT_AI_API_KEY — see .env.example). */
app.use("/api/public/support", supportChatRoutes);
// Root (and /api for Vercel rewrite of "/" -> "/api") – so visiting base URL returns something
app.get("/", (_, res) => res.json({ api: "goldenlabs", health: "/api/health" }));
app.get("/api", (_, res) => res.json({ api: "goldenlabs", health: "/api/health" }));
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

export default app;

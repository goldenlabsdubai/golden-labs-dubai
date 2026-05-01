/**
 * Restarts universal-bot.js on crash / non-zero exit (for dev/Windows or without PM2).
 * Usage: node bot-supervisor.mjs 1
 * Env: BOT_SUPERVISOR_RESTART_MS (default 5000) — backoff before respawn
 * Production EC2: prefer `pm2 start ecosystem.config.cjs` (also auto-restarts).
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const botId = String(process.argv[2] || "1").trim();
const RESTART_MS = Math.max(1000, Number(process.env.BOT_SUPERVISOR_RESTART_MS || 5000));

function runOnce() {
  const child = spawn(process.execPath, ["universal-bot.js", botId], {
    cwd: __dirname,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    const why = signal != null ? `signal ${signal}` : `code ${code ?? "?"}`;
    console.error(`[supervisor] bot ${botId} stopped (${why}) — restarting in ${RESTART_MS}ms`);
    setTimeout(runOnce, RESTART_MS);
  });

  child.on("error", (err) => {
    console.error("[supervisor] spawn error:", err?.message || err);
    setTimeout(runOnce, RESTART_MS);
  });
}

console.error(`[supervisor] watching universal-bot.js ${botId} (restart delay ${RESTART_MS}ms)`);
runOnce();

/**
 * PM2 ecosystem for bots – auto-restart on crash (recommended on EC2).
 *
 * Loads bots/.env into process.env before PM2 forks children (so RPC, keys, URLs apply).
 *
 * On the server (replace path):
 *   cd ~/golden-labs-dubai/bots
 *   npm ci
 *   pm2 delete bot1 bot2 2>/dev/null || true
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * After editing bots/.env:
 *   cd ~/golden-labs-dubai/bots && pm2 restart bot1 bot2 --update-env
 *
 * Logs: pm2 logs bot1 --lines 100
 * Errors: tail -n 80 ~/.pm2/logs/bot1-error.log
 */
const path = require("path");
const botsDir = __dirname;
const scriptPath = path.join(botsDir, "universal-bot.js");

try {
  require("dotenv").config({ path: path.join(botsDir, ".env") });
} catch (_) {
  /* dotenv optional if require fails from cwd */
}

const inheritedEnv = { ...process.env };

module.exports = {
  apps: [
    {
      name: "bot1",
      script: scriptPath,
      args: "1",
      cwd: botsDir,
      interpreter: "node",
      env: inheritedEnv,
      autorestart: true,
      max_restarts: 100,
      min_uptime: "10s",
      restart_delay: 5000,
      exp_backoff_restart_delay: 500,
      kill_timeout: 15000,
      watch: false,
    },
    {
      name: "bot2",
      script: scriptPath,
      args: "2",
      cwd: botsDir,
      interpreter: "node",
      env: inheritedEnv,
      autorestart: true,
      max_restarts: 100,
      min_uptime: "10s",
      restart_delay: 5000,
      exp_backoff_restart_delay: 500,
      kill_timeout: 15000,
      watch: false,
    },
  ],
};

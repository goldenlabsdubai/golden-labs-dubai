/**
 * PM2 ecosystem for bots – auto-restart on crash (recommended on EC2).
 *
 * Start from repo (or any cwd):  pm2 start /path/to/bots/ecosystem.config.cjs
 * Or:  cd bots && pm2 start ecosystem.config.cjs
 * Restart:  pm2 restart bot1   pm2 restart bot2
 * Logs:     pm2 logs bot1 --lines 100
 * Save/resurrect:  pm2 save && pm2 startup
 *
 * Requires on the server: bots/.env with keys + RPC + https://api… URLs (not localhost).
 * universal-bot.js loads .env from its own directory so cwd mismatches still work.
 */
const path = require("path");
const botsDir = __dirname;
const scriptPath = path.join(botsDir, "universal-bot.js");

module.exports = {
  apps: [
    {
      name: "bot1",
      script: scriptPath,
      args: "1",
      cwd: botsDir,
      interpreter: "node",
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

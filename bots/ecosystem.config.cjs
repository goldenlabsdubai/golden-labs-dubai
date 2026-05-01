/**
 * PM2 ecosystem for bots – auto-restart on crash (recommended on EC2).
 * Start:  pm2 start ecosystem.config.cjs
 * Stop:   pm2 stop bot1 bot2
 * Logs:   pm2 logs
 * Resurrect after reboot: pm2 startup && pm2 save
 */
module.exports = {
  apps: [
    {
      name: "bot1",
      script: "universal-bot.js",
      args: "1",
      cwd: __dirname,
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
      script: "universal-bot.js",
      args: "2",
      cwd: __dirname,
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

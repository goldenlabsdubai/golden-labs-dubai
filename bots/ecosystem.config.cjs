/**
 * PM2 ecosystem for bots – run on EC2 so each bot restarts on crash.
 * Start: pm2 start ecosystem.config.cjs
 * Stop:  pm2 stop bot1 bot2
 * Logs:  pm2 logs
 */
module.exports = {
  apps: [
    {
      name: "bot1",
      script: "universal-bot.js",
      args: "1",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 50,
      min_uptime: "5s",
      watch: false,
    },
    {
      name: "bot2",
      script: "universal-bot.js",
      args: "2",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 50,
      min_uptime: "5s",
      watch: false,
    },
  ],
};

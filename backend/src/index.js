import app from "./app.js";
import { startReferralIndexer } from "./services/referralIndexer.js";
import { startMarketplaceActivityIndexer } from "./services/marketplaceActivityIndexer.js";
import { getBotConfig, getBotRunningState } from "./services/botService.js";
import { syncBotProcessesWithState } from "./services/botProcessService.js";

const PORT = process.env.PORT || 3001;

// Only run server + indexers when NOT on Vercel (serverless runs api/[[...path]].js)
if (!process.env.VERCEL) {
  console.log("Starting backend...");
  app.listen(PORT, () => {
    console.log("Backend running at http://localhost:%s", PORT);
    console.log("Health: http://localhost:%s/api/health", PORT);
  });

  startReferralIndexer();
  startMarketplaceActivityIndexer();

  (async () => {
    try {
      const botConfig = getBotConfig();
      const runningState = await getBotRunningState();
      await syncBotProcessesWithState(botConfig, runningState);
    } catch (e) {
      console.warn("Bot process startup sync failed:", e?.message);
    }
  })();
}

/**
 * Seed/update Firestore "users" docs for bot wallets so listings show bot profiles.
 * Run from backend folder: npm run seed-bot-profiles
 * Requires:
 * - FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON
 * - BOT_1_ADDRESS / BOT_2_ADDRESS (optional BOT_3..BOT_5)
 */
import "dotenv/config";
import * as User from "../src/services/userFirestore.js";

function normalizeAddress(value) {
  if (typeof value !== "string") return "";
  const v = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(v) ? v : "";
}

function getBotWallets() {
  const list = [];
  for (let i = 1; i <= 5; i++) {
    const wallet = normalizeAddress(process.env[`BOT_${i}_ADDRESS`] || "");
    if (!wallet) continue;
    list.push({ id: i, wallet });
  }
  return list;
}

async function upsertBotProfile(bot) {
  const username = `bot${bot.id}`;
  const profilePatch = {
    username,
    name: `Trading Bot ${bot.id}`,
    bio: "Automated marketplace trading bot account.",
    state: "ACTIVE_TRADER",
    isBot: true,
    lastActivity: new Date(),
  };

  const existing = await User.getUserByWallet(bot.wallet);
  if (!existing) {
    await User.createUser({
      wallet: bot.wallet,
      username,
      name: profilePatch.name,
      bio: profilePatch.bio,
      state: "ACTIVE_TRADER",
      isBot: true,
    });
    return { created: true, updated: false };
  }

  await User.updateUser(existing.id, profilePatch);
  return { created: false, updated: true };
}

async function main() {
  const bots = getBotWallets();
  if (bots.length === 0) {
    console.error("No bot wallet addresses found. Set BOT_1_ADDRESS/BOT_2_ADDRESS in backend .env");
    process.exit(1);
  }

  let created = 0;
  let updated = 0;
  for (const bot of bots) {
    const result = await upsertBotProfile(bot);
    if (result.created) created++;
    if (result.updated) updated++;
    console.log(`Bot ${bot.id} profile ready: ${bot.wallet}`);
  }

  console.log(`Done. created=${created}, updated=${updated}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

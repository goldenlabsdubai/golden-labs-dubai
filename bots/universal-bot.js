/**
 * Universal Auto Trading Bot (Bot 1..5)
 *
 * Usage:
 *   node universal-bot.js 1
 *   BOT_ID=2 node universal-bot.js
 *
 * Env keys used:
 *   RPC_URL
 *   MARKETPLACE_CONTRACT_ADDRESS
 *   NFT_CONTRACT_ADDRESS
 *   USDT_ADDRESS
 *   BOT1_PRIVATE_KEY ... BOT5_PRIVATE_KEY
 */
import "dotenv/config";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PRICES } from "./config.js";

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const MARKETPLACE_ADDR = process.env.MARKETPLACE_CONTRACT_ADDRESS;
const NFT_ADDR = process.env.NFT_CONTRACT_ADDRESS;
const USDT_ADDR = process.env.USDT_ADDRESS;
const LOCK_TTL_MS = Number(process.env.BOT_LOCK_TTL_MS || 2 * 60 * 1000);
const CONTROL_REFRESH_MS = Number(process.env.BOT_CONTROL_REFRESH_MS || 5000);
const CONTROL_REQUEST_TIMEOUT_MS = Number(process.env.BOT_CONTROL_REQUEST_TIMEOUT_MS || 4000);
const BOT_CONTROL_BASE_URL = process.env.BOT_CONTROL_BASE_URL || "http://localhost:3001/api/bot-control";
const BOT_CONTROL_API_KEY = process.env.BOT_CONTROL_API_KEY || "";
const BOT_RECORD_PURCHASE_URL =
  process.env.BOT_RECORD_PURCHASE_URL || "http://127.0.0.1:3001/api/marketplace/record-purchase";
const USER_LISTINGS_CACHE_MS = Number(process.env.BOT_USER_LISTINGS_CACHE_MS || 10000);
const ACTIVE_SCAN_BATCH_SIZE = Number(process.env.BOT_ACTIVE_SCAN_BATCH_SIZE || 40);
const ACTIVE_LISTINGS_SWEEP_MS = Number(process.env.BOT_ACTIVE_LISTINGS_SWEEP_MS || 12000);
const RELIST_CHECK_MS = Number(process.env.BOT_RELIST_CHECK_MS || 30000);
const RELIST_SCAN_BATCH_SIZE = Number(process.env.BOT_RELIST_SCAN_BATCH_SIZE || 40);
const RELIST_MAX_PER_RUN = Number(process.env.BOT_RELIST_MAX_PER_RUN || 3);
const INTER_BOT_COOLDOWN_MS = Number(process.env.BOT_INTERBOT_COOLDOWN_MS || 24 * 60 * 60 * 1000);
const USER_LISTING_MIN_AGE_MS = Number(process.env.BOT_USER_LISTING_MIN_AGE_MS || 60 * 60 * 1000);
const RPC_POLLING_INTERVAL_MS = Number(process.env.BOT_RPC_POLLING_INTERVAL_MS || 12000);
const BOT_TX_GAS_GWEI = Number(process.env.BOT_TX_GAS_GWEI || 3);
const BOT_GAS_LIMIT_APPROVE = Number(process.env.BOT_GAS_LIMIT_APPROVE || 120000);
const BOT_GAS_LIMIT_BUY = Number(process.env.BOT_GAS_LIMIT_BUY || 350000);
const BOT_GAS_LIMIT_LIST = Number(process.env.BOT_GAS_LIMIT_LIST || 350000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCK_DIR = path.join(__dirname, ".locks");
const COOLDOWN_FILE = path.join(__dirname, ".bot-intercooldowns.json");
const LISTING_TIMESTAMPS_FILE = path.join(__dirname, ".bot-listing-timestamps.json");

function resolveBotId() {
  const argId = (process.argv[2] || "").trim();
  const envId = (process.env.BOT_ID || "").trim();
  const raw = argId || envId || "1";
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1 || id > 5) {
    throw new Error(`Invalid bot id "${raw}". Use 1..5.`);
  }
  return String(id);
}

const marketplaceAbi = [
  "function listings(uint256) view returns (address seller, uint256 tokenId, uint256 price, bool active)",
  "event Listed(uint256 indexed tokenId, address indexed seller, uint256 price)",
  "event Sold(uint256 indexed tokenId, address seller, address buyer, uint256 price)",
  "event ListingCancelled(uint256 indexed tokenId)",
  "function buy(uint256 tokenId, address referrer)",
  "function list(uint256 tokenId, uint256 price)",
];
const nftAbi = [
  "function approve(address, uint256) returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function totalMinted() view returns (uint256)",
];
const usdtAbi = [
  "function approve(address, uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

function ensureLockDir() {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
}

function lockPathForToken(tokenId) {
  return path.join(LOCK_DIR, `token-${tokenId}.lock`);
}

async function acquireTokenLock(tokenId) {
  ensureLockDir();
  const p = lockPathForToken(tokenId);
  const now = Date.now();
  try {
    const handle = await fs.promises.open(p, "wx");
    await handle.writeFile(String(now));
    return { path: p, handle };
  } catch (e) {
    if (e?.code !== "EEXIST") return null;
    try {
      const stat = await fs.promises.stat(p);
      if (now - stat.mtimeMs > LOCK_TTL_MS) {
        await fs.promises.unlink(p).catch(() => {});
        const handle = await fs.promises.open(p, "wx");
        await handle.writeFile(String(now));
        return { path: p, handle };
      }
    } catch (_) {}
    return null;
  }
}

async function releaseTokenLock(lock) {
  if (!lock) return;
  try {
    await lock.handle?.close();
  } catch (_) {}
  try {
    await fs.promises.unlink(lock.path);
  } catch (_) {}
}

async function main() {
  const botId = resolveBotId();
  const keyVar = `BOT${botId}_PRIVATE_KEY`;
  const privateKey = process.env[keyVar];
  const isConfigured = privateKey && MARKETPLACE_ADDR && NFT_ADDR && USDT_ADDR;

  if (!isConfigured) {
    console.log(
      `Bot ${botId} idle - set ${keyVar}, MARKETPLACE_CONTRACT_ADDRESS, NFT_CONTRACT_ADDRESS, USDT_ADDRESS in bots/.env`
    );
    return;
  }

  // staticNetwork avoids frequent eth_chainId calls on each RPC request.
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  provider.pollingInterval = Math.max(4000, RPC_POLLING_INTERVAL_MS);
  const wallet = new ethers.Wallet(privateKey, provider);
  const self = wallet.address.toLowerCase();
  const marketplace = new ethers.Contract(MARKETPLACE_ADDR, marketplaceAbi, wallet);
  const nft = new ethers.Contract(NFT_ADDR, nftAbi, wallet);
  const usdt = new ethers.Contract(USDT_ADDR, usdtAbi, wallet);
  let queue = Promise.resolve();
  let cachedEnabled = true;
  let lastControlFetchAt = 0;
  let hadControlError = false;
  let wasEnabled = false;
  let canScanByTotalMinted = true;
  let warnedTotalMintedUnavailable = false;
  let cachedHasUserListings = false;
  let lastUserListingsCheckAt = 0;
  const knownBotWallets = new Set();
  const interBotCooldowns = readInterBotCooldowns();
  let listingTimestamps = readListingTimestamps();

  process.on("unhandledRejection", (reason) => {
    if (isRateLimitError(reason)) {
      console.warn(`Bot ${botId}: RPC rate limited, retrying automatically`);
      return;
    }
    console.error(`Bot ${botId}: unhandled rejection`, reason?.message || reason);
  });

  function enqueue(task) {
    queue = queue
      .then(task)
      .catch((e) => console.error(`Bot ${botId} queued task error:`, e?.message || e));
    return queue;
  }

  function buildKnownBotWalletSet() {
    for (let i = 1; i <= 5; i++) {
      const pk = (process.env[`BOT${i}_PRIVATE_KEY`] || "").trim();
      if (!pk) continue;
      try {
        const addr = new ethers.Wallet(pk).address.toLowerCase();
        knownBotWallets.add(addr);
      } catch (_) {}
    }
  }

  async function getTotalMintedSafe() {
    if (!canScanByTotalMinted) return null;
    try {
      const totalMinted = Number(await nft.totalMinted());
      if (!Number.isFinite(totalMinted) || totalMinted < 0) return null;
      return totalMinted;
    } catch (e) {
      canScanByTotalMinted = false;
      if (!warnedTotalMintedUnavailable) {
        warnedTotalMintedUnavailable = true;
        console.warn(
          `Bot ${botId}: NFT totalMinted unavailable, disabling active-sweep/relist scanner; continuing live Listed listening`
        );
      }
      return null;
    }
  }

function pairKey(a, b) {
  const x = String(a || "").toLowerCase();
  const y = String(b || "").toLowerCase();
  return [x, y].sort().join("|");
}

function readInterBotCooldowns() {
  try {
    if (!fs.existsSync(COOLDOWN_FILE)) return {};
    const raw = fs.readFileSync(COOLDOWN_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeInterBotCooldowns(data) {
  try {
    fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(data, null, 2));
  } catch (_) {}
}

function readListingTimestamps() {
  try {
    if (!fs.existsSync(LISTING_TIMESTAMPS_FILE)) return {};
    const raw = fs.readFileSync(LISTING_TIMESTAMPS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeListingTimestamps(data) {
  try {
    fs.writeFileSync(LISTING_TIMESTAMPS_FILE, JSON.stringify(data, null, 2));
  } catch (_) {}
}

function isRateLimitError(e) {
  const msg = String(e?.message || e?.shortMessage || "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("compute units per second") ||
    Number(e?.code) === 429 ||
    Number(e?.error?.code) === 429
  );
}

function txOverrides(kind = "default") {
  const base = {};
  if (Number.isFinite(BOT_TX_GAS_GWEI) && BOT_TX_GAS_GWEI > 0) {
    base.gasPrice = ethers.parseUnits(String(BOT_TX_GAS_GWEI), "gwei");
  }
  if (kind === "approve") return { ...base, gasLimit: BigInt(Math.max(50000, BOT_GAS_LIMIT_APPROVE)) };
  if (kind === "buy") return { ...base, gasLimit: BigInt(Math.max(120000, BOT_GAS_LIMIT_BUY)) };
  if (kind === "list") return { ...base, gasLimit: BigInt(Math.max(120000, BOT_GAS_LIMIT_LIST)) };
  return base;
}

  async function hasAnyActiveUserListing(force = false) {
    const now = Date.now();
    if (!force && now - lastUserListingsCheckAt < Math.max(2000, USER_LISTINGS_CACHE_MS)) {
      return cachedHasUserListings;
    }
    lastUserListingsCheckAt = now;
    try {
      const totalMinted = await getTotalMintedSafe();
      if (!Number.isFinite(totalMinted) || totalMinted <= 0) {
        cachedHasUserListings = false;
        return false;
      }
      const batchSize = Math.max(1, Math.min(ACTIVE_SCAN_BATCH_SIZE, 200));
      for (let start = 1; start <= totalMinted; start += batchSize) {
        const end = Math.min(totalMinted, start + batchSize - 1);
        const chunk = await Promise.all(
          Array.from({ length: end - start + 1 }, (_, idx) => start + idx).map((tokenId) =>
            marketplace
              .listings(tokenId)
              .then((l) => ({
                active: Boolean(l?.active ?? l?.[3]),
                seller: (l?.seller || l?.[0] || "").toString().toLowerCase(),
              }))
              .catch(() => null)
          )
        );
        for (const row of chunk) {
          if (!row?.active) continue;
          if (!row.seller) continue;
          if (!knownBotWallets.has(row.seller)) {
            cachedHasUserListings = true;
            return true;
          }
        }
      }
      cachedHasUserListings = false;
      return false;
    } catch (e) {
      console.warn(`Bot ${botId}: user-listings check failed`, e?.message || e);
      // Fail-safe: if uncertain, keep previous state to avoid aggressive bot-vs-bot buying.
      return cachedHasUserListings;
    }
  }

  async function tryBuyAndRelist(tokenId, seller, price, source) {
    const tokenIdStr = tokenId.toString();
    const sellerAddr = (seller || "").toString().toLowerCase();
    const priceBn = BigInt(price.toString());
    const sellerIsBot = knownBotWallets.has(sellerAddr);

    if (sellerAddr === self) return; // never buy own listing
    if (priceBn !== PRICES.PREFERRED_BUY && priceBn !== PRICES.DEFAULT) return;

    // User listings: wait 60 min before buying so users can trade first.
    if (!sellerIsBot) {
      let firstSeen = listingTimestamps[tokenIdStr];
      if (firstSeen === undefined) {
        firstSeen = Date.now();
        listingTimestamps[tokenIdStr] = firstSeen;
        writeListingTimestamps(listingTimestamps);
      }
      const ageMs = Date.now() - Number(firstSeen);
      if (ageMs < USER_LISTING_MIN_AGE_MS) {
        const minsLeft = Math.ceil((USER_LISTING_MIN_AGE_MS - ageMs) / 60000);
        console.log(`Bot ${botId}: skip token ${tokenIdStr}, user listing too new (${minsLeft}m left)`);
        return;
      }
    }
    if (sellerIsBot) {
      const cooldownKey = pairKey(self, sellerAddr);
      const now = Date.now();
      const blockedUntil = Number(interBotCooldowns[cooldownKey] || 0);
      if (blockedUntil > now) {
        const minsLeft = Math.ceil((blockedUntil - now) / 60000);
        console.log(`Bot ${botId}: skip token ${tokenIdStr}, bot pair cooldown ${minsLeft}m left`);
        return;
      }
      // Bot-to-bot trades are allowed only when there are no active user listings.
      const hasUserListings = await hasAnyActiveUserListing();
      if (hasUserListings) {
        console.log(`Bot ${botId}: skip token ${tokenIdStr}, user listings exist`);
        return;
      }
    }

    const lock = await acquireTokenLock(tokenIdStr);
    if (!lock) {
      console.log(`Bot ${botId}: skip token ${tokenIdStr}, already handled by another bot`);
      return;
    }

    try {
      const listing = await marketplace.listings(tokenId);
      if (!listing?.active) return;
      if ((listing.seller || "").toString().toLowerCase() === self) return;
      if ((listing.seller || "").toString().toLowerCase() !== sellerAddr) return;
      if (BigInt(listing.price.toString()) !== priceBn) return;

      const balance = await usdt.balanceOf(wallet.address);
      if (balance < priceBn) {
        console.log(`Bot ${botId}: insufficient USDT, skip token ${tokenIdStr}`);
        return;
      }

      const approveUsdtTx = await usdt.approve(MARKETPLACE_ADDR, priceBn, txOverrides("approve"));
      await approveUsdtTx.wait();
      const buyTx = await marketplace.buy(tokenId, ethers.ZeroAddress, txOverrides("buy"));
      const buyReceipt = await buyTx.wait();
      console.log(`Bot ${botId}: bought token ${tokenIdStr} (${source})`);
      delete listingTimestamps[tokenIdStr];
      writeListingTimestamps(listingTimestamps);
      await reportPurchaseToBackend({
        buyer: self,
        seller: sellerAddr,
        tokenId: tokenIdStr,
        fallbackPrice: priceBn.toString(),
        txHash: buyTx.hash,
        receipt: buyReceipt,
      });

      const approveNftTx = await nft.approve(MARKETPLACE_ADDR, tokenId, txOverrides("approve"));
      await approveNftTx.wait();
      const listTx = await marketplace.list(tokenId, PRICES.DEFAULT, txOverrides("list"));
      await listTx.wait();
      console.log(`Bot ${botId}: relisted token ${tokenIdStr} at $40`);
      if (sellerIsBot) {
        const cooldownKey = pairKey(self, sellerAddr);
        interBotCooldowns[cooldownKey] = Date.now() + Math.max(60_000, INTER_BOT_COOLDOWN_MS);
        writeInterBotCooldowns(interBotCooldowns);
      }
    } catch (e) {
      console.error(`Bot ${botId} trade error (${source}) token ${tokenIdStr}:`, e?.message || e);
    } finally {
      await releaseTokenLock(lock);
    }
  }

  async function processActiveListingsOnce(source) {
    try {
      const totalMinted = await getTotalMintedSafe();
      if (!Number.isFinite(totalMinted) || totalMinted <= 0) return;

      const batchSize = Math.max(1, Math.min(ACTIVE_SCAN_BATCH_SIZE, 200));
      for (let start = 1; start <= totalMinted; start += batchSize) {
        const end = Math.min(totalMinted, start + batchSize - 1);
        const tokenIds = Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
        const rows = await Promise.all(
          tokenIds.map((tokenId) =>
            marketplace
              .listings(tokenId)
              .then((l) => ({
                tokenId: BigInt(tokenId),
                seller: (l?.seller || l?.[0] || "").toString(),
                price: l?.price ?? l?.[2] ?? 0n,
                active: Boolean(l?.active ?? l?.[3]),
              }))
              .catch(() => null)
          )
        );

        for (const row of rows) {
          if (!row?.active) continue;
          const sellerAddr = (row.seller || "").toString().toLowerCase();
          const isUserListing = sellerAddr && !knownBotWallets.has(sellerAddr);
          if (isUserListing) {
            const tid = row.tokenId.toString();
            if (listingTimestamps[tid] === undefined) {
              listingTimestamps[tid] = Date.now();
              writeListingTimestamps(listingTimestamps);
            }
          }
          await tryBuyAndRelist(row.tokenId, row.seller, row.price, source);
        }
      }
    } catch (e) {
      console.warn(`Bot ${botId}: active-listings sweep failed`, e?.message || e);
    }
  }

  async function relistTokenIfNeeded(tokenId, source) {
    const tokenIdStr = tokenId.toString();
    const lock = await acquireTokenLock(tokenIdStr);
    if (!lock) return false;
    try {
      const listing = await marketplace.listings(tokenId);
      const seller = (listing?.seller || listing?.[0] || "").toString().toLowerCase();
      const isActive = Boolean(listing?.active ?? listing?.[3]);
      if (isActive && seller === self) return false; // already listed by this bot

      const owner = (await nft.ownerOf(tokenId)).toString().toLowerCase();
      if (owner !== self) return false; // not held anymore

      const approveTx = await nft.approve(MARKETPLACE_ADDR, tokenId, txOverrides("approve"));
      await approveTx.wait();
      const listTx = await marketplace.list(tokenId, PRICES.DEFAULT, txOverrides("list"));
      await listTx.wait();
      console.log(`Bot ${botId}: relisted held token ${tokenIdStr} (${source})`);
      return true;
    } catch (e) {
      console.warn(`Bot ${botId}: relist retry failed token ${tokenIdStr} (${source})`, e?.message || e);
      return false;
    } finally {
      await releaseTokenLock(lock);
    }
  }

  async function relistHeldNftsIfAny(source) {
    try {
      const totalMinted = await getTotalMintedSafe();
      if (!Number.isFinite(totalMinted) || totalMinted <= 0) return;

      const scanBatch = Math.max(1, Math.min(RELIST_SCAN_BATCH_SIZE, 200));
      const maxPerRun = Math.max(1, Math.min(RELIST_MAX_PER_RUN, 20));
      let relisted = 0;

      for (let start = 1; start <= totalMinted; start += scanBatch) {
        const end = Math.min(totalMinted, start + scanBatch - 1);
        const tokenIds = Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
        const owners = await Promise.all(
          tokenIds.map((tokenId) => nft.ownerOf(tokenId).then((o) => String(o || "").toLowerCase()).catch(() => ""))
        );
        for (let i = 0; i < tokenIds.length; i++) {
          if (owners[i] !== self) continue;
          const didRelist = await relistTokenIfNeeded(tokenIds[i], source);
          if (didRelist) relisted++;
          if (relisted >= maxPerRun) return;
        }
      }
    } catch (e) {
      console.warn(`Bot ${botId}: relist worker error`, e?.message || e);
    }
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function reportPurchaseToBackend({ buyer, seller, tokenId, fallbackPrice, txHash, receipt }) {
    try {
      if (!BOT_RECORD_PURCHASE_URL) return;
      let eventId = "";
      let salePrice = String(fallbackPrice || "0");
      const txHashLower = String(txHash || "").toLowerCase();
      for (const log of receipt?.logs || []) {
        try {
          const parsed = marketplace.interface.parseLog(log);
          if (!parsed || parsed.name !== "Sold") continue;
          const soldTokenId = parsed.args?.tokenId != null ? String(parsed.args.tokenId) : "";
          if (soldTokenId !== String(tokenId)) continue;
          const soldBuyer = String(parsed.args?.buyer || "").toLowerCase();
          if (soldBuyer && soldBuyer !== String(buyer || "").toLowerCase()) continue;
          salePrice = parsed.args?.price != null ? String(parsed.args.price) : salePrice;
          const logIndex = Number(log?.index ?? log?.logIndex ?? -1);
          if (txHashLower && logIndex >= 0) eventId = `${txHashLower}_${logIndex}`;
          break;
        } catch (_) {}
      }
      const headers = {
        "content-type": "application/json",
      };
      if (BOT_CONTROL_API_KEY) headers["x-bot-control-key"] = BOT_CONTROL_API_KEY;
      const res = await fetchWithTimeout(
        BOT_RECORD_PURCHASE_URL,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            buyer,
            seller: seller || null,
            tokenId: String(tokenId),
            price: salePrice,
            txHash: txHash || null,
            eventId: eventId || null,
            blockNumber: Number(receipt?.blockNumber ?? 0) || null,
          }),
        },
        Math.max(1500, CONTROL_REQUEST_TIMEOUT_MS)
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`Bot ${botId}: record-purchase API failed ${res.status} ${text}`.trim());
      }
    } catch (e) {
      console.warn(`Bot ${botId}: record-purchase call failed`, e?.message || e);
    }
  }

  async function isBotEnabled(force = false) {
    // No control URL configured -> always active (backward compatible).
    if (!BOT_CONTROL_BASE_URL) return true;
    const now = Date.now();
    if (!force && now - lastControlFetchAt < Math.max(1000, CONTROL_REFRESH_MS)) {
      return cachedEnabled;
    }
    lastControlFetchAt = now;
    try {
      const endpoint = `${BOT_CONTROL_BASE_URL.replace(/\/$/, "")}/${botId}`;
      const headers = BOT_CONTROL_API_KEY ? { "x-bot-control-key": BOT_CONTROL_API_KEY } : {};
      const res = await fetchWithTimeout(
        endpoint,
        { headers },
        Math.max(1000, CONTROL_REQUEST_TIMEOUT_MS)
      );
      if (!res.ok) throw new Error(`control endpoint ${res.status}`);
      const data = await res.json();
      cachedEnabled = Boolean(data?.running);
      hadControlError = false;
      return cachedEnabled;
    } catch (e) {
      if (!hadControlError) {
        console.warn(`Bot ${botId}: control-state fetch failed, using last known state`, e?.message || e);
        hadControlError = true;
      }
      return cachedEnabled;
    }
  }

  console.log(`Bot ${botId} wallet: ${wallet.address}`);
  buildKnownBotWalletSet();
  await hasAnyActiveUserListing(true).catch(() => {});
  const initialEnabled = await isBotEnabled(true);
  wasEnabled = Boolean(initialEnabled);
  if (!wasEnabled) console.log(`Bot ${botId} paused by admin state (running=false). Listening only.`);

  console.log(`Bot ${botId} running. Listening Marketplace Listed events only.`);

  // On startup, prioritize existing active listings first (old-first by tokenId order).
  if (wasEnabled) {
    enqueue(() => processActiveListingsOnce("startup-sweep"));
  }

  marketplace.on("Listed", (tokenId, seller, price) => {
    enqueue(async () => {
      const enabled = await isBotEnabled();
      if (!enabled) return;
      const sellerAddr = (seller || "").toString().toLowerCase();
      if (sellerAddr && !knownBotWallets.has(sellerAddr)) {
        const tid = tokenId.toString();
        listingTimestamps[tid] = Date.now();
        writeListingTimestamps(listingTimestamps);
      }
      await tryBuyAndRelist(tokenId, seller, price, "event-listed");
    });
  });

  // Continuous active-listings sweep from marketplace state (not event history).
  setInterval(() => {
    enqueue(async () => {
      const enabled = await isBotEnabled();
      if (!enabled) return;
      await processActiveListingsOnce("active-sweep");
    });
  }, Math.max(5000, ACTIVE_LISTINGS_SWEEP_MS));

  // Lightweight admin-state watcher (no chain scans).
  setInterval(async () => {
    try {
      const enabled = await isBotEnabled();
      if (enabled !== wasEnabled) {
        wasEnabled = enabled;
        console.log(`Bot ${botId}: ${enabled ? "resumed" : "paused"} by admin state`);
        if (enabled) {
          enqueue(() => processActiveListingsOnce("resume-sweep"));
        }
      }
    } catch (e) {
      console.warn(`Bot ${botId}: control watcher error`, e?.shortMessage || e?.message || e);
    }
  }, Math.max(2000, CONTROL_REFRESH_MS));

  // Recovery worker: if bot holds NFTs that are not listed, list them automatically.
  setInterval(() => {
    enqueue(async () => {
      const enabled = await isBotEnabled();
      if (!enabled) return;
      await relistHeldNftsIfAny("relist-recovery");
    });
  }, Math.max(5000, RELIST_CHECK_MS));

  // Keep process alive for event listener.
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

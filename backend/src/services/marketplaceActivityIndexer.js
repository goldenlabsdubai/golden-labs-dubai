import { ethers } from "ethers";
import { getPool } from "../config/postgres.js";
import { getMarketplaceAndReservePoolAddress } from "../config/contractsEnv.js";
import { getSharedMainRpcProvider } from "../config/ethersRpc.js";
import * as User from "./user.js";
import * as MetaPg from "./metaPostgres.js";

const ABI = [
  "event Sold(uint256 indexed tokenId, address seller, address buyer, uint256 price)",
  "event Listed(uint256 indexed tokenId, address seller, uint256 price)",
  "event ListingCancelled(uint256 indexed tokenId)",
];

const MAX_BLOCKS_PER_QUERY = 10;
const POLL_INTERVAL_MS = Number(process.env.MARKETPLACE_INDEXER_POLL_INTERVAL_MS || 20000);
const CHUNK_DELAY_MS = Number(process.env.MARKETPLACE_INDEXER_CHUNK_DELAY_MS || 1000);

async function getLastProcessedBlock() {
  if (!getPool()) return null;
  try {
    const block = await MetaPg.getLastProcessedBlockMarketplacePg();
    if (block !== null) return block;
  } catch (_) {}
  return null;
}

async function setLastProcessedBlock(block) {
  if (!getPool()) return;
  try {
    await MetaPg.setLastProcessedBlockMarketplacePg(block);
  } catch (_) {}
}

async function loadListingBlocksMap() {
  if (!getPool()) return {};
  try {
    const map = await MetaPg.getListingBlocksMapPg();
    return map && typeof map === "object" ? map : {};
  } catch (_) {
    return {};
  }
}

/** Public: get tokenId -> { blockNumber, timestamp } for marketplace sort. */
export async function getListingBlocksMap() {
  return loadListingBlocksMap();
}

async function setListingBlocksMap(byTokenId) {
  if (!getPool()) return;
  try {
    await MetaPg.setListingBlocksMapPg(byTokenId);
  } catch (_) {}
}

function getStartBlock(latest) {
  const fromEnv = process.env.MARKETPLACE_INDEXER_FROM_BLOCK || process.env.BOT_STATS_FROM_BLOCK || "";
  const parsed = Number(fromEnv);
  if (Number.isFinite(parsed) && parsed >= 0) return Math.min(Math.floor(parsed), latest);
  return Math.max(0, latest - 1);
}

function isRateLimitError(e) {
  const msg = (e?.message || "") + JSON.stringify(e?.value || []);
  return (
    msg.includes("rate limit") ||
    msg.includes("-32005") ||
    msg.includes("compute units per second") ||
    e?.value?.[0]?.error?.code === -32005 ||
    e?.code === 429
  );
}

function saleEventId(evt) {
  const tx = String(evt?.transactionHash || "").toLowerCase();
  const logIndex = Number(evt?.logIndex ?? -1);
  return tx && logIndex >= 0 ? `${tx}_${logIndex}` : "";
}

/** Dedup key for Listed logs (stored in marketplace_processed_sales like sale ids). */
function listingDedupId(evt) {
  const tx = String(evt?.transactionHash || "").toLowerCase();
  const logIndex = Number(evt?.logIndex ?? -1);
  return tx && logIndex >= 0 ? `listed_${tx}_${logIndex}` : "";
}

async function isProcessed(eventId) {
  if (!getPool() || !eventId) return false;
  try {
    return await MetaPg.isProcessedSalePg(eventId);
  } catch (_) {
    return false;
  }
}

async function markProcessed(eventId, payload) {
  if (!getPool() || !eventId) return;
  try {
    await MetaPg.markProcessedSalePg(eventId, payload);
  } catch (e) {
    console.warn("markProcessedSalePg:", e?.message);
  }
}

export function startMarketplaceActivityIndexer() {
  const contractAddress = getMarketplaceAndReservePoolAddress();
  const rpcUrl = process.env.RPC_URL;
  if (!contractAddress || !rpcUrl) {
    console.warn(
      "Marketplace activity indexer disabled: set MARKETPLACE_AND_RESERVE_POOL_CONTRACT_ADDRESS (or legacy MARKETPLACE_CONTRACT_ADDRESS) and RPC_URL"
    );
    return;
  }
  if (!getPool()) {
    console.warn("Marketplace activity indexer disabled: PostgreSQL required for processed-sale dedup (PGHOST, PGDATABASE, PGUSER).");
    return;
  }

  const provider = getSharedMainRpcProvider();
  const contract = new ethers.Contract(contractAddress, ABI, provider);

  let running = false;
  let rateLimitWarned = false;

  const poll = async () => {
    if (running) return;
    running = true;
    try {
      await runMarketplaceActivityIndexerPoll(provider, contract);
    } catch (e) {
      if (isRateLimitError(e)) {
        if (!rateLimitWarned) {
          rateLimitWarned = true;
          console.warn("Marketplace activity indexer: RPC rate limit. Will retry on next poll.");
        }
      } else {
        console.error("Marketplace activity indexer error:", e?.message || e);
      }
    } finally {
      running = false;
    }
  };

  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

/** Shared poll logic – used by startMarketplaceActivityIndexer and runMarketplaceActivityIndexerOnce (Vercel cron). */
async function runMarketplaceActivityIndexerPoll(provider, contract) {
  let lastBlock = await getLastProcessedBlock();
  const latest = await provider.getBlockNumber();
  if (lastBlock == null) {
    lastBlock = getStartBlock(latest);
    await setLastProcessedBlock(lastBlock);
  }
  if (latest <= lastBlock) return;
  const querySoldWithRetry = async (fromBlock, toBlock, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        return await contract.queryFilter(contract.filters.Sold(), fromBlock, toBlock);
      } catch (e) {
        if (isRateLimitError(e) && i < retries - 1) {
          await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
          continue;
        }
        throw e;
      }
    }
    return [];
  };
  const queryListedWithRetry = async (fromBlock, toBlock, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        return await contract.queryFilter(contract.filters.Listed(), fromBlock, toBlock);
      } catch (e) {
        if (isRateLimitError(e) && i < retries - 1) {
          await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
          continue;
        }
        throw e;
      }
    }
    return [];
  };
  const queryCancelledWithRetry = async (fromBlock, toBlock, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        return await contract.queryFilter(contract.filters.ListingCancelled(), fromBlock, toBlock);
      } catch (e) {
        if (isRateLimitError(e) && i < retries - 1) {
          await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
          continue;
        }
        throw e;
      }
    }
    return [];
  };
  let listingBlocks = await loadListingBlocksMap();
  let fromBlock = lastBlock + 1;
  const toBlock = latest;
  let processedUpTo = lastBlock;
  let marketplaceListingsMutated = false;
  while (fromBlock <= toBlock) {
    const chunkTo = Math.min(fromBlock + MAX_BLOCKS_PER_QUERY - 1, toBlock);
    const [soldEvents, listedEvents, cancelledEvents] = await Promise.all([
      querySoldWithRetry(fromBlock, chunkTo),
      queryListedWithRetry(fromBlock, chunkTo),
      queryCancelledWithRetry(fromBlock, chunkTo),
    ]);
    if (soldEvents.length > 0 || listedEvents.length > 0 || cancelledEvents.length > 0) {
      marketplaceListingsMutated = true;
    }
    for (const evt of soldEvents) {
      const tokenId = evt.args?.tokenId;
      const seller = evt.args?.seller ? String(evt.args.seller).toLowerCase() : "";
      const buyer = evt.args?.buyer ? String(evt.args.buyer).toLowerCase() : "";
      const txHash = String(evt.transactionHash || "").trim() || null;
      const id = saleEventId(evt);
      if (!buyer || tokenId == null) continue;
      const alreadyProcessed = await isProcessed(id);
      if (alreadyProcessed) continue;
      const payload = {
        tokenId: String(tokenId),
        seller: seller || null,
        buyer,
        price: String(evt.args?.price ?? 0n),
        txHash,
        blockNumber: Number(evt.blockNumber ?? 0),
      };
      await User.recordPurchase(buyer, seller || null, String(tokenId), String(evt.args?.price ?? 0n), {
        txHash,
        eventId: id,
        blockNumber: Number(evt.blockNumber ?? 0),
      });
      await markProcessed(id, payload);
    }
    if (listedEvents.length > 0) {
      const uniqueBlocks = [...new Set(listedEvents.map((e) => e.blockNumber))];
      const blockTs = {};
      for (const b of uniqueBlocks) {
        try {
          const block = await provider.getBlock(b);
          blockTs[b] = block?.timestamp != null ? Number(block.timestamp) * 1000 : 0;
        } catch (_) {
          blockTs[b] = 0;
        }
      }
      for (const evt of listedEvents) {
        const tokenId = evt.args?.tokenId != null ? String(evt.args.tokenId) : null;
        if (!tokenId) continue;
        const blockNumber = Number(evt.blockNumber ?? 0);
        const existing = listingBlocks[tokenId];
        if (existing && existing.blockNumber >= blockNumber) continue;

        const lid = listingDedupId(evt);
        if (!lid || (await isProcessed(lid))) continue;

        listingBlocks[tokenId] = { blockNumber, timestamp: blockTs[blockNumber] ?? 0 };

        const seller = evt.args?.seller ? String(evt.args.seller).toLowerCase() : "";
        const priceWei = evt.args?.price != null ? String(evt.args.price) : "";
        await markProcessed(lid, {
          type: "listed",
          tokenId,
          seller: seller || null,
          price: priceWei,
          blockNumber,
        });
      }
    }
    processedUpTo = chunkTo;
    fromBlock = chunkTo + 1;
    if (fromBlock <= toBlock) await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
  }
  if (Object.keys(listingBlocks).length > 0) {
    await setListingBlocksMap(listingBlocks);
  }
  await setLastProcessedBlock(processedUpTo);
  if (marketplaceListingsMutated) {
    const { markMarketplaceListingsStale } = await import("./marketplaceListingsCache.js");
    markMarketplaceListingsStale();
  }
}

/** Run marketplace activity indexer once – for Vercel Cron or external cron. */
export async function runMarketplaceActivityIndexerOnce() {
  const contractAddress = getMarketplaceAndReservePoolAddress();
  const rpcUrl = process.env.RPC_URL;
  if (!contractAddress || !rpcUrl) {
    console.warn(
      "Marketplace activity indexer disabled: set MARKETPLACE_AND_RESERVE_POOL_CONTRACT_ADDRESS (or legacy MARKETPLACE_CONTRACT_ADDRESS) and RPC_URL"
    );
    return;
  }
  if (!getPool()) {
    console.warn("Marketplace activity indexer: PostgreSQL required (PGHOST, PGDATABASE, PGUSER).");
    return;
  }
  const provider = getSharedMainRpcProvider();
  const contract = new ethers.Contract(contractAddress, ABI, provider);
  await runMarketplaceActivityIndexerPoll(provider, contract);
}

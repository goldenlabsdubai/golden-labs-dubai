import { ethers } from "ethers";
import { getFirestore } from "../config/firebase.js";
import * as User from "./userFirestore.js";

const ABI = [
  "event Sold(uint256 indexed tokenId, address seller, address buyer, uint256 price)",
];

const META_COLLECTION = "meta";
const META_DOC = "marketplaceActivityIndexer";
const PROCESSED_COLLECTION = "marketplace_processed_sales";
const MAX_BLOCKS_PER_QUERY = 10; // Free-tier safe for eth_getLogs
const POLL_INTERVAL_MS = Number(process.env.MARKETPLACE_INDEXER_POLL_INTERVAL_MS || 20000);
const CHUNK_DELAY_MS = Number(process.env.MARKETPLACE_INDEXER_CHUNK_DELAY_MS || 1000);

async function getLastProcessedBlock() {
  const db = getFirestore();
  if (!db) return null;
  const snap = await db.collection(META_COLLECTION).doc(META_DOC).get();
  if (!snap.exists) return null;
  const d = snap.data();
  return typeof d.lastProcessedBlock === "number" ? d.lastProcessedBlock : null;
}

async function setLastProcessedBlock(block) {
  const db = getFirestore();
  if (!db) return;
  await db.collection(META_COLLECTION).doc(META_DOC).set({ lastProcessedBlock: block }, { merge: true });
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

async function isProcessed(eventId) {
  const db = getFirestore();
  if (!db || !eventId) return false;
  const ref = db.collection(PROCESSED_COLLECTION).doc(eventId);
  const doc = await ref.get();
  return doc.exists;
}

async function markProcessed(eventId, payload) {
  const db = getFirestore();
  if (!db || !eventId) return;
  const ref = db.collection(PROCESSED_COLLECTION).doc(eventId);
  await ref.set(
    {
      ...payload,
      createdAt: new Date(),
    },
    { merge: true }
  );
}

export function startMarketplaceActivityIndexer() {
  const contractAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS;
  const rpcUrl = process.env.RPC_URL;
  if (!contractAddress || !rpcUrl) {
    console.warn("Marketplace activity indexer disabled: set MARKETPLACE_CONTRACT_ADDRESS and RPC_URL");
    return;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
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
  const queryWithRetry = async (fromBlock, toBlock, retries = 3) => {
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
  let fromBlock = lastBlock + 1;
  const toBlock = latest;
  let processedUpTo = lastBlock;
  while (fromBlock <= toBlock) {
    const chunkTo = Math.min(fromBlock + MAX_BLOCKS_PER_QUERY - 1, toBlock);
    const events = await queryWithRetry(fromBlock, chunkTo);
    for (const evt of events) {
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
    processedUpTo = chunkTo;
    fromBlock = chunkTo + 1;
    if (fromBlock <= toBlock) await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
  }
  await setLastProcessedBlock(processedUpTo);
}

/** Run marketplace activity indexer once – for Vercel Cron or external cron. */
export async function runMarketplaceActivityIndexerOnce() {
  const contractAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS;
  const rpcUrl = process.env.RPC_URL;
  if (!contractAddress || !rpcUrl) {
    console.warn("Marketplace activity indexer disabled: set MARKETPLACE_CONTRACT_ADDRESS and RPC_URL");
    return;
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, ABI, provider);
  await runMarketplaceActivityIndexerPoll(provider, contract);
}

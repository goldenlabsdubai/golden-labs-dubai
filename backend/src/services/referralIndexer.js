import { ethers } from "ethers";
import { getFirestore } from "../config/firebase.js";
import * as User from "./userFirestore.js";

const ABI = [
  "event ReferralPaid(address indexed referrer, uint256 level, uint256 amount)"
];

const META_COLLECTION = "meta";
const META_DOC = "referralIndexer";
const MAX_BLOCKS_PER_QUERY = 10;  // Alchemy Free tier: eth_getLogs max 10 blocks per request
const POLL_INTERVAL_MS = 60000;   // 60s between polls
const CHUNK_DELAY_MS = 1500;     // delay between chunk requests

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

export function startReferralIndexer() {
  const contractAddress = process.env.REFERRAL_CONTRACT_ADDRESS;
  const rpcUrl = process.env.RPC_URL;
  if (!contractAddress || !rpcUrl) {
    console.warn("Referral indexer disabled: set REFERRAL_CONTRACT_ADDRESS and RPC_URL");
    return;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, ABI, provider);

  let running = false;
  let rateLimitWarned = false;

  function isRateLimitError(e) {
    const msg = (e?.message || "") + JSON.stringify(e?.value || []);
    return msg.includes("rate limit") || msg.includes("-32005") || (e?.value?.[0]?.error?.code === -32005);
  }

  const queryWithRetry = async (fromBlock, toBlock, retries = 4) => {
    for (let i = 0; i < retries; i++) {
      try {
        return await contract.queryFilter(contract.filters.ReferralPaid(), fromBlock, toBlock);
      } catch (e) {
        if (isRateLimitError(e) && i < retries - 1) {
          await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
          continue;
        }
        throw e;
      }
    }
  };

  const poll = async () => {
    if (running) return;
    running = true;
    try {
      await runReferralIndexerPoll(provider, contract);
    } catch (e) {
      if (isRateLimitError(e)) {
        if (!rateLimitWarned) {
          rateLimitWarned = true;
          console.warn("Referral indexer: RPC rate limit (eth_getLogs). Will retry next poll. Use a dedicated RPC in RPC_URL for steady indexing.");
        }
      } else {
        console.error("Referral indexer error:", e?.message || e);
      }
    } finally {
      running = false;
    }
  };

  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

/** Shared poll logic – used by startReferralIndexer and runReferralIndexerOnce (Vercel cron). */
async function runReferralIndexerPoll(provider, contract) {
  const queryWithRetry = async (fromBlock, toBlock, retries = 4) => {
    for (let i = 0; i < retries; i++) {
      try {
        return await contract.queryFilter(contract.filters.ReferralPaid(), fromBlock, toBlock);
      } catch (e) {
        const msg = (e?.message || "") + JSON.stringify(e?.value || []);
        if ((msg.includes("rate limit") || msg.includes("-32005") || (e?.value?.[0]?.error?.code === -32005)) && i < retries - 1) {
          await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
          continue;
        }
        throw e;
      }
    }
  };
  let lastBlock = await getLastProcessedBlock();
  const latest = await provider.getBlockNumber();
  if (lastBlock == null) {
    const fromEnv = process.env.REFERRAL_INDEXER_FROM_BLOCK;
    const fromBlock = fromEnv != null && fromEnv !== "" ? Math.max(0, parseInt(String(fromEnv), 10) || 0) : null;
    lastBlock = fromBlock != null && !Number.isNaN(fromBlock) ? fromBlock : Math.max(0, latest - 1);
    await setLastProcessedBlock(lastBlock);
  }
  if (latest <= lastBlock) return;
  let fromBlock = lastBlock + 1;
  const toBlock = latest;
  let processedUpTo = lastBlock;
  while (fromBlock <= toBlock) {
    const chunkTo = Math.min(fromBlock + MAX_BLOCKS_PER_QUERY - 1, toBlock);
    const events = await queryWithRetry(fromBlock, chunkTo);
    for (const evt of events) {
      const raw = evt.args?.referrer;
      const referrer = raw ? String(raw).toLowerCase() : "";
      const level = Number(evt.args?.level ?? 0);
      const amount = evt.args?.amount ?? 0n;
      if (referrer && level >= 1 && level <= 5) {
        await User.addReferralEarning(referrer, level, amount);
      }
    }
    processedUpTo = chunkTo;
    fromBlock = chunkTo + 1;
    if (fromBlock <= toBlock) await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
  }
  await setLastProcessedBlock(processedUpTo);
}

/** Run referral indexer once – for Vercel Cron or external cron. */
export async function runReferralIndexerOnce() {
  const contractAddress = process.env.REFERRAL_CONTRACT_ADDRESS;
  const rpcUrl = process.env.RPC_URL;
  if (!contractAddress || !rpcUrl) {
    console.warn("Referral indexer disabled: set REFERRAL_CONTRACT_ADDRESS and RPC_URL");
    return;
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, ABI, provider);
  await runReferralIndexerPoll(provider, contract);
}

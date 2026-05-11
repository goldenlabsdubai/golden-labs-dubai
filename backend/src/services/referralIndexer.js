import { ethers } from "ethers";
import { getPool } from "../config/postgres.js";
import * as User from "./user.js";
import * as MetaPg from "./metaPostgres.js";

/** `amount` is the USDT actually credited in that event, in wei at chain `USDT_DECIMALS` (L1 = full level slice; L2+ = split per `levelAmounts[level-1]/minDirectReferralsRequired[level-1]` when seats qualify). */
const ABI = ["event ReferralPaid(address indexed referrer, uint256 level, uint256 amount)"];

const MAX_BLOCKS_PER_QUERY = 10; // Alchemy Free tier: eth_getLogs max 10 blocks per request
const POLL_INTERVAL_MS = 60000; // 60s between polls
const CHUNK_DELAY_MS = 1500; // delay between chunk requests

async function getLastProcessedBlock() {
  if (!getPool()) return null;
  try {
    const block = await MetaPg.getLastProcessedBlockReferralPg();
    if (block !== null) return block;
  } catch (_) {}
  return null;
}

async function setLastProcessedBlock(block) {
  if (!getPool()) return;
  try {
    await MetaPg.setLastProcessedBlockReferralPg(block);
  } catch (_) {}
}

export function startReferralIndexer() {
  const contractAddress = process.env.REFERRAL_CONTRACT_ADDRESS;
  const rpcUrl = process.env.RPC_URL;
  if (!contractAddress || !rpcUrl) {
    console.warn("Referral indexer disabled: set REFERRAL_CONTRACT_ADDRESS and RPC_URL");
    return;
  }
  if (!getPool()) {
    console.warn("Referral indexer disabled: PostgreSQL required (PGHOST, PGDATABASE, PGUSER) for indexer state.");
    return;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, ABI, provider);

  let running = false;
  let rateLimitWarned = false;

  function isRateLimitError(e) {
    const msg = (e?.message || "") + JSON.stringify(e?.value || []);
    return msg.includes("rate limit") || msg.includes("-32005") || e?.value?.[0]?.error?.code === -32005;
  }

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
        if ((msg.includes("rate limit") || msg.includes("-32005") || e?.value?.[0]?.error?.code === -32005) && i < retries - 1) {
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
    const startInclusive =
      fromEnv != null && fromEnv !== "" ? Math.max(0, parseInt(String(fromEnv), 10) || 0) : null;
    if (startInclusive != null && !Number.isNaN(startInclusive)) {
      // Env = first block to scan (inclusive). Internal cursor is last fully processed block.
      lastBlock = startInclusive > 0 ? startInclusive - 1 : -1;
    } else {
      lastBlock = Math.max(0, latest - 1);
    }
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
      if (referrer && level >= 1 && level <= 10) {
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
  if (!getPool()) {
    console.warn("Referral indexer: PostgreSQL required for indexer state.");
    return;
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, ABI, provider);
  await runReferralIndexerPoll(provider, contract);
}

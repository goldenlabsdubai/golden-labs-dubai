/**
 * One-time ReferralPaid log backfill → PostgreSQL (same as referralIndexer addReferralEarning).
 *
 * Run from backend root:
 *   node scripts/backfill-referral-paid-once.js
 *   node scripts/backfill-referral-paid-once.js --dry-run
 *   node scripts/backfill-referral-paid-once.js --from-block=97533255
 *
 * Requires: REFERRAL_CONTRACT_ADDRESS, RPC_URL, PG* (same as main app).
 * Start block (inclusive), in order: --from-block CLI → REFERRAL_BACKFILL_FROM_BLOCK → REFERRAL_INDEXER_FROM_BLOCK → 0
 *           REFERRAL_BACKFILL_BLOCKS_PER_QUERY (default 50)
 *           REFERRAL_BACKFILL_CHUNK_DELAY_MS (default 400)
 *
 * SAFETY: addReferralEarning ADDS to existing totals. Do not run a full backfill twice on the same
 * rows without clearing referral_earnings_* first, or you will double-count. Use --dry-run to estimate.
 */
import "dotenv/config";
import { ethers } from "ethers";
import { getPool } from "../src/config/postgres.js";
import * as User from "../src/services/user.js";
import * as MetaPg from "../src/services/metaPostgres.js";

const ABI = ["event ReferralPaid(address indexed referrer, uint256 level, uint256 amount)"];

function parseArgs() {
  const dryRun = process.argv.includes("--dry-run");
  let fromBlock = null;
  for (const a of process.argv) {
    if (a.startsWith("--from-block=")) {
      const n = parseInt(String(a.slice("--from-block=".length)), 10);
      fromBlock = Number.isFinite(n) ? Math.max(0, n) : null;
    }
  }
  return { dryRun, fromBlock };
}

function isRateLimitError(e) {
  const msg = (e?.message || "") + JSON.stringify(e?.value || []);
  return msg.includes("rate limit") || msg.includes("-32005") || e?.value?.[0]?.error?.code === -32005;
}

async function queryWithRetry(contract, fromBlock, toBlock, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      return await contract.queryFilter(contract.filters.ReferralPaid(), fromBlock, toBlock);
    } catch (e) {
      const msg = (e?.message || "") + JSON.stringify(e?.value || []);
      if ((msg.includes("too many") || isRateLimitError(e)) && i < retries - 1) {
        const wait = 3000 * (i + 1);
        console.warn(`  RPC error chunk ${fromBlock}-${toBlock}, retry in ${wait}ms…`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
  return [];
}

async function main() {
  const { dryRun, fromBlock: fromArg } = parseArgs();

  const contractAddress = (process.env.REFERRAL_CONTRACT_ADDRESS || "").trim();
  const rpcUrl = (process.env.RPC_URL || "").trim();
  if (!contractAddress || !rpcUrl) {
    console.error("Set REFERRAL_CONTRACT_ADDRESS and RPC_URL in .env");
    process.exit(1);
  }

  const pool = getPool();
  if (!pool) {
    console.error("PostgreSQL not configured (PGHOST, PGDATABASE, PGUSER).");
    process.exit(1);
  }

  const envStart =
    process.env.REFERRAL_BACKFILL_FROM_BLOCK || process.env.REFERRAL_INDEXER_FROM_BLOCK;
  const envParsed =
    envStart != null && envStart !== "" ? Math.max(0, parseInt(String(envStart), 10) || 0) : null;
  const fromInclusive =
    fromArg != null ? fromArg : envParsed != null && !Number.isNaN(envParsed) ? envParsed : 0;

  const blocksPerQuery = Math.max(
    1,
    Math.min(2000, parseInt(process.env.REFERRAL_BACKFILL_BLOCKS_PER_QUERY || "50", 10) || 50)
  );
  const chunkDelay = Math.max(0, parseInt(process.env.REFERRAL_BACKFILL_CHUNK_DELAY_MS || "400", 10) || 400);

  console.log("=== ReferralPaid backfill (one-time) ===");
  console.log(`Contract: ${contractAddress}`);
  console.log(`RPC: ${rpcUrl.slice(0, 48)}…`);
  console.log(`From block (inclusive): ${fromInclusive} (set REFERRAL_INDEXER_FROM_BLOCK or REFERRAL_BACKFILL_FROM_BLOCK to contract creation on BscScan)`);
  console.log(`Blocks per eth_getLogs chunk: ${blocksPerQuery}`);
  console.log(`Dry run: ${dryRun}`);
  if (!dryRun) {
    console.warn(
      "\nWARNING: This calls addReferralEarning for every log — cumulative. Full re-run without clearing DB referral columns will double-count.\n"
    );
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, ABI, provider);

  const latest = await provider.getBlockNumber();
  if (fromInclusive > latest) {
    console.error(`from-block ${fromInclusive} > latest ${latest}`);
    process.exit(1);
  }

  let eventsApplied = 0;
  let fromBlock = fromInclusive;
  let chunkIx = 0;

  while (fromBlock <= latest) {
    const chunkTo = Math.min(fromBlock + blocksPerQuery - 1, latest);
    const events = await queryWithRetry(contract, fromBlock, chunkTo);
    chunkIx++;

    if (!dryRun) {
      for (const evt of events) {
        const raw = evt.args?.referrer;
        const referrer = raw ? String(raw).toLowerCase() : "";
        const level = Number(evt.args?.level ?? 0);
        const amount = evt.args?.amount ?? 0n;
        if (referrer && level >= 1 && level <= 10) {
          await User.addReferralEarning(referrer, level, amount);
          eventsApplied++;
        }
      }
    } else {
      for (const evt of events) {
        const raw = evt.args?.referrer;
        const referrer = raw ? String(raw).toLowerCase() : "";
        const level = Number(evt.args?.level ?? 0);
        if (referrer && level >= 1 && level <= 10) {
          eventsApplied++;
        }
      }
    }

    if (chunkIx % 25 === 0 || chunkTo === latest) {
      console.log(
        `… through block ${chunkTo} / ${latest} · ${eventsApplied} ReferralPaid ${dryRun ? "seen" : "applied"} (cumulative)`
      );
    }

    fromBlock = chunkTo + 1;
    if (fromBlock <= latest && chunkDelay > 0) {
      await new Promise((r) => setTimeout(r, chunkDelay));
    }
  }

  if (!dryRun) {
    await MetaPg.setLastProcessedBlockReferralPg(latest);
    console.log(`\nmeta.referralIndexer.lastProcessedBlock set to ${latest} (normal indexer continues from tip).`);
  } else {
    console.log(`\nDry run: ${eventsApplied} ReferralPaid events in range — meta NOT updated.`);
  }

  console.log("Done.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

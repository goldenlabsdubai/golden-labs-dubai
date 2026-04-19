import { ethers } from "ethers";

let providerCache = null;

function getProvider() {
  const rpc = (process.env.RPC_URL || "").trim();
  if (!rpc) return null;
  if (!providerCache) providerCache = new ethers.JsonRpcProvider(rpc);
  return providerCache;
}

/**
 * Batch-fetch receipt status for tx hashes. status 1 = success, 0 = failed.
 * @param {string[]} hashes
 * @returns {Promise<Map<string, 'success'|'failed'|'pending'|'unknown'>>}
 */
export async function getTxReceiptStatusMap(hashes) {
  const map = new Map();
  const provider = getProvider();
  const unique = [...new Set((hashes || []).filter(Boolean).map((h) => String(h).toLowerCase()))];
  if (!provider || unique.length === 0) {
    unique.forEach((h) => map.set(h, "unknown"));
    return map;
  }
  await Promise.all(
    unique.map(async (h) => {
      try {
        const r = await provider.getTransactionReceipt(h);
        if (r == null) map.set(h, "pending");
        else map.set(h, r.status === 1 ? "success" : "failed");
      } catch {
        map.set(h, "unknown");
      }
    })
  );
  return map;
}

/**
 * @param {Array<{ txHash?: string | null, type?: string }>} activities
 */
export async function enrichActivitiesWithReceiptStatus(activities) {
  if (!activities?.length) return [];
  const hashes = activities.map((a) => a.txHash).filter(Boolean);
  const statusMap = await getTxReceiptStatusMap(hashes);
  return activities.map((a) => {
    const h = a.txHash ? String(a.txHash).toLowerCase() : "";
    let txStatus = "success";
    if (h) {
      txStatus = statusMap.get(h) ?? "unknown";
    }
    return { ...a, txStatus };
  });
}

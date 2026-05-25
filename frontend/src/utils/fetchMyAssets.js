import { API } from "../config";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mergeAssetsByTokenId(existing, incoming) {
  const map = new Map();
  for (const a of existing || []) {
    if (a?.tokenId != null) map.set(String(a.tokenId), a);
  }
  for (const a of incoming || []) {
    if (a?.tokenId != null) map.set(String(a.tokenId), a);
  }
  return [...map.values()].sort((a, b) => Number(a.tokenId) - Number(b.tokenId));
}

async function loadMyAssetsOnce(token) {
  const r = await fetch(`${API}/marketplace/my-assets`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || String(r.status));
  const assets = Array.isArray(d.assets) ? d.assets : [];
  return { assets, complete: d.complete !== false, walletNftBalance: d.walletNftBalance };
}

/**
 * Loads `/marketplace/my-assets`. Merges results across polls so holdings appear one-by-one
 * while RPC catches up. Calls `onProgress(assets)` when new tokens arrive.
 */
export async function fetchMyAssetsWithRetry(token, _userState, options = {}) {
  if (!token) return [];
  const { onProgress } = options;
  const maxPolls = Math.max(1, Math.min(Number(options.maxPolls || 10), 20));
  const pollMs = Math.max(1200, Number(options.pollMs || 2200));

  try {
    let merged = [];
    let lastLen = 0;

    for (let poll = 0; poll < maxPolls; poll++) {
      const { assets, complete, walletNftBalance } = await loadMyAssetsOnce(token);
      merged = mergeAssetsByTokenId(merged, assets);
      if (merged.length > lastLen) {
        lastLen = merged.length;
        onProgress?.(merged, { complete, walletNftBalance });
      }
      if (complete || poll === maxPolls - 1) {
        return merged;
      }
      await sleep(pollMs);
    }
    return merged;
  } catch {
    return [];
  }
}

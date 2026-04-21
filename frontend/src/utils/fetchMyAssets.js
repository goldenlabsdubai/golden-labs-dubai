import { API } from "../config";

/**
 * Loads `/marketplace/my-assets`. If the API briefly returns [] while RPC/DB catches up,
 * retries once after a delay when the user is expected to hold a minted NFT.
 */
export async function fetchMyAssetsWithRetry(token, _userState) {
  if (!token) return [];
  const headers = { Authorization: `Bearer ${token}` };
  const load = async () => {
    const r = await fetch(`${API}/marketplace/my-assets`, { headers });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || String(r.status));
    return Array.isArray(d.assets) ? d.assets : [];
  };
  try {
    let assets = await load();
    // Second load after a short delay: RPC/DB can lag after mint, buy, or list; works for any logged-in user.
    if (assets.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1900));
      assets = await load();
    }
    return assets;
  } catch {
    return [];
  }
}

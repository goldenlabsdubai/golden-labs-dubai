import { ethers } from "ethers";

/**
 * Pinned JsonRpcProvider for BSC mainnet (default). Avoids ethers v6 "detect network"
 * probe spam and cold-start failures when the RPC is slow or rate-limited.
 *
 * Set CHAIN_ID in .env to override (must match RPC_URL network).
 */
export function createPinnedJsonRpcProvider(rpcUrl) {
  const url = String(rpcUrl || "").trim();
  if (!url) throw new Error("createPinnedJsonRpcProvider: empty rpcUrl");

  const raw = process.env.CHAIN_ID;
  const chainId = raw != null && String(raw).trim() !== "" ? Number.parseInt(String(raw).trim(), 10) : 56;
  const safeId = Number.isFinite(chainId) && chainId > 0 ? chainId : 56;

  return new ethers.JsonRpcProvider(url, safeId, { staticNetwork: true });
}

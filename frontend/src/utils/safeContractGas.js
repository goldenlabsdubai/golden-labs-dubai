/**
 * BSC (and many EVM chains) cap per-tx gas below the block limit (~16.7M on BSC).
 * Some RPCs return broken gas estimates (30M+) → wallets reject "gas limit too high".
 * Use estimate + buffer when sane; otherwise fall back to a fixed limit.
 */
export const MAX_SAFE_TX_GAS = 12_000_000n;

export const DEFAULT_APPROVE_GAS = 120_000n;
export const DEFAULT_MARKETPLACE_BUY_GAS = 3_000_000n;
export const DEFAULT_MARKETPLACE_LIST_GAS = 900_000n;
export const DEFAULT_MARKETPLACE_CANCEL_GAS = 400_000n;
export const DEFAULT_NFT_APPROVE_GAS = 120_000n;
export const DEFAULT_SUBSCRIBE_GAS = 800_000n;

/**
 * @param {import('viem').PublicClient} publicClient
 * @param {import('viem').EstimateContractGasParameters} estimateParams - must include `account` for most nodes
 * @param {bigint} fallbackGas
 */
export async function safeGasLimit(publicClient, estimateParams, fallbackGas) {
  try {
    const est = await publicClient.estimateContractGas(estimateParams);
    if (est > MAX_SAFE_TX_GAS) return fallbackGas;
    const buffered = (est * 120n) / 100n;
    if (buffered > MAX_SAFE_TX_GAS) return fallbackGas;
    return buffered;
  } catch {
    return fallbackGas;
  }
}

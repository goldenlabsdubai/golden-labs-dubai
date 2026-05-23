import { BSC_CHAIN_ID } from "../constants/chain";

/** Wagmi writeContract args pinned to BSC mainnet (matches deployed contracts). */
export function bscWriteParams(params) {
  return { chainId: BSC_CHAIN_ID, ...params };
}

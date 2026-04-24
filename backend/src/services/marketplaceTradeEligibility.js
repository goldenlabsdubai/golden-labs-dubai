/**
 * Marketplace list/buy/record flows must match the **configured** Subscription + NFT contracts (env addresses + RPC).
 * Uses the same reads as NFT.mint / marketplace (isSubscribed, hasMinted / balance on current collection).
 */
import { getOnChainUserStatus } from "./onChainUser.js";
import { isConfiguredBotWallet } from "./botService.js";

/**
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
export async function assertCanTradeOnConfiguredContracts(wallet) {
  const w = (wallet || "").toLowerCase();
  if (!w || !w.startsWith("0x") || w.length !== 42) {
    return { ok: false, status: 400, error: "Invalid wallet" };
  }
  if (isConfiguredBotWallet(w)) {
    return { ok: true };
  }
  const { hasSubscribed, isSuspended, hasMinted, subscriptionKnown, mintKnown } = await getOnChainUserStatus(w);
  if (!subscriptionKnown || !mintKnown) {
    return {
      ok: false,
      status: 503,
      error:
        "Could not verify your subscription and NFT against the deployed contracts. Check server RPC_URL and SUBSCRIPTION_CONTRACT_ADDRESS / NFT_CONTRACT_ADDRESS.",
    };
  }
  if (isSuspended) {
    return { ok: false, status: 403, error: "Subscription suspended. Resubscribe on-chain to trade." };
  }
  if (!hasSubscribed) {
    return { ok: false, status: 403, error: "An active subscription on the current contract is required to trade." };
  }
  if (!hasMinted) {
    return { ok: false, status: 403, error: "Mint your asset on the current NFT contract before listing or buying." };
  }
  return { ok: true };
}

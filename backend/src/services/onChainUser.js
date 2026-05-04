/**
 * Read user-related state from chain: subscription status, mint status, and trade count.
 * Used to verify before updating Firestore and to sync user state from chain in GET /user/me.
 */
import { ethers } from "ethers";
import { getMarketplaceAndReservePoolAddress } from "../config/contractsEnv.js";

function getProvider() {
  const rpc = process.env.RPC_URL || "http://127.0.0.1:8545";
  return new ethers.JsonRpcProvider(rpc);
}

const SUBSCRIPTION_ABI = [
  "function isSubscribed(address) view returns (bool)",
  "function hasSubscribed(address) view returns (bool)",
  "function isSuspended(address) view returns (bool)",
];
const NFT_ABI = [
  "function hasMinted(address) view returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];
const MARKETPLACE_ABI = ["event Sold(uint256 indexed tokenId, address seller, address buyer, uint256 price)"];

/**
 * Get subscription contract address. Expects full address (0x...).
 */
function getSubscriptionAddress() {
  const addr = (process.env.SUBSCRIPTION_CONTRACT_ADDRESS || "").trim();
  return addr?.startsWith("0x") ? addr : addr ? `0x${addr}` : null;
}

function getNftAddress() {
  const addr = (process.env.NFT_CONTRACT_ADDRESS || "").trim();
  return addr?.startsWith("0x") ? addr : addr ? `0x${addr}` : null;
}

function getMarketplaceAddress() {
  const addr = (getMarketplaceAndReservePoolAddress() || "").trim();
  return addr?.startsWith("0x") ? addr : addr ? `0x${addr}` : null;
}

const SUBSCRIPTION_PRICE_ABI = ["function subscriptionPrice() view returns (uint256)"];

/**
 * Reads SubscriptionContract.subscriptionPrice() (USDT, 6 decimals).
 * Throws if address missing, RPC fails, or price is zero — no placeholder values.
 */
export async function getSubscriptionPriceFromChain() {
  const subAddr = getSubscriptionAddress();
  if (!subAddr) {
    throw new Error("SUBSCRIPTION_CONTRACT_ADDRESS is not configured");
  }
  const provider = getProvider();
  const sub = new ethers.Contract(subAddr, SUBSCRIPTION_PRICE_ABI, provider);
  const wei = await sub.subscriptionPrice();
  const priceWei = wei.toString();
  if (priceWei === "0") {
    throw new Error("subscriptionPrice is zero on-chain");
  }
  const price = String(Number(ethers.formatUnits(wei, 6)));
  const priceFormatted = `$${price} USDT`;
  return { priceWei, price, priceFormatted, subscriptionKnown: true };
}

/**
 * Returns { hasSubscribed, isSuspended, hasMinted, buyCount, subscriptionKnown, mintKnown } for a wallet.
 * hasSubscribed = active subscription (same as contract isSubscribed(): not suspended, or bot trader on-chain).
 * isSuspended = inactivity or profit >= threshold (default $50) → must resubscribe.
 * buyCount = number of Sold events where buyer === wallet (on-chain trade count).
 * If a contract is missing or RPC fails, that field is false/0 and we don't throw.
 */
export async function getOnChainUserStatus(wallet) {
  const w = (wallet || "").toLowerCase();
  if (!w || !w.startsWith("0x") || w.length < 42) {
    return {
      hasSubscribed: false,
      isSuspended: false,
      hasMinted: false,
      buyCount: 0,
      subscriptionKnown: false,
      mintKnown: false,
    };
  }

  const result = {
    hasSubscribed: false,
    isSuspended: false,
    hasMinted: false,
    buyCount: 0,
    subscriptionKnown: false,
    mintKnown: false,
  };

  try {
    const provider = getProvider();
    const subAddr = getSubscriptionAddress();
    const nftAddr = getNftAddress();
    const marketAddr = getMarketplaceAddress();

    let hasSubscribed = false;
    let isSuspended = false;
    let subscriptionKnown = false;
    if (subAddr) {
      const sub = new ethers.Contract(subAddr, SUBSCRIPTION_ABI, provider);
      try {
        const [activeSub, suspended] = await Promise.all([
          sub.isSubscribed(w).then((b) => !!b),
          sub.isSuspended(w).then((b) => !!b),
        ]);
        hasSubscribed = activeSub;
        isSuspended = suspended;
        subscriptionKnown = true;
      } catch (_) {
        subscriptionKnown = false;
      }
    }
    let hasMinted = false;
    let mintKnown = false;
    if (nftAddr) {
      try {
        const nftC = new ethers.Contract(nftAddr, NFT_ABI, provider);
        try {
          hasMinted = !!(await nftC.hasMinted(w));
        } catch (_) {
          hasMinted = false;
        }
        // Fallback: some RPCs / older deployments — treat any NFT balance as minted (1 wallet = 1 NFT rule)
        if (!hasMinted) {
          try {
            const bal = await nftC.balanceOf(w);
            hasMinted = BigInt(bal) > 0n;
          } catch (_) {}
        }
        mintKnown = true;
      } catch (_) {
        mintKnown = false;
      }
    }
    const buyCount = marketAddr ? await countSoldEventsAsBuyer(provider, marketAddr, w) : 0;

    result.hasSubscribed = hasSubscribed;
    result.isSuspended = isSuspended;
    result.hasMinted = hasMinted;
    result.buyCount = buyCount;
    result.subscriptionKnown = subscriptionKnown;
    result.mintKnown = mintKnown;
  } catch (e) {
    console.warn("onChainUser getOnChainUserStatus:", e?.message || e);
  }

  return result;
}

async function countSoldEventsAsBuyer(provider, marketplaceAddress, buyerWallet) {
  try {
    const contract = new ethers.Contract(marketplaceAddress, MARKETPLACE_ABI, provider);
    const blockRange = 500000;
    const toBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, toBlock - blockRange);
    const events = await contract.queryFilter(contract.filters.Sold(), fromBlock, toBlock);
    const buyer = buyerWallet.toLowerCase();
    let count = 0;
    for (const e of events) {
      const b = (e.args?.buyer ?? "").toLowerCase();
      if (b === buyer) count++;
    }
    return count;
  } catch (_) {
    return 0;
  }
}

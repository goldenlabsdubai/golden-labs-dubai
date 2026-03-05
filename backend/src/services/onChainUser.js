/**
 * Read user-related state from chain: subscription status, mint status, and trade count.
 * Used to verify before updating Firestore and to sync user state from chain in GET /user/me.
 */
import { ethers } from "ethers";

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
  const addr = (process.env.MARKETPLACE_CONTRACT_ADDRESS || "").trim();
  return addr?.startsWith("0x") ? addr : addr ? `0x${addr}` : null;
}

/**
 * Returns { hasSubscribed, isSuspended, hasMinted, buyCount, subscriptionKnown, mintKnown } for a wallet.
 * hasSubscribed = ever subscribed; isSuspended = 7d inactive or profit >= $60 (need re-subscribe).
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
        const [subbed, suspended] = await Promise.all([
          sub.hasSubscribed(w).then((b) => !!b),
          sub.isSuspended(w).then((b) => !!b),
        ]);
        hasSubscribed = subbed;
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
        hasMinted = await new ethers.Contract(nftAddr, NFT_ABI, provider).hasMinted(w).then((b) => !!b);
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

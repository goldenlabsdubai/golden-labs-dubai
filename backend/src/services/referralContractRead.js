/**
 * Read ReferralContract.referrerOf(wallet) via RPC (source of truth for onboarding / profile save).
 */
import { ethers } from "ethers";
import { getReferralRpcUrl, getSharedReferralRpcProvider } from "../config/ethersRpc.js";

const REFERRAL_ABI = ["function referrerOf(address user) view returns (address)"];

/**
 * @param {string} userWallet
 * @returns {Promise<string | null>} Lowercase referrer address, or null if unset / misconfigured / RPC error
 */
export async function readReferrerOfOnChain(userWallet) {
  const contractAddr = process.env.REFERRAL_CONTRACT_ADDRESS?.trim();
  const rpcUrl = getReferralRpcUrl();
  if (!contractAddr || !rpcUrl || !userWallet) return null;
  try {
    const provider = getSharedReferralRpcProvider();
    const c = new ethers.Contract(contractAddr, REFERRAL_ABI, provider);
    const raw = userWallet.startsWith("0x") ? userWallet : `0x${userWallet}`;
    const addr = ethers.getAddress(raw);
    const ref = await c.referrerOf(addr);
    const normalized = ethers.getAddress(ref).toLowerCase();
    if (normalized === ethers.ZeroAddress.toLowerCase()) return null;
    return normalized;
  } catch (e) {
    console.warn("readReferrerOfOnChain:", e?.message || e);
    return null;
  }
}

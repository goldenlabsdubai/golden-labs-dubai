/**
 * Sync referrer from Firestore to ReferralContract so L2–L5 on-chain payouts work.
 * When we set user.referrer in the backend, we call setReferrer(user, referrer) on-chain (owner only).
 */
import { ethers } from "ethers";

const REFERRAL_ABI = [
  "function setReferrer(address user, address referrer) external",
];

/**
 * Call ReferralContract.setReferrer(userWallet, referrerWallet).
 * No-op if REFERRAL_OWNER_PRIVATE_KEY or REFERRAL_CONTRACT_ADDRESS is missing.
 * Logs and swallows errors (e.g. "Referrer already set") so auth/profile don't break.
 */
export async function syncReferrerToChain(userWallet, referrerWallet) {
  const contractAddress = process.env.REFERRAL_CONTRACT_ADDRESS;
  const privateKey = process.env.REFERRAL_OWNER_PRIVATE_KEY;
  const rpcUrl = process.env.RPC_URL;

  if (!contractAddress || !privateKey || !rpcUrl) {
    if (!privateKey && contractAddress && process.env.NODE_ENV !== "test") {
      console.warn("ReferralContractSync: REFERRAL_OWNER_PRIVATE_KEY not set; on-chain referrer not synced.");
    }
    return;
  }

  if (!userWallet || !referrerWallet || typeof userWallet !== "string" || typeof referrerWallet !== "string") return;

  const userHex = (userWallet.startsWith("0x") ? userWallet : `0x${userWallet}`).toLowerCase();
  const referrerHex = (referrerWallet.startsWith("0x") ? referrerWallet : `0x${referrerWallet}`).toLowerCase();
  if (userHex === referrerHex) return;

  try {
    const userAddr = ethers.getAddress(userHex);
    const referrerAddr = ethers.getAddress(referrerHex);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey.trim(), provider);
    const contract = new ethers.Contract(contractAddress, REFERRAL_ABI, signer);
    const tx = await contract.setReferrer(userAddr, referrerAddr);
    await tx.wait();
    console.log(`ReferralContractSync: setReferrer(${userAddr}, ${referrerAddr}) tx=${tx.hash}`);
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes("Referrer already set")) return; // already synced
    if (msg.includes("self-referral") || msg.includes("Self-referral")) return;
    console.warn("ReferralContractSync: setReferrer failed", msg);
  }
}

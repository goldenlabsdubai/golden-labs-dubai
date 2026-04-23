import { getAddress } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000";

const REFERRER_OF_ABI = [
  { name: "referrerOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "address" }] },
];

/**
 * Root of the referral chain for a marketplace sale: seller's on-chain L1 (`ReferralContract.referrerOf(seller)`).
 * Must match how `payReferral` walks `referrerOf` — not the buyer's referrer.
 */
export async function resolveSellerReferrerRoot(publicClient, referralContractAddress, sellerAddress) {
  if (!publicClient || !referralContractAddress || !sellerAddress) return ZERO;
  let seller;
  try {
    seller = getAddress(String(sellerAddress).trim());
  } catch {
    return ZERO;
  }
  try {
    const ref = await publicClient.readContract({
      address: referralContractAddress,
      abi: REFERRER_OF_ABI,
      functionName: "referrerOf",
      args: [seller],
    });
    if (!ref || ref === ZERO) return ZERO;
    return getAddress(ref);
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn("[Golden Labs] referrerOf read failed; buy will use zero referral root.", e?.message || e);
    }
    return ZERO;
  }
}

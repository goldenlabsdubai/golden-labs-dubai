/**
 * Friendly message for transaction/wallet errors.
 * When user rejects (e.g. MetaMask "Reject"), show "User rejected" instead of raw error.
 */
const USER_REJECTED_MESSAGE = "User rejected";

export function isUserRejection(error) {
  if (!error) return false;
  const msg = (error.message || error.shortMessage || String(error)).toLowerCase();
  const code = error.code ?? error.error?.code;
  if (code === 4001 || code === "4001") return true;
  if (msg.includes("user rejected") || msg.includes("user denied") || msg.includes("rejected the request") || msg.includes("rejected the transaction")) return true;
  if (msg.includes("denied transaction") || msg.includes("rejected")) return true;
  return false;
}

/**
 * @param {Error} error - Caught error
 * @param {string} fallback - Fallback message when not a user rejection
 * @returns {string} "User rejected" or fallback / error message
 */
export function getTransactionErrorMessage(error, fallback = "Something went wrong") {
  if (isUserRejection(error)) return USER_REJECTED_MESSAGE;
  const msg = (error?.message || error?.shortMessage || "").toLowerCase();
  if (msg.includes("subscription suspended")) return "Subscription suspended — resubscribe to withdraw earnings.";
  if (msg.includes("no earnings")) return "No earnings to withdraw.";
  if (msg.includes("subscription not set")) return "Referral contract not configured.";
  return error?.message || error?.shortMessage || fallback;
}

function normalizeMessage(error) {
  return (error?.message || error?.shortMessage || String(error || "")).toLowerCase();
}

export function detectInsufficientBalanceType(error) {
  const msg = normalizeMessage(error);

  // Gas/native token shortage should take priority over generic "insufficient".
  if (
    msg.includes("insufficient funds for gas") ||
    msg.includes("gas * price + value") ||
    msg.includes("intrinsic gas too low") ||
    msg.includes("insufficient balance for transfer")
  ) {
    return "bnb";
  }

  if (
    msg.includes("insufficient usdt") ||
    msg.includes("transfer amount exceeds balance") ||
    msg.includes("erc20: insufficient balance") ||
    msg.includes("insufficient token balance") ||
    (msg.includes("insufficient") && msg.includes("usdt"))
  ) {
    return "usdt";
  }

  return null;
}

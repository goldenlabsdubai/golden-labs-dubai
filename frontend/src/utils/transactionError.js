/**
 * Friendly message for transaction/wallet errors.
 * When user rejects (e.g. MetaMask "Reject"), show "User rejected" instead of raw error.
 */
const USER_REJECTED_MESSAGE = "User rejected";

export function isUserRejection(error) {
  if (!error) return false;
  const name = String(error.name || "");
  if (name === "UserRejectedRequestError" || name.includes("UserRejected")) return true;
  const msg = (error.message || error.shortMessage || String(error)).toLowerCase();
  const causeMsg = String(error.cause?.message || error.cause?.shortMessage || "").toLowerCase();
  const combined = `${msg} ${causeMsg}`;
  const code = error.code ?? error.error?.code ?? error.cause?.code;
  if (code === 4001 || code === "4001") return true;
  if (
    combined.includes("user rejected") ||
    combined.includes("user denied") ||
    combined.includes("rejected the request") ||
    combined.includes("rejected the transaction") ||
    combined.includes("request rejected")
  )
    return true;
  if (combined.includes("denied transaction") || combined.includes("action_rejected")) return true;
  if (msg.includes("rejected") && (msg.includes("user") || msg.includes("wallet") || msg.includes("request"))) return true;
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

/**
 * Map wallet / contract tx errors to insufficient modal, user-rejected modal, or inline error.
 * @param {unknown} error
 * @param {{ setInsufficientBalanceType: (v: string | null) => void; setError: (s: string) => void; refetchUsdt?: () => unknown; fallbackMessage?: string }} opts
 * @returns {boolean} true if handled by a modal (insufficient or rejected)
 */
export function applyWalletTxError(error, opts) {
  const {
    setInsufficientBalanceType,
    setError,
    refetchUsdt,
    fallbackMessage = "Transaction failed",
  } = opts || {};
  if (!setInsufficientBalanceType || !setError) return false;

  const insufficientType = detectInsufficientBalanceType(error);
  if (insufficientType) {
    setInsufficientBalanceType(insufficientType);
    if (insufficientType === "usdt") refetchUsdt?.();
    setError("");
    return true;
  }
  if (isUserRejection(error)) {
    setInsufficientBalanceType("rejected");
    setError("");
    return true;
  }
  setError(getTransactionErrorMessage(error, fallbackMessage));
  return false;
}

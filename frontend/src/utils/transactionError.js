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

/** Deep text from viem/wagmi/BaseError chains (message, shortMessage, details, metaMessages, cause, data). */
function normalizeMessage(error) {
  const parts = [];
  const seen = new Set();
  function add(v) {
    if (v == null) return;
    const s = String(v).trim();
    if (s) parts.push(s);
  }
  function walk(err, depth) {
    if (err == null || depth > 14) return;
    if (typeof err === "string") {
      add(err);
      return;
    }
    if (typeof err !== "object") return;
    if (seen.has(err)) return;
    seen.add(err);
    add(err.message);
    add(err.shortMessage);
    add(err.details);
    add(err.reason);
    if (Array.isArray(err.metaMessages)) {
      for (const m of err.metaMessages) add(m);
    }
    if (err.data != null) {
      if (typeof err.data === "string") add(err.data);
      else {
        try {
          add(JSON.stringify(err.data));
        } catch (_) {
          add(String(err.data));
        }
      }
    }
    walk(err.cause, depth + 1);
    walk(err.error, depth + 1);
  }
  walk(error, 0);
  return parts.join(" \n ").toLowerCase();
}

/**
 * Compare on-chain USDT balance to amount needed (6-decimal wei). Opens insufficient-USDT modal when balance is strictly lower.
 * @returns {boolean} true if modal was opened (caller should abort the tx flow)
 */
export function tryOpenInsufficientUsdtModal(usdtBalanceRaw, needWei, { setInsufficientBalanceType, refetchUsdt }) {
  if (usdtBalanceRaw == null || needWei == null || !setInsufficientBalanceType) return false;
  try {
    const bal = BigInt(usdtBalanceRaw);
    const need = BigInt(needWei);
    if (bal < need) {
      setInsufficientBalanceType("usdt");
      refetchUsdt?.();
      return true;
    }
  } catch (_) {
    /* ignore */
  }
  return false;
}

export function detectInsufficientBalanceType(error) {
  const msg = normalizeMessage(error);

  // ERC20 / USDT shortage — must run before generic "insufficient funds" (often used for native gas too).
  const tokenShortage =
    msg.includes("insufficient usdt") ||
    msg.includes("transfer amount exceeds balance") ||
    msg.includes("transfer amount exceeds the balance") ||
    msg.includes("erc20: transfer amount exceeds balance") ||
    msg.includes("erc20: insufficient balance") ||
    msg.includes("bep20: transfer amount exceeds balance") ||
    msg.includes("bep20: insufficient balance") ||
    msg.includes("bep20: burn amount exceeds balance") ||
    msg.includes("erc20insufficientbalance") ||
    msg.includes("insufficient token balance") ||
    (msg.includes("insufficient") && msg.includes("usdt")) ||
    (msg.includes("revert") && msg.includes("transfer") && msg.includes("exceed")) ||
    (msg.includes("execution reverted") &&
      msg.includes("exceed") &&
      (msg.includes("balance") || msg.includes("transfer")) &&
      (msg.includes("bep20") || msg.includes("erc20") || msg.includes("transfer amount") || msg.includes("safetransfer")));

  if (tokenShortage) return "usdt";

  // Native token (BNB) / gas
  if (
    msg.includes("insufficient funds for gas") ||
    msg.includes("gas * gas fee + value") ||
    msg.includes("gas * price + value") ||
    (msg.includes("total cost") && msg.includes("exceeds the balance")) ||
    msg.includes("intrinsic gas too low") ||
    msg.includes("insufficient funds for intrinsic transaction cost") ||
    msg.includes("have insufficient funds") ||
    msg.includes("insufficient funds for this transaction") ||
    msg.includes("need more funds") ||
    msg.includes("max fee per gas less than block base fee") ||
    (msg.includes("fee cap") && msg.includes("less than")) ||
    (msg.includes("insufficient funds") && !msg.includes("transfer amount exceeds")) ||
    (msg.includes("insufficient balance for transfer") && !msg.includes("transfer amount exceeds"))
  ) {
    return "bnb";
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

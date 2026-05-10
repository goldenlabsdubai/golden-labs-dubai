import { readContractUint256, formatUsdtTrim } from "./formatUsdt";

const REFERRAL_LEVELS = 10;

/** Mirrors backend sumReferralEarningsLevels — sum L1..L10 wei strings on the user object. */
export function sumReferralEarningsLevelsWei(user) {
  if (!user) return 0n;
  let s = 0n;
  for (let lvl = 1; lvl <= REFERRAL_LEVELS; lvl++) {
    const v = user[`referralEarningsL${lvl}`];
    if (v == null || v === "") continue;
    const w = readContractUint256(v);
    if (w != null) s += w;
  }
  return s;
}

/** Prefer explicit totals from API; else sum per-level columns (works with slim cached user objects). */
export function resolveReferralLifetimeWei(user, referralStats) {
  const fromStats = readContractUint256(referralStats?.referralEarningsTotal);
  if (fromStats != null) return fromStats;
  const fromUserTotal = readContractUint256(user?.referralEarningsTotal);
  if (fromUserTotal != null) return fromUserTotal;
  const summed = sumReferralEarningsLevelsWei(user);
  return summed;
}

/** Format wei as USDT amount string (no suffix) for dashboard lines that add " USDT". */
export function formatUsdtAmountForDashboard(weiLike) {
  const t = formatUsdtTrim(weiLike);
  if (t == null) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return t;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

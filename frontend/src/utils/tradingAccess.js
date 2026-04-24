/**
 * Same rule on mobile and desktop: marketplace / dashboard / leaderboard nav only after
 * the user is past mint (DB state), which is kept in sync with the configured contracts via GET /user/me.
 * Bot traders skip mint but still trade on-chain.
 */
export function canAccessTradingNav(user) {
  if (!user?.state) return false;
  return user.state === "MINTED" || user.state === "ACTIVE_TRADER";
}

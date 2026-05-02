/** Production site URL — keep in sync with Vercel primary domain (no trailing slash). */
export const SITE_ORIGIN = "https://goldenlabs.finance";

/**
 * Legacy / minor engines only; Google does not use meta keywords for ranking.
 * Still useful as an internal keyword list and for some aggregators.
 */
export const SEO_KEYWORDS = [
  "Golden Labs",
  "GLFA",
  "Golden Labs asset",
  "BNB Smart Chain",
  "BSC",
  "USDT",
  "NFT marketplace",
  "on-chain collectible",
  "mint",
  "crypto subscription",
  "referral program",
  "Web3 marketplace",
  "digital collectible",
  "token trading",
].join(", ");

const HOME = {
  title: "Golden Labs | Mint, List & Trade GLFA on BNB Smart Chain",
  description:
    "Golden Labs — subscribe with USDT, mint your Golden Labs asset (GLFA), and trade on the BNB Smart Chain marketplace. On-chain collectibles, transparent pricing, and referrals.",
};

export const SEO_DEFAULT = HOME;

/** Path keys must match React Router paths (no trailing slash except "/"). */
export const SEO_BY_PATH = {
  "/": HOME,
  "/marketplace": {
    title: "Marketplace | Golden Labs — Buy & Sell GLFA on BNB Chain",
    description:
      "Browse and trade Golden Labs assets (GLFA) with USDT on BNB Smart Chain. List your collectible or shop community listings.",
  },
  "/leaderboard": {
    title: "Leaderboard | Golden Labs — Top Community & Referrers",
    description:
      "Golden Labs leaderboard: see top referrers and community activity on the GLFA marketplace and BNB Smart Chain.",
  },
  "/dashboard": {
    title: "My Dashboard | Golden Labs — Portfolio & Activity",
    description:
      "Your Golden Labs dashboard: assets, referrals, and marketplace activity. Manage your GLFA on BNB Smart Chain.",
  },
  "/subscription": {
    title: "Subscribe | Golden Labs — USDT Membership for Mint & Trade",
    description:
      "Subscribe with USDT to unlock Golden Labs minting and full marketplace access. GLFA collectibles on BNB Smart Chain.",
  },
  "/mint": {
    title: "Mint | Golden Labs — Claim Your GLFA Collectible",
    description:
      "Mint your Golden Labs asset (GLFA) after subscribing — transparent minting on BNB Smart Chain with USDT.",
  },
  "/profile": {
    title: "My Profile | Golden Labs",
    description:
      "Edit your Golden Labs profile and how you appear on the marketplace and leaderboard.",
  },
  "/profile/setup": {
    title: "Profile Setup | Golden Labs — Wallet & Username",
    description:
      "Set up your Golden Labs username and sign in with your wallet to access subscription, mint, and marketplace.",
  },
};

export function seoForLocation(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (SEO_BY_PATH[path]) return { ...SEO_BY_PATH[path] };

  const userMatch = path.match(/^\/user\/([^/]+)$/);
  if (userMatch) {
    const handle = decodeURIComponent(userMatch[1]);
    return {
      title: `${handle} | Golden Labs Profile`,
      description: `Public profile for ${handle} on Golden Labs — GLFA marketplace and community on BNB Smart Chain.`,
    };
  }

  return { ...SEO_DEFAULT };
}

export function canonicalUrl(pathname) {
  const path = pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  if (!path || path === "/") return `${SITE_ORIGIN}/`;
  return `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

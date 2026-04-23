/** Backend `/api` base. In dev, default to same-origin `/api` when unset — requires `vite.config` proxy to the Node server. */
export const API =
  (import.meta.env.VITE_API_URL || "").trim() ||
  (import.meta.env.DEV ? "/api" : "");

/** BNB logo — `frontend/public/bnb_logo.png` (wallet balance, modals). */
export const BNB_LOGO_PUBLIC = "/bnb_logo.png";

/** MarketplaceAndReservePoolContract – single address for marketplace + reserve (legacy: VITE_MARKETPLACE_CONTRACT). */
export const MARKETPLACE_AND_RESERVE_POOL_ADDRESS = (
  import.meta.env.VITE_MARKETPLACE_AND_RESERVE_POOL_CONTRACT_ADDRESS ||
  import.meta.env.VITE_MARKETPLACE_CONTRACT ||
  ""
).trim();

/** Block explorer base URLs by `chainId` (EIP-155) for address/tx links. */
export const EXPLORER_BY_CHAIN = {
  1: "https://etherscan.io",
  56: "https://bscscan.com",
  97: "https://testnet.bscscan.com",
  137: "https://polygonscan.com",
  8453: "https://basescan.org",
};

/** Fallback / placeholder image for panels (Mint, Subscription, Profile). Public path. */
export const ASSET_IMAGE = "/gldass.png";

/**
 * Same-origin NFT clip from `frontend/public/nft asset.mp4` (space → %20 in URL).
 * Vercel/build copies `public/` to site root — reliable, no CORS vs API.
 */
export const ASSET_VIDEO_PUBLIC = "/nft%20asset.mp4";

/**
 * NFT card video: optional override, else public asset above.
 * Set VITE_ASSET_VIDEO_URL only if you host the clip elsewhere (CDN full URL).
 */
export const ASSET_VIDEO =
  (import.meta.env.VITE_ASSET_VIDEO_URL || "").trim() || ASSET_VIDEO_PUBLIC;

/** When true, NFT cards always play `ASSET_VIDEO` — ignore metadata still images. */
export const NFT_MEDIA_USE_UPLOAD_CLIP_ONLY =
  String(import.meta.env.VITE_NFT_MEDIA_USE_UPLOAD_CLIP_ONLY ?? "true").toLowerCase() === "true";

/** Backend origin (no /api). Use for avatar URLs when avatar is stored as relative path. Set VITE_API_URL in .env. */
export const API_ORIGIN = API ? API.replace(/\/api\/?$/, "") : "";

/** Avatar display URL: use as-is if absolute, else prepend backend origin so image loads. */
export function getAvatarUrl(avatar) {
  if (!avatar || typeof avatar !== "string") return "";
  const trimmed = avatar.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `${API_ORIGIN}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

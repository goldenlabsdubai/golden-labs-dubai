export const API = import.meta.env.VITE_API_URL ?? "";

/** MarketplaceAndReservePoolContract – single address for marketplace + reserve (legacy: VITE_MARKETPLACE_CONTRACT). */
export const MARKETPLACE_AND_RESERVE_POOL_ADDRESS = (
  import.meta.env.VITE_MARKETPLACE_AND_RESERVE_POOL_CONTRACT_ADDRESS ||
  import.meta.env.VITE_MARKETPLACE_CONTRACT ||
  ""
).trim();

/** Fallback / placeholder image for panels (Mint, Subscription, Profile). Public path. */
export const ASSET_IMAGE = "/gldass.png";

/**
 * NFT card fallback video when metadata/IPFS fails.
 * 1) VITE_ASSET_VIDEO_URL if set (e.g. https://api…/uploads/nft-asset.mp4)
 * 2) Else derive from API origin: …/uploads/nft-asset.mp4 (file must exist on backend)
 * 3) Else public: /nft-asset.mp4 (add frontend/public/nft-asset.mp4 for local dev)
 */
export const ASSET_VIDEO =
  (import.meta.env.VITE_ASSET_VIDEO_URL || "").trim() ||
  (API ? `${API.replace(/\/api\/?$/i, "")}/uploads/nft-asset.mp4` : "") ||
  "/nft-asset.mp4";

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

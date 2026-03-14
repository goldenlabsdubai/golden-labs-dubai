export const API = import.meta.env.VITE_API_URL ?? "";

/** Fallback / placeholder image for panels (Mint, Subscription, Profile). Public path. */
export const ASSET_IMAGE = "/gldass.png";

/** NFT asset video – fallback in NFT cards when metadata fails. Use VITE_ASSET_VIDEO_URL for full URL (e.g. backend/CDN); else same-origin public path. */
export const ASSET_VIDEO = import.meta.env.VITE_ASSET_VIDEO_URL?.trim() || "/nft%20asset.mp4";

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

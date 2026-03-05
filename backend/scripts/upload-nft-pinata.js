/**
 * Upload the single .mp4 NFT asset to Pinata (one pin = no account limit issue).
 * Metadata for tokens 1–10000 is served dynamically by the backend (no 10k files on IPFS).
 *
 * Run from backend: npm run upload-nft-pinata
 *
 * Requires in backend/.env:
 *   PINATA_JWT=...   (from Pinata dashboard > API Keys > New Key > copy JWT)
 *
 * Optional:
 *   NFT_UPLOAD_MP4_PATH=../frontend/public/nft asset.mp4   (default)
 *
 * After upload, set in backend/.env:
 *   NFT_MP4_CID=<printed cid>
 *
 * Backend will then serve metadata for tokenId 1–10000 at /api/marketplace/nft-metadata/:tokenId
 * (same .mp4 for every token).
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PinataSDK } from "pinata";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const JWT = (process.env.PINATA_JWT || process.env.PINATA_API_KEY || "").trim();
const MP4_SOURCE = process.env.NFT_UPLOAD_MP4_PATH || path.join(__dirname, "../../frontend/public/nft asset.mp4");

async function main() {
  if (!JWT) {
    console.error("Missing PINATA_JWT (or PINATA_API_KEY) in backend/.env");
    process.exit(1);
  }

  if (!fs.existsSync(MP4_SOURCE)) {
    console.error("MP4 not found at:", MP4_SOURCE);
    console.error("Set NFT_UPLOAD_MP4_PATH in .env to your .mp4 path (relative to backend).");
    process.exit(1);
  }

  const mp4Resolved = path.resolve(MP4_SOURCE);
  console.log("MP4 source (one file for 10k supply):", mp4Resolved);

  const pinataGateway = process.env.IPFS_GATEWAY || "https://gateway.pinata.cloud";
  const pinata = new PinataSDK({
    pinataJwt: JWT,
    pinataGateway,
  });

  const mp4Buffer = fs.readFileSync(MP4_SOURCE);
  const singleFile = new File([mp4Buffer], "nft-asset.mp4", { type: "video/mp4" });

  console.log("Uploading 1 file to Pinata...");
  const result = await pinata.upload.public.fileArray([singleFile]);

  const cid = result.cid || result.IpfsHash;
  if (!cid) {
    console.error("No CID in response:", result);
    process.exit(1);
  }

  console.log("\n--- Success ---");
  console.log("CID (the .mp4):", cid);
  console.log("\nSet in backend/.env:");
  console.log("NFT_MP4_CID=" + cid);
  console.log("\nThen restart the backend. Metadata for tokens 1–10000 will be served from your API (same video for all).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

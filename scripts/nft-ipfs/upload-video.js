/**
 * Upload your NFT .mp4 to Pinata. Use the returned CID as NFT_MP4_CID in backend/.env, then run generate.
 * Usage: node upload-video.js   (uses frontend/public/nft asset.mp4 or backend/uploads/nft-asset.mp4)
 * Or: VIDEO_PATH=/path/to/video.mp4 node upload-video.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PinataSDK } from "pinata";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
if (!process.env.PINATA_JWT?.trim()) {
  const backendEnv = path.join(__dirname, "..", "..", "backend", ".env");
  if (fs.existsSync(backendEnv)) dotenv.config({ path: backendEnv });
}

const jwt = (process.env.PINATA_JWT || process.env.PINATA_API_JWT || "").trim();
const gateway = process.env.PINATA_GATEWAY || "gateway.pinata.cloud";

if (!jwt) {
  console.error("Missing PINATA_JWT. Set it in backend/.env");
  process.exit(1);
}

const projectRoot = path.join(__dirname, "..", "..");
const defaultPaths = [
  path.join(projectRoot, "frontend", "public", "nft asset.mp4"),
  path.join(projectRoot, "backend", "uploads", "nft-asset.mp4"),
];
const videoPath = process.env.VIDEO_PATH || defaultPaths.find((p) => fs.existsSync(p));

if (!videoPath || !fs.existsSync(videoPath)) {
  console.error("Video not found. Put your .mp4 at:");
  console.error("  frontend/public/nft asset.mp4");
  console.error("  or backend/uploads/nft-asset.mp4");
  console.error("Or set VIDEO_PATH=/path/to/video.mp4");
  process.exit(1);
}

const pinata = new PinataSDK({ pinataJwt: jwt, pinataGateway: gateway });
const name = path.basename(videoPath);
const content = fs.readFileSync(videoPath);
const file = new File([content], name, { type: "video/mp4" });

console.log("Uploading .mp4 to Pinata:", videoPath);
try {
  const upload = await pinata.upload.public.file(file);
  const cid = upload?.cid || upload?.IpfsHash;
  if (!cid) throw new Error("No CID in response");
  console.log("\n--- Video uploaded ---");
  console.log("CID:", cid);
  console.log("\nSet in backend/.env:");
  console.log("NFT_MP4_CID=" + cid);
  console.log("\nThen run: npm run generate   and then  npm run upload");
} catch (err) {
  console.error("Upload failed:", err.message || err);
  process.exit(1);
}

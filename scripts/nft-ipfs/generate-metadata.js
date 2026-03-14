/**
 * Generate 1.json … 10000.json for GLFA (Golden Labs Finance).
 * Each file: "animation_url" = .mp4 on IPFS, "image" = same (fallback). Video NFT, not GIF.
 * Run: npm run generate   (from scripts/nft-ipfs)
 * Requires: VIDEO_CID or NFT_MP4_CID in .env (your .mp4 uploaded to IPFS)
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
// Allow using backend .env for NFT_MP4_CID
if (!process.env.VIDEO_CID?.trim() && !process.env.NFT_MP4_CID?.trim()) {
  const backendEnv = path.join(__dirname, "..", "..", "backend", ".env");
  if (fs.existsSync(backendEnv)) dotenv.config({ path: backendEnv });
}

const OUT_DIR = path.join(__dirname, "output");
const MAX = 10_000;

const videoCid = (process.env.VIDEO_CID || process.env.NFT_MP4_CID || process.env.GIF_CID || "").trim();
if (!videoCid) {
  console.error("Missing VIDEO_CID or NFT_MP4_CID. Set in .env or backend/.env (your .mp4 IPFS CID)");
  process.exit(1);
}
const videoUrl = videoCid.startsWith("ipfs://") ? videoCid : `ipfs://${videoCid}`;

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

console.log(`Generating 1.json … ${MAX}.json (video: ${videoUrl}) …`);
for (let i = 1; i <= MAX; i++) {
  const metadata = {
    name: `GLFA #${i}`,
    description: "Golden Labs Finance. One of 10,000.",
    image: videoUrl,
    animation_url: videoUrl,
    attributes: [
      { trait_type: "Collection", value: "Golden Labs Finance" },
      { trait_type: "Symbol", value: "GLFA" },
      { trait_type: "Number", value: String(i) },
    ],
  };
  fs.writeFileSync(path.join(OUT_DIR, `${i}.json`), JSON.stringify(metadata, null, 0), "utf8");
  if (i % 2000 === 0) console.log(`  … ${i}/${MAX}`);
}
console.log(`Done. ${MAX} files in ${OUT_DIR}`);
console.log("Next: npm run upload");

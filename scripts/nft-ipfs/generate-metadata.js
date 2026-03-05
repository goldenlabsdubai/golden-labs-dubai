/**
 * Generate 1.json … 10000.json for GLFA (Golden Labs Finance).
 * Each file: { "name": "GLFA #1", "description": "...", "image": "ipfs://GIF_CID", "attributes": [...] }
 * Run: npm run generate   (from scripts/nft-ipfs) or node generate-metadata.js
 * Requires: GIF_CID in .env or env (your GIF uploaded to IPFS)
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
const OUT_DIR = path.join(__dirname, "output");
const MAX = 10_000;

const gifCid = process.env.GIF_CID || process.env.NFT_GIF_CID;
if (!gifCid || !gifCid.trim()) {
  console.error("Missing GIF_CID. Set it in .env or: GIF_CID=QmYourGifCID node generate-metadata.js");
  process.exit(1);
}
const imageUrl = gifCid.startsWith("ipfs://") ? gifCid : `ipfs://${gifCid.trim()}`;

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

console.log(`Generating 1.json … ${MAX}.json (image: ${imageUrl}) …`);
for (let i = 1; i <= MAX; i++) {
  const metadata = {
    name: `GLFA #${i}`,
    description: "Golden Labs Finance. One of 10,000.",
    image: imageUrl,
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
console.log("Next: npm run upload   (or use w3 CLI: w3 up ./output)");

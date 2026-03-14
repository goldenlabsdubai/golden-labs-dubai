/**
 * Upload the ./output folder (1.json … 10000.json) to Pinata IPFS via CLI.
 * Run from project root: node scripts/nft-ipfs/upload-pinata.js
 * Or from scripts/nft-ipfs: npm run upload
 * JWT: from scripts/nft-ipfs/.env (PINATA_JWT) or backend/.env (PINATA_JWT)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PinataSDK } from "pinata";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "output");

// Load JWT: first scripts/nft-ipfs/.env, then backend/.env (one place to maintain)
dotenv.config({ path: path.join(__dirname, ".env") });
if (!process.env.PINATA_JWT?.trim()) {
  const backendEnv = path.join(__dirname, "..", "..", "backend", ".env");
  if (fs.existsSync(backendEnv)) {
    dotenv.config({ path: backendEnv });
  }
}

const jwt = (process.env.PINATA_JWT || process.env.PINATA_API_JWT || "").trim();
const gateway = process.env.PINATA_GATEWAY || "gateway.pinata.cloud";

if (!jwt) {
  console.error("Missing PINATA_JWT. Set it in backend/.env or scripts/nft-ipfs/.env");
  process.exit(1);
}

if (!fs.existsSync(OUT_DIR)) {
  console.error("No ./output folder. Run: npm run generate   from scripts/nft-ipfs");
  process.exit(1);
}

const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".json")).sort((a, b) => Number(a.replace(".json", "")) - Number(b.replace(".json", "")));
if (files.length === 0) {
  console.error("No .json files in ./output. Run: npm run generate   from scripts/nft-ipfs");
  process.exit(1);
}

const BATCH_SIZE = Number(process.env.UPLOAD_BATCH_SIZE) || 500; // Pinata limit – if 500 fails, try UPLOAD_BATCH_SIZE=100
const pinata = new PinataSDK({ pinataJwt: jwt, pinataGateway: gateway });
const cids = [];

for (let start = 0; start < files.length; start += BATCH_SIZE) {
  const batch = files.slice(start, start + BATCH_SIZE);
  const fileObjects = batch.map((name) => {
    const content = fs.readFileSync(path.join(OUT_DIR, name), "utf8");
    return new File([content], name, { type: "application/json" });
  });
  const batchNum = Math.floor(start / BATCH_SIZE) + 1;
  console.log(`Uploading batch ${batchNum}: ${batch[0]} … ${batch[batch.length - 1]} (${batch.length} files)`);
  try {
    const upload = await pinata.upload.public.fileArray(fileObjects);
    const cid = upload?.cid || upload?.IpfsHash;
    if (!cid) {
      console.error("Upload response:", upload);
      process.exit(1);
    }
    cids.push(cid);
  } catch (err) {
    console.error("Upload failed:", err.message || err);
    if (err.response?.data) console.error("Details:", err.response.data);
    process.exit(1);
  }
}

console.log("\n--- SUCCESS ---");
console.log("Batches:", cids.length, "| Total files:", files.length);
console.log("\nSet in backend .env:");
if (cids.length === 1) {
  console.log("NFT_METADATA_BASE_URI=" + cids[0]);
} else {
  console.log("NFT_METADATA_BASE_URIS=" + cids.join(","));
  console.log(`# Backend: NFT_METADATA_BATCH_SIZE=${BATCH_SIZE} (tokens per CID).`);
}
console.log("\nThen restart backend.");

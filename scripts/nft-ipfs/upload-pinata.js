/**
 * Upload the ./output folder (1.json … 10000.json) to Pinata IPFS.
 * Run: npm run upload   from scripts/nft-ipfs
 * Requires: PINATA_JWT and optional PINATA_GATEWAY in .env
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PinataSDK } from "pinata";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "output");

const jwt = process.env.PINATA_JWT || process.env.PINATA_API_JWT;
const gateway = process.env.PINATA_GATEWAY || "gateway.pinata.cloud";

if (!jwt || !jwt.trim()) {
  console.error("Missing PINATA_JWT. Get a free JWT at https://app.pinata.cloud → API Keys.");
  process.exit(1);
}

if (!fs.existsSync(OUT_DIR)) {
  console.error("No ./output folder. Run: npm run generate");
  process.exit(1);
}

const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".json")).sort((a, b) => Number(a.replace(".json", "")) - Number(b.replace(".json", "")));
if (files.length === 0) {
  console.error("No .json files in ./output. Run: npm run generate");
  process.exit(1);
}

console.log(`Uploading ${files.length} files to Pinata …`);
const pinata = new PinataSDK({
  pinataJwt: jwt.trim(),
  pinataGateway: gateway,
});

// Pinata fileArray expects File objects. In Node 18+ File is global.
const fileObjects = files.map((name) => {
  const content = fs.readFileSync(path.join(OUT_DIR, name), "utf8");
  return new File([content], name, { type: "application/json" });
});

// Upload in one folder (Pinata returns one CID for the folder)
try {
  const upload = await pinata.upload.public.fileArray(fileObjects);
  const cid = upload?.cid || upload?.IpfsHash;
  if (!cid) {
    console.error("Upload response:", upload);
    process.exit(1);
  }
  console.log("\n--- SUCCESS ---");
  console.log("Folder CID:", cid);
  console.log("Files:     ", files.length);
  console.log("\nSet in backend .env:");
  console.log("NFT_METADATA_BASE_URI=" + cid);
  console.log("\nThen restart backend. Mint page will use GLFA #1 … GLFA #10000.");
} catch (err) {
  console.error("Upload failed:", err.message || err);
  if (err.message && err.message.includes("limit")) {
    console.log("Tip: Pinata free tier may limit request size. Try uploading in 2 batches (1-5000, 5001-10000) or use w3 CLI: npx w3 up ./output");
  }
  process.exit(1);
}

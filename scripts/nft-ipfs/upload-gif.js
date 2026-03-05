/**
 * Upload your single GIF file to Pinata. Use the returned CID as GIF_CID for generate-metadata.
 * Usage: Put your GIF in this folder as "glfa.gif" (or set GIF_PATH), then run: node upload-gif.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PinataSDK } from "pinata";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.join(__dirname, "glfa.gif");
const gifPath = process.env.GIF_PATH || defaultPath;

const jwt = process.env.PINATA_JWT || process.env.PINATA_API_JWT;
const gateway = process.env.PINATA_GATEWAY || "gateway.pinata.cloud";

if (!jwt?.trim()) {
  console.error("Missing PINATA_JWT. Set it in .env (get free JWT at https://app.pinata.cloud → API Keys).");
  process.exit(1);
}
if (!fs.existsSync(gifPath)) {
  console.error("GIF file not found:", gifPath);
  console.error("Put your GIF here as glfa.gif, or set GIF_PATH=/path/to/your.gif");
  process.exit(1);
}

const pinata = new PinataSDK({ pinataJwt: jwt.trim(), pinataGateway: gateway });
const name = path.basename(gifPath);
const content = fs.readFileSync(gifPath);
const file = new File([content], name, { type: "image/gif" });

console.log("Uploading GIF to Pinata …");
try {
  const upload = await pinata.upload.public.file(file);
  const cid = upload?.cid || upload?.IpfsHash;
  if (!cid) throw new Error("No CID in response");
  console.log("\n--- GIF uploaded ---");
  console.log("CID:", cid);
  console.log("Set in .env: GIF_CID=" + cid);
  console.log("Then run: npm run generate && npm run upload");
} catch (err) {
  console.error("Upload failed:", err.message || err);
  process.exit(1);
}

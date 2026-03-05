/**
 * Upload ./output folder to web3.storage (free, no file limit).
 * Use this when Pinata hits "pin limit" (e.g. 10k files).
 *
 * One-time setup: run the commands below, then run: npm run upload-w3
 *
 *   npx @web3-storage/w3cli space create glfa
 *   npx @web3-storage/w3cli space register your@email.com
 *
 * Then: npm run upload-w3
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "output");

if (!fs.existsSync(OUT_DIR)) {
  console.error("No ./output folder. Run: npm run generate");
  process.exit(1);
}

const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.error("No .json files in ./output. Run: npm run generate");
  process.exit(1);
}

console.log(`Uploading ${files.length} files to web3.storage (free, no limit) …`);
console.log("(First time? Run: npx @web3-storage/w3cli space create glfa");
console.log("              then: npx @web3-storage/w3cli space register your@email.com)\n");

// Use relative path "output" so paths with spaces (e.g. "Golden Labs") don't break the CLI
process.chdir(__dirname);
const r = spawnSync("npx", ["-y", "@web3-storage/w3cli", "up", "output"], {
  encoding: "utf8",
  shell: true,
  maxBuffer: 20 * 1024 * 1024,
});
const combined = (r.stdout || "") + (r.stderr || "");

if (r.status !== 0) {
  console.error(combined);
  if (combined.includes("register") || combined.includes("space") || combined.includes("login") || combined.includes("Register")) {
    console.log("\n--- One-time setup ---");
    console.log("1. npx @web3-storage/w3cli space create glfa");
    console.log("2. npx @web3-storage/w3cli space register your@email.com");
    console.log("3. Check your email and confirm");
    console.log("4. Run: npm run upload-w3");
  }
  process.exit(1);
}

// Parse CID from output (w3s.link/ipfs/CID or bafy... or Qm...)
const cidMatch = combined.match(/(?:ipfs\/|w3s\.link\/ipfs\/)([Qmb][a-zA-Z0-9]{44,})/i) || combined.match(/(bafy[a-zA-Z0-9]{50,})/) || combined.match(/(Qm[a-zA-Z0-9]{44,})/);
const cid = cidMatch ? cidMatch[1].trim() : null;
if (cid) {
  console.log("\n--- SUCCESS ---");
  console.log("Folder CID:", cid);
  console.log("\nSet in backend .env:");
  console.log("NFT_METADATA_BASE_URI=" + cid);
} else {
  console.log(combined);
  console.log("\nLook for a CID (starts with Qm or bafy) in the output above and set NFT_METADATA_BASE_URI in backend .env");
}

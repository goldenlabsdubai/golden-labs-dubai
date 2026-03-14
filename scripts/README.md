# Scripts (offline / one-time tooling)

This folder contains **utility scripts** that are **not part of the live app**. They are not run on EC2 or in production.

| Folder | Purpose | Run where? | .env on EC2? |
|--------|---------|------------|--------------|
| **nft-ipfs** | Generate 10k NFT metadata (1.json–10000.json) and upload GIF + folder to Pinata. You use the output CID in **backend** `.env` as `NFT_METADATA_BASE_URI`. | Your local machine (or CI) when you need to prepare/update NFT metadata | **No** – only run locally; set `.env` in `scripts/nft-ipfs/` on the machine where you run the scripts |

**Backend** scripts (migrate DB, test PG, upload NFT, seed admins) live in **`backend/scripts/`** and use **`backend/.env`**. Those are the ones that matter on EC2 if you run them there (e.g. `node scripts/test-pg.js`).

**Summary:** The repo includes `scripts/` so the team can run the NFT metadata tooling when needed. You do **not** need to set `scripts/nft-ipfs/.env` on EC2; the running app only uses **backend** `.env`.

# Setup steps – complete before restarting backend

Do these in order, then restart the backend (and rebuild frontend if you changed .env).

---

## 1. Backend (local) – DONE
- [x] Pinata API Key, Secret, JWT in `backend/.env`
- [x] `IPFS_GATEWAY` and `IPFS_GATEWAY_KEY` in `backend/.env`
- [x] Fallback video: `backend/uploads/nft-asset.mp4` (renamed from "nft asset.mp4")

---

## 2. Pinata – verify content
- [ ] In **Pinata dashboard** → **Files**, open the folder with CID:  
  `bafybeieankjdrs7xlzighrgmbwwh5263ihoydg3zam753wgxze2h2hcydm`
- [ ] Confirm it contains `1.json`, `2.json`, … (or your token range).  
  If not, upload your metadata folder to Pinata and set `NFT_METADATA_BASE_URI` in `.env` to the new folder CID (no `ipfs://`).

---

## 3. EC2 / production backend
Copy these into `backend/.env` **on the server** (same values as local, or production-specific):

```env
BACKEND_URL=https://api.goldenlabs.finance

# Pinata (same as local)
IPFS_GATEWAY=https://green-cautious-whippet-586.mypinata.cloud/ipfs
IPFS_GATEWAY_KEY=<same JWT as in local .env>
PINATA_API_KEY=7e7ae6475f7ed8c068d6
PINATA_API_SECRET=<your secret>
PINATA_JWT=<same JWT as in local .env>

# NFT metadata CID (folder that has 1.json, 2.json, …)
NFT_METADATA_BASE_URI=bafybeieankjdrs7xlzighrgmbwwh5263ihoydg3zam753wgxze2h2hcydm

# Optional: if you use one .mp4 for all tokens, backend serves metadata from /api/marketplace/nft-metadata/:id
NFT_MP4_CID=bafybeic36vqj2s5fhuu2cq42hccqf5jlucomsgttq2t25lwvps4igou4we
```

- [ ] On EC2: copy `backend/uploads/nft-asset.mp4` to the server at `backend/uploads/nft-asset.mp4` (or upload after deploy).

---

## 4. Frontend (local & production)
- [x] `frontend/.env` has `VITE_ASSET_VIDEO_URL=https://api.goldenlabs.finance/uploads/nft-asset.mp4`
- [x] `VITE_IPFS_GATEWAY=https://green-cautious-whippet-586.mypinata.cloud/ipfs`
- [ ] If you deploy frontend (e.g. Vercel), add the same `VITE_*` vars in the host’s environment.

---

## 5. Optional – avoid RPC 429
- [ ] In `frontend/.env`, `VITE_BSC_TESTNET_RPC_URL` is already set to Alchemy. If you still see 429, add another RPC (e.g. `https://bsc-testnet.publicnode.com`) or use a paid tier.

---

## 6. After all steps
- Restart **backend** (local and EC2).
- Rebuild and redeploy **frontend** if you changed any `VITE_*` in `.env`.
- Test: open marketplace, check NFT metadata loads (no 404/401). Test fallback video on a card where metadata fails.

# GLFA NFT – Generate 10k metadata & upload to IPFS (free)

This folder generates **1.json … 10000.json** (GLFA #1 … GLFA #10000) and uploads them to **Pinata** (free tier). One GIF for all; same image in every metadata file.

---

## 1. Get a free Pinata account

1. Go to **[pinata.cloud](https://pinata.cloud)** → Sign up (free).
2. **API Keys:** Dashboard → API Keys → New Key → enable **pinFileToIPFS** (and pinJSON if you want). Copy the **JWT**.
3. (Optional) **Upload your GIF** in the Pinata dashboard: Files → Upload → select your `.gif` → copy the **CID** (e.g. `QmGifXXX`).  
   Or use the script below to upload the GIF from your PC.

---

## 2. Setup

From the **project root** (or from `scripts/nft-ipfs`):

```bash
cd scripts/nft-ipfs
npm install
```

Create a **`.env`** file in `scripts/nft-ipfs/`:

```env
# From Pinata: API Keys → New Key → copy JWT
PINATA_JWT=your_pinata_jwt_here

# Your GIF's IPFS CID (upload GIF in Pinata dashboard first, or use upload-gif.js)
GIF_CID=QmYourGifCidHere
```

- **GIF_CID:** Upload your Golden Labs GIF to Pinata (Files → Upload), then paste its CID here.  
  Or put your GIF in this folder as **`glfa.gif`** and run **`node upload-gif.js`** – it will print the CID; put that in `.env` as `GIF_CID`.

---

## 3. Generate metadata (1.json … 10000.json)

```bash
npm run generate
```

This writes **1.json … 10000.json** into `scripts/nft-ipfs/output/` (each has `"name": "GLFA #1"`, … `"GLFA #10000"`, same `"image": "ipfs://YOUR_GIF_CID"`).

---

## 4. Upload folder to Pinata

```bash
npm run upload
```

This uploads the `output/` folder to Pinata and prints the **folder CID** (e.g. `QmFolderYYY`).

---

## 5. One command (generate + upload)

```bash
npm run generate-and-upload
```

Runs generate then upload. At the end you’ll see something like:

```
NFT_METADATA_BASE_URI=QmFolderYYY
```

---

## 6. Use the CID in your app

In your **backend `.env`** (project root or backend folder), set:

```env
NFT_METADATA_BASE_URI=QmFolderYYY
```

Restart the backend. The Mint page will use **GLFA #1**, **GLFA #2**, … **GLFA #10000** and the same GIF for all.

---

## Optional: Upload GIF from CLI

1. Put your GIF in this folder and name it **`glfa.gif`** (or set `GIF_PATH=/path/to/file.gif` in `.env`).
2. Run:

```bash
node upload-gif.js
```

3. Copy the printed CID into `.env` as **`GIF_CID=...`**, then run **`npm run generate`** and **`npm run upload`**.

---

## If Pinata hits "pin limit" (e.g. 10k files)

Use **web3.storage** (free, no file limit):

1. **One-time setup** (from `scripts/nft-ipfs`):

```bash
npx @web3-storage/w3cli space create glfa
npx @web3-storage/w3cli space register your@email.com
```

Check your email and confirm.

2. **Upload** (after `npm run generate`):

```bash
npm run upload-w3
```

3. Copy the printed **folder CID** into backend `.env` as **`NFT_METADATA_BASE_URI=...`**.

---

## Summary

| Step | Command |
|------|--------|
| Install | `cd scripts/nft-ipfs && npm install` |
| Set .env | `PINATA_JWT=...` and `GIF_CID=...` |
| (Optional) Upload GIF | `node upload-gif.js` → set `GIF_CID` |
| Generate 10k JSON | `npm run generate` |
| Upload to Pinata | `npm run upload` |
| Backend | Set `NFT_METADATA_BASE_URI=<folder CID>` in backend `.env` |

You’re done: 10,000 NFTs, one GIF, names **GLFA #1** … **GLFA #10000**, all on free Pinata IPFS.

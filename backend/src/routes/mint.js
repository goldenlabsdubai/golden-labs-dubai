import { Router } from "express";
import { ethers } from "ethers";
import * as User from "../services/user.js";
import { getOnChainUserStatus } from "../services/onChainUser.js";

const router = Router();

router.get("/config", async (_, res) => {
  const metadataBasePath = (process.env.NFT_METADATA_BASE_URI || "").trim();
  const metadataUri = (process.env.NFT_METADATA_URI || "").trim();
  const nftName = process.env.NFT_NAME || "Golden Labs Finance";
  const nftSymbol = process.env.NFT_SYMBOL || "GLFA";
  const contractAddress = process.env.NFT_CONTRACT_ADDRESS || "";
  const rpcUrl = process.env.RPC_URL;

  if (!contractAddress || !rpcUrl) {
    return res.status(503).json({
      error: "NFT_CONTRACT_ADDRESS and RPC_URL are required to read mint price from chain",
      mintPriceKnown: false,
    });
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const nft = new ethers.Contract(
      contractAddress,
      [
        "function totalMinted() view returns (uint256)",
        "function MAX_SUPPLY() view returns (uint256)",
        "function mintPrice() view returns (uint256)",
      ],
      provider
    );
    const [totalMintedRaw, maxSupplyRaw, mintPriceRaw] = await Promise.all([
      nft.totalMinted(),
      nft.MAX_SUPPLY(),
      nft.mintPrice(),
    ]);
    const totalSupply = Number(totalMintedRaw);
    const maxSupply = Number(maxSupplyRaw);
    const mintPriceWei = mintPriceRaw.toString();
    if (mintPriceWei === "0") {
      return res.status(503).json({ error: "NFT mintPrice is zero on-chain", mintPriceKnown: false });
    }
    const mintPriceUsdt = (Number(mintPriceWei) / 1e6).toFixed(6).replace(/\.?0+$/, "");

    res.json({
      price: mintPriceUsdt,
      priceWei: mintPriceWei,
      priceFormatted: `$${mintPriceUsdt} USDT`,
      mintPriceKnown: true,
      rule: "1 Wallet = 1 NFT (lifetime)",
      contractAddress,
      metadataUri: metadataUri || undefined,
      metadataBasePath: metadataBasePath || undefined,
      nftName,
      nftSymbol,
      totalSupply,
      maxSupply,
    });
  } catch (e) {
    console.warn("mint /config:", e?.message || e);
    res.status(503).json({
      error: e?.message || "Failed to read mint price from chain",
      mintPriceKnown: false,
      contractAddress,
    });
  }
});

router.post("/confirm", async (req, res) => {
  try {
    const user = await User.getUser(req);
    if (!user) return res.status(404).json({ error: "User not found" });
    const wallet = (user.wallet || req.wallet || "").toLowerCase();
    if (!wallet) return res.status(400).json({ error: "Wallet required" });
    const { hasMinted } = await getOnChainUserStatus(wallet);
    if (!hasMinted) {
      return res.status(403).json({ error: "Mint on-chain first. Complete the mint transaction in your wallet." });
    }
    const { tokenId } = req.body || {};
    if (tokenId != null && tokenId !== "") await User.addOwnedTokenId(wallet, String(tokenId));
    const txHash = (req.body && req.body.txHash) ? String(req.body.txHash).trim() : null;
    const contractAddress = process.env.NFT_CONTRACT_ADDRESS || "";
    const rpcUrl = process.env.RPC_URL || "";
    if (!contractAddress || !rpcUrl) {
      return res.status(503).json({ error: "NFT_CONTRACT_ADDRESS and RPC_URL required to log mint price" });
    }
    let mintPriceWei;
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const nft = new ethers.Contract(contractAddress, ["function mintPrice() view returns (uint256)"], provider);
      mintPriceWei = (await nft.mintPrice()).toString();
      if (mintPriceWei === "0") {
        return res.status(503).json({ error: "NFT mintPrice is zero on-chain" });
      }
    } catch (e) {
      return res.status(503).json({ error: e?.message || "Failed to read mintPrice from chain" });
    }
    await User.logActivity(wallet, "mint", { tokenId: tokenId != null ? String(tokenId) : null, price: mintPriceWei, ...(txHash ? { txHash } : {}) });
    await User.updateUser(user.id, { state: "MINTED", lastActivity: new Date() });
    const updated = await User.getUser(req);
    res.json({
      user: { wallet: updated.wallet, state: updated.state },
      redirect: "marketplace",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

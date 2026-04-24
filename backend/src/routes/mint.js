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

  let totalSupply = null;
  let maxSupply = null;
  let mintPriceWei = "30000000";
  if (contractAddress && rpcUrl) {
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
      totalSupply = Number(totalMintedRaw);
      maxSupply = Number(maxSupplyRaw);
      mintPriceWei = mintPriceRaw.toString();
    } catch (_) {
      // leave null if chain unreachable or contract not deployed
    }
  }
  const mintPriceUsdt = (Number(mintPriceWei) / 1e6).toFixed(2);

  res.json({
    price: mintPriceUsdt,
    priceWei: mintPriceWei,
    priceFormatted: `$${mintPriceUsdt} USDT`,
    rule: "1 Wallet = 1 NFT (lifetime)",
    contractAddress,
    metadataUri: metadataUri || undefined,
    metadataBasePath: metadataBasePath || undefined,
    nftName,
    nftSymbol,
    totalSupply,
    maxSupply,
  });
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
    let mintPriceWei = "30000000";
    const contractAddress = process.env.NFT_CONTRACT_ADDRESS || "";
    const rpcUrl = process.env.RPC_URL || "";
    if (contractAddress && rpcUrl) {
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const nft = new ethers.Contract(contractAddress, ["function mintPrice() view returns (uint256)"], provider);
        mintPriceWei = (await nft.mintPrice()).toString();
      } catch (_) {}
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

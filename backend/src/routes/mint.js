import { Router } from "express";
import { ethers } from "ethers";
import * as User from "../services/userFirestore.js";
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
  if (contractAddress && rpcUrl) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const nft = new ethers.Contract(
        contractAddress,
        [
          "function totalMinted() view returns (uint256)",
          "function MAX_SUPPLY() view returns (uint256)",
        ],
        provider
      );
      totalSupply = Number(await nft.totalMinted());
      maxSupply = Number(await nft.MAX_SUPPLY());
    } catch (_) {
      // leave null if chain unreachable or contract not deployed
    }
  }

  res.json({
    price: "10",
    priceFormatted: "$10 USDT",
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
    await User.logActivity(wallet, "mint", { tokenId: tokenId != null ? String(tokenId) : null, price: "10000000", ...(txHash ? { txHash } : {}) });
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

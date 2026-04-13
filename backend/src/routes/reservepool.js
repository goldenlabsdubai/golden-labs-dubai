import { Router } from "express";
import { getMarketplaceAndReservePoolAddress } from "../config/contractsEnv.js";

const router = Router();

router.get("/info", (_, res) => {
  const mergedAddr = getMarketplaceAndReservePoolAddress();
  res.json({
    contractAddress: mergedAddr,
    mergedIntoMarketplace: true,
  });
});

export default router;

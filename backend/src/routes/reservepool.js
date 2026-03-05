import { Router } from "express";

const router = Router();

router.get("/info", (_, res) => {
  res.json({
    contractAddress: process.env.RESERVE_POOL_CONTRACT_ADDRESS || "",
    // Balance would be fetched from chain in production
  });
});

export default router;

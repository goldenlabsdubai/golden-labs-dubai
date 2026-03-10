/**
 * Vercel serverless catch-all – routes all /api/* requests to Express app.
 * Exact /api is handled here so it doesn't 404 (same payload as root).
 */
import app from "../src/app.js";
import serverless from "serverless-http";

const handler = serverless(app);

export default function (req, res) {
  const path = (req.url || "").split("?")[0];
  if (path === "/api" || path === "/api/") {
    res.setHeader("Content-Type", "application/json");
    res.status(200).end(JSON.stringify({ api: "goldenlabs", health: "/api/health" }));
    return;
  }
  return handler(req, res);
}

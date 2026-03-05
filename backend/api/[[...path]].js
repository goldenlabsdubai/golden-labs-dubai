/**
 * Vercel serverless catch-all – routes all /api/* requests to Express app.
 */
import app from "../src/app.js";
import serverless from "serverless-http";

export default serverless(app);

import https from "node:https";
import { URL } from "node:url";

/**
 * POST JSON over TLS (HTTP/1.1). Prefer over `fetch` for some Groq + Node combinations.
 */
export function postHttpsJson(urlStr, headerPairs, bodyObj, timeoutMs = 60000) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(bodyObj);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "POST",
        agent: new https.Agent({ keepAlive: false }),
        headers: {
          ...headerPairs,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload, "utf8"),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

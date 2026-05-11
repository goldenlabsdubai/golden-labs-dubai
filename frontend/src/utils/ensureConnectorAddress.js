import { getAccount } from "wagmi/actions";

/**
 * Restore wagmi connector account (mobile / in-app browsers often need an extra `reconnect` + short poll).
 * @param {import("@wagmi/core").Config} config
 * @param {string | undefined} hookAddress - `useAccount().address`
 * @param {() => Promise<unknown>} reconnectAsync - `useReconnect().reconnectAsync`
 * @returns {Promise<`0x${string}` | null>}
 */
export async function resolveSignerAddress(config, hookAddress, reconnectAsync) {
  let a = hookAddress || getAccount(config).address || null;
  if (a) return a;
  try {
    await reconnectAsync();
  } catch {
    /* ignore */
  }
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 120));
    a = getAccount(config).address || null;
    if (a) return a;
  }
  return null;
}

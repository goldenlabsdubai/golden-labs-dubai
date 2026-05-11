/**
 * Reown AppKit — BSC mainnet only (production).
 * Custom RPC avoids WalletConnect public RPC (CORS + 429) for reads.
 */
import { createAppKit } from "@reown/appkit/react";
import { WagmiProvider, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { bsc } from "@reown/appkit/networks";

const queryClient = new QueryClient();

const projectId =
  import.meta.env.VITE_PROJECT_ID || "b56e18d47c72ab683b10814fe9495694";

// AppKit requires ONE valid absolute URL. Comma-separated lists (like CORS) break new URL() — prefer https origin.
function resolveAppMetadataUrl() {
  const raw = (import.meta.env.VITE_FRONTEND_URL || "").trim();
  if (raw.includes(",")) {
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const https = parts.find((p) => p.startsWith("https://"));
    return https || parts[0] || "";
  }
  return raw;
}

// Local dev: WalletConnect warns if metadata.url ≠ actual page URL; always use current origin on localhost.
const appMetadataUrl =
  import.meta.env.DEV && typeof window !== "undefined"
    ? window.location.origin
    : resolveAppMetadataUrl() ||
      (typeof window !== "undefined" ? window.location.origin : "") ||
      "https://goldenlabs.finance";

const metadata = {
  name: "Golden Labs",
  description: "Welcome! Subscribe, mint, trade & refer with friends & family.",
  url: appMetadataUrl,
  icons: ["https://avatars.githubusercontent.com/u/179229932"],
};

const BSC_MAINNET_RPC =
  import.meta.env.VITE_BSC_RPC_URL || "https://bsc-dataseed.binance.org/";

const networks = [bsc];

const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
  transports: {
    56: http(BSC_MAINNET_RPC),
  },
});

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  defaultNetwork: bsc,
  projectId,
  metadata,
  /**
   * Some injected / in-app wallets briefly report a chain id AppKit does not map to `networks`
   * (or strict equality fails), which opens the “doesn’t support your current network” modal even on BSC.
   * Per Reown docs, this suppresses that blocking dialog; wagmi + our pages still enforce BSC for txs/SIWE.
   * @see https://docs.reown.com/appkit/react/core/options#allowunsupportedchain
   */
  allowUnsupportedChain: true,
  features: {
    analytics: false,
    email: false,
    socials: [],
    emailShowWallets: true,
  },
  allWallets: "SHOW",
});

export { wagmiAdapter, queryClient };

export function AppKitProvider({ children }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig} reconnectOnMount>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

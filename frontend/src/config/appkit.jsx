/**
 * Reown AppKit (Web3 store / 390+ wallets) – https://docs.reown.com/appkit/react/core/installation
 * BSC mainnet (production) + BSC testnet (testing).
 * Custom RPCs avoid WalletConnect public RPC (CORS + 429) for reads (getBalance, watchContractEvent).
 */
import { createAppKit } from "@reown/appkit/react";
import { WagmiProvider, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { bsc, bscTestnet } from "@reown/appkit/networks";

const queryClient = new QueryClient();

const projectId =
  import.meta.env.VITE_PROJECT_ID || "b56e18d47c72ab683b10814fe9495694";

const metadata = {
  name: "Golden Labs",
  description: "Welcome! Subscribe, mint, trade & refer with friends & family.",
  url: import.meta.env.VITE_FRONTEND_URL || (typeof window !== "undefined" ? window.location.origin : ""),
  icons: ["https://avatars.githubusercontent.com/u/179229932"],
};

// BSC mainnet (56) + BSC testnet (97) – use custom RPCs so reads don't hit WalletConnect (CORS/429)
const BSC_MAINNET_RPC =
  import.meta.env.VITE_BSC_RPC_URL || "https://bsc-dataseed.binance.org/";
const BSC_TESTNET_RPC =
  import.meta.env.VITE_BSC_TESTNET_RPC_URL ||
  "https://data-seed-prebsc-1-s1.binance.org:8545/";

// BSC mainnet (production) + BSC testnet (testing)
const networks = [bsc, bscTestnet];

const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
  transports: {
    56: http(BSC_MAINNET_RPC),
    97: http(BSC_TESTNET_RPC),
  },
});

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  defaultNetwork: bscTestnet,
  projectId,
  metadata,
  features: {
    analytics: false, // Reown analytics off; Coinbase Wallet SDK may still hit cca-lite.coinbase.com (blocked by ad blockers – safe to ignore)
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

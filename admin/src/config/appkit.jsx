/**
 * Same wallet connect (Reown AppKit) as main platform – shows all wallet options.
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
  name: "Golden Labs Admin",
  description: "Admin panel for Golden Labs.",
  url: typeof window !== "undefined" ? window.location.origin : "http://localhost:5174",
  icons: ["https://avatars.githubusercontent.com/u/179229932"],
};

const BSC_MAINNET_RPC =
  import.meta.env.VITE_BSC_RPC_URL || "https://bsc-dataseed.binance.org/";
const BSC_TESTNET_RPC =
  import.meta.env.VITE_BSC_TESTNET_RPC_URL ||
  "https://data-seed-prebsc-1-s1.binance.org:8545/";

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

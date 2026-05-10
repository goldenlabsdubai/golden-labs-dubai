/**
 * Same wallet connect (Reown AppKit) as main platform — BSC mainnet only.
 */
import { createAppKit } from "@reown/appkit/react";
import { WagmiProvider, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { bsc } from "@reown/appkit/networks";

const queryClient = new QueryClient();

const projectId =
  import.meta.env.VITE_PROJECT_ID || "b56e18d47c72ab683b10814fe9495694";

/** In dev, always use current tab origin so WalletConnect metadata matches localhost (not VITE_ADMIN_URL). */
const metadata = {
  name: "Golden Labs Admin",
  description: "Admin panel for Golden Labs.",
  url:
    typeof window !== "undefined" && import.meta.env.DEV
      ? window.location.origin
      : import.meta.env.VITE_ADMIN_URL || (typeof window !== "undefined" ? window.location.origin : ""),
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

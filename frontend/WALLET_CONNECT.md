# 500+ Wallet Connect (Reown AppKit)

Reown AppKit is **already integrated** – see [Reown AppKit React installation](https://docs.reown.com/appkit/react/core/installation).

- **Connect Wallet** opens the AppKit modal (500+ wallets via WalletConnect, Coinbase, Injected).
- **Networks:** Mainnet + Sepolia (from `@reown/appkit/networks`).
- **Project ID:** Uses `VITE_PROJECT_ID` from `.env`, or a public fallback for localhost.
- **After connect:** User sees **Sign in to continue**; SIWE is done with wagmi’s `useSignMessage`, then backend auth.

To use your own project (recommended for production):

1. Create a project on [Reown Dashboard](https://dashboard.reown.com) and copy the project ID.
2. In `frontend/.env` set: `VITE_PROJECT_ID=your_project_id`
3. Restart the dev server.

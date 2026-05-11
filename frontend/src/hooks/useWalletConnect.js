/**
 * Reown AppKit (Web3 store / 390+ wallets) – https://docs.reown.com/appkit/react/core/installation
 * useAppKit().open() opens the connect modal. Wagmi useAccount() is the source of truth for connection state (same store AppKit uses).
 * openModal is deferred to avoid Lit "update after update" warning from AppKit's internal lifecycle.
 */
import { useAppKit } from "@reown/appkit/react";
import { useAccount } from "wagmi";

export function useWalletConnect() {
  const { open } = useAppKit();
  const acct = useAccount();
  const address = acct.address ?? null;
  const status = acct.status;
  const isReconnecting = Boolean(acct.isReconnecting);
  const isConnecting = Boolean(acct.isConnecting);
  /** True while wagmi is restoring a prior session (common on SSR flag + mobile). */
  const isWalletPending = Boolean(isReconnecting || isConnecting);

  return {
    openModal: () => {
      // Defer so modal open runs after current React render; avoids AppKit/Lit "scheduled an update after update completed" warning
      queueMicrotask(() => open());
    },
    isConnected: Boolean(acct.isConnected && address),
    address,
    status,
    isReconnecting,
    isConnecting,
    isWalletPending,
  };
}

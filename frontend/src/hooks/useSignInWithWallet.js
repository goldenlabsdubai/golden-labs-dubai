/**
 * SIWE (Sign-In with Ethereum) using the wallet connected via Reown AppKit (wagmi).
 * Uses useSignMessage from wagmi to sign the SIWE message, then POSTs to backend.
 */
import { useState, useEffect } from "react";
import { useAccount, useSignMessage, useWriteContract, usePublicClient } from "wagmi";
import { getAddress, zeroAddress } from "viem";
import { SiweMessage } from "siwe";
import { API } from "../config";

const TOKEN_KEY = "gl_token";
const USER_KEY = "gl_user";

const REFERRAL_ABI = [
  { name: "setMyReferrer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "referrer", type: "address" }], outputs: [] },
];

export function useSignInWithWallet() {
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [loading, setLoading] = useState(false);
  const referralAddress = (import.meta.env.VITE_REFERRAL_CONTRACT || "").trim();
  const referralAddressNormalized = referralAddress?.startsWith("0x") ? referralAddress : referralAddress ? `0x${referralAddress}` : "";

  // Reset loading when wallet disconnects so "Continue" is clickable again after reconnect
  useEffect(() => {
    if (!address) setLoading(false);
  }, [address]);

  const isNetworkError = (e) => {
      if (!e || typeof e.message !== "string") return false;
      const m = e.message.toLowerCase();
      return e.name === "TypeError" && (m.includes("failed to fetch") || m.includes("network request failed")) || m.includes("connection refused") || m.includes("err_connection_refused");
    };

    const signIn = async () => {
      if (!address || !chainId || !signMessageAsync) {
        throw new Error("Wallet not connected");
      }
      setLoading(true);
      try {
        const referrerRaw =
          typeof sessionStorage !== "undefined" ? (sessionStorage.getItem("gl_ref") || "").trim() : "";
        if (referrerRaw && referralAddressNormalized && writeContractAsync && publicClient) {
          const checkRes = await fetch(`${API}/auth/check/${address}`);
          const checkData = await checkRes.json().catch(() => ({}));
          if (checkData.exists === true) {
            const resolveRes = await fetch(
              `${API}/auth/referrer-resolve?code=${encodeURIComponent(referrerRaw)}`
            );
            const resolveData = await resolveRes.json().catch(() => ({}));
            if (!resolveRes.ok) throw new Error(resolveData.error || "Referral code is invalid.");
            let referrerAddr;
            try {
              referrerAddr = getAddress(
                resolveData.wallet.startsWith("0x") ? resolveData.wallet : `0x${resolveData.wallet}`
              );
            } catch {
              throw new Error("Referral code is invalid.");
            }
            if (referrerAddr !== zeroAddress && referrerAddr.toLowerCase() !== address.toLowerCase()) {
              try {
                const hash = await writeContractAsync({
                  address: referralAddressNormalized,
                  abi: REFERRAL_ABI,
                  functionName: "setMyReferrer",
                  args: [referrerAddr],
                });
                if (hash) await publicClient.waitForTransactionReceipt({ hash });
              } catch (e) {
                const msg = `${e?.message || e?.shortMessage || e || ""}`.toLowerCase();
                if (!msg.includes("referrer already set")) throw e;
              }
            }
          }
        }

        let nonceRes;
        try {
          nonceRes = await fetch(`${API}/auth/nonce/${address}`);
        } catch (e) {
          if (isNetworkError(e)) throw new Error("Cannot reach server. Make sure the backend is running (e.g. npm run dev in the backend folder).");
          throw e;
        }
        const nonceData = await nonceRes.json().catch(() => ({}));
        const nonce = nonceData.nonce;
        if (!nonce) throw new Error(nonceData.error || "Failed to get sign-in nonce");

        const siweMsg = new SiweMessage({
          domain: typeof window !== "undefined" ? window.location.host : "",
          address,
          statement: "Welcome to Golden Labs! Sign this message to sign in and continue.",
          uri: typeof window !== "undefined" ? window.location.origin : "",
          version: "1",
          chainId: Number(chainId),
          nonce,
        });
        const message = siweMsg.prepareMessage();
        const signature = await signMessageAsync({ message, account: address });

        let verifyRes;
        try {
          verifyRes = await fetch(`${API}/auth/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, signature, referrer: referrerRaw || undefined }),
          });
        } catch (e) {
          if (isNetworkError(e)) throw new Error("Cannot reach server. Make sure the backend is running (e.g. npm run dev in the backend folder).");
          throw e;
        }
        const data = await verifyRes.json().catch(() => ({}));
        if (!verifyRes.ok) throw new Error(data.error || "Auth failed");

        if (referrerRaw && typeof sessionStorage !== "undefined") sessionStorage.removeItem("gl_ref");
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        return { token: data.token, user: data.user, redirect: data.redirect };
      } finally {
        setLoading(false);
      }
    };

  return { signIn, loading };
}

/**
 * Heuristic: in-app wallet browsers often composite full-viewport canvas as opaque → “black screen”.
 * Regular mobile Safari/Chrome must stay on the happy path so particles still run.
 */
const WALLET_UA =
  /MetaMaskMobile|MetaMask\/|Trust Wallet|TrustWallet|TokenPocket|imToken|MathWallet|CoinbaseWallet|CBWallet|Rainbow|SafePal|OneKey|BitKeep|BitgetWallet|OKApp|Crypto\.com|Exodus|LedgerLive|Phantom\/|Brave Wallet|Binance|BinanceW3W|StatusIm|Opera\s*Crypto/i;

function hasMobileUa() {
  if (typeof navigator === "undefined") return false;
  return /Mobi|Android|iPhone|iPad|iPod|webOS|BlackBerry/i.test(navigator.userAgent || "");
}

function injectedWalletFlagsMatch(eth) {
  if (!eth) return false;
  try {
    if (eth.providers && Array.isArray(eth.providers)) {
      return eth.providers.some((p) => injectedWalletFlagsMatch(p));
    }
    return !!(
      eth.isMetaMask === true ||
      eth.isCoinbaseWallet === true ||
      eth.isTrust === true ||
      eth.isTrustWallet === true ||
      eth.isBraveWallet === true
    );
  } catch {
    return false;
  }
}

export function isLikelyWalletEmbeddedBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (WALLET_UA.test(ua)) return true;
  /* Android System WebView shell (many wallets embed with ; wv) — not normal Chrome tab */
  if (/; wv\)/i.test(ua) && /Android/i.test(ua)) return true;
  try {
    const e = typeof window !== "undefined" ? window.ethereum : undefined;
    if (e && (e.isTrust === true || e.isTrustWallet === true)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * When true, `<html>` gets `gl-wallet-webview` and the global particle canvas is removed (see App.css).
 */
export function shouldDisableParticleOverlay() {
  if (isLikelyWalletEmbeddedBrowser()) return true;
  if (typeof window === "undefined") return false;
  if (!hasMobileUa()) return false;
  try {
    return injectedWalletFlagsMatch(window.ethereum);
  } catch {
    return false;
  }
}

export function syncWalletWebviewHtmlClass() {
  if (typeof document === "undefined") return;
  if (shouldDisableParticleOverlay()) document.documentElement.classList.add("gl-wallet-webview");
  else document.documentElement.classList.remove("gl-wallet-webview");
}

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Buffer } from "buffer";
import { AppKitProvider } from "./config/appkit";
import { AuthProvider } from "./hooks/useAuth";
import App from "./App";
import "./index.css";

if (typeof window !== "undefined") {
  window.Buffer = Buffer;
  // Suppress "Cannot redefine property: ethereum" from wallet/browser extensions (e.g. EVM Ask) that conflict with MetaMask
  const prevOnError = window.onerror;
  window.onerror = function (msg, url, line, col, err) {
    if (typeof msg === "string" && msg.includes("Cannot redefine property: ethereum")) {
      console.warn(
        "[Golden Labs] Another extension (e.g. evmAsk) is conflicting with your wallet. If Connect Wallet does not work, disable that extension or use a private/incognito window."
      );
      return true;
    }
    return prevOnError ? prevOnError.apply(this, arguments) : false;
  };
  // Remove Reown-injected font preload that triggers "not used within a few seconds" console warning
  const removeReownFontPreload = () => {
    document.querySelectorAll('link[href*="fonts.reown.com"]').forEach((el) => el.remove());
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", removeReownFontPreload);
  } else {
    removeReownFontPreload();
  }
  // Run again after a short delay in case AppKit injects the link later
  setTimeout(removeReownFontPreload, 500);
}

class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e8e8ed", padding: "2rem", fontFamily: "system-ui" }}>
          <h1>Something went wrong</h1>
          <p style={{ color: "#8b8b9a" }}>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: "1rem", padding: "0.5rem 1rem", cursor: "pointer" }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppKitProvider>
      <ErrorBoundary>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </AppKitProvider>
  </React.StrictMode>
);

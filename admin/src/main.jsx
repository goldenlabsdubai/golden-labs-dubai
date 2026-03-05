import React from "react";
import ReactDOM from "react-dom/client";
import { Buffer } from "buffer";
import { AppKitProvider } from "./config/appkit";
import App from "./App";
import "./index.css";

if (typeof window !== "undefined") {
  window.Buffer = Buffer;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppKitProvider>
      <App />
    </AppKitProvider>
  </React.StrictMode>
);

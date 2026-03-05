import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    // Reduces "preloaded but not used" console warnings
    modulePreload: false,
  },
  define: {
    "process.env": {}
  },
  resolve: {
    alias: {
      buffer: "buffer/"
    }
  },
  optimizeDeps: {
    include: ["buffer", "siwe"]
  }
});

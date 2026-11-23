import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.STUDIO_API_TARGET || "http://127.0.0.1:8001";
if (!/^http:\/\/127\.0\.0\.1:(8001|8002)$/.test(apiTarget))
  throw new Error("Proxy API local non autorisé");

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api/v1": { target: apiTarget, changeOrigin: false },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    proxy: {
      "/api/v1": { target: apiTarget, changeOrigin: false },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});

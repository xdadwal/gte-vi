import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
const cert = process.env.DEV_TLS_CERT;
const key = process.env.DEV_TLS_KEY;
if (Boolean(cert) !== Boolean(key))
  throw new Error(
    "Set both DEV_TLS_CERT and DEV_TLS_KEY for the secure preview",
  );
export default defineConfig({
  plugins: [react()],
  server: {
    https:
      cert && key
        ? { cert: readFileSync(cert), key: readFileSync(key) }
        : undefined,
    proxy: { "/api": "http://127.0.0.1:8080" },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});

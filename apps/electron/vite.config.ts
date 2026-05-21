import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: rootDir,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.join(rootDir, "src")
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    port: 5174,
    strictPort: true
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "electron/**/*.test.ts"]
  }
});

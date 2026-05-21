import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const electronExternals = ["electron", ...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)];

export default defineConfig({
  root: rootDir,
  build: {
    outDir: "dist-electron",
    emptyOutDir: true,
    target: "node22",
    lib: {
      entry: {
        "electron/main": path.join(rootDir, "electron/main.ts"),
        "electron/preload": path.join(rootDir, "electron/preload.ts")
      },
      formats: ["cjs"]
    },
    rollupOptions: {
      external: electronExternals,
      output: {
        entryFileNames: "[name].cjs",
        chunkFileNames: "chunks/[name]-[hash].cjs"
      }
    }
  }
});

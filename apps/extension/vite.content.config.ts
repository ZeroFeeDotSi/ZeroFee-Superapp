// The content script: one classic script (Chrome doesn't load content scripts as modules), added to the same build folder.
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "build",
    emptyOutDir: false,
    target: "chrome116",
    sourcemap: false,
    lib: { entry: "src/content.ts", formats: ["iife"], name: "zerofeeLauncher", fileName: () => "content.js" },
  },
});

// The panel (panel.html), as ES modules with fixed file names, so the manifest can name them
// and the same source always builds the same files. The content script is built apart (vite.content.config.ts): Chrome
// runs content scripts as classic scripts, so it is one self-contained file.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "build",
    emptyOutDir: true,
    target: "chrome116",
    modulePreload: { polyfill: false },
    sourcemap: false,
    rolldownOptions: {
      // the background worker is its own build (vite.worker.config.ts): built here, it imported panel.js and died at start
      input: { panel: "panel.html" },
      output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name].js", assetFileNames: "assets/[name][extname]" },
    },
  },
});

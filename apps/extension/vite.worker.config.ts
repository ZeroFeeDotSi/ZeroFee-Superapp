// The background worker, built apart from the panel (5 Nov): built together, the bundler put code both use (ProblemError,
// a shared helper) into the PANEL's entry file, so the worker imported panel.js, which draws the panel (`document`) as it
// loads. A worker has no document: it threw at start, Chrome never registered it, and every message to it waited for ever
// (the trading panel stuck on its mark, the approval window blank, so no passkey and no unlock). Its own build, its own
// folder for its chunks (worker/), so it can never load a page's code. src/worker-build.test.ts checks the built files.
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "build",
    emptyOutDir: false,
    target: "chrome116",
    modulePreload: false,
    sourcemap: false,
    rolldownOptions: {
      input: { background: "src/background.ts" },
      output: { entryFileNames: "[name].js", chunkFileNames: "worker/[name].js", assetFileNames: "worker/[name][extname]" },
    },
  },
});

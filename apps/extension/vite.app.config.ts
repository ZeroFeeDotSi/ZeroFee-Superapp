// D157: the full ZeroFee app (apps/web) in the extension's own pages, built after the panel and the content script into the
// same folder: app.html (the side panel) and approve.html (the approval window), one bundle, no remote code (MV3). The
// web app's own build rules come along (its base58 alias and the public release's stand-ins), with the extension's
// target: Real only, on mainnet (mode.ts EXTENSION_BUILD). The built manifest gets the policy from src/manifest-gen.ts.
//
// Row 35 (product decision, 3 Nov): the extension is the real app, never a Sim. There is no sample build of it any more (the load
// check's old VITE_ZEROFEE_EXTENSION_CHECK=1 build is refused): every Sim module the web app reaches is swapped for the
// extension's own stand-in (src/no-sim/), and the build fails if any chunk still holds a Sim, demo or mock module, or if
// the real core isn't in it (src/no-sim/build.ts, read from the bundler's own module lists).
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import { builtManifest, extensionCsp, relayUrl } from "./src/manifest-gen.ts";
import { simProblems, standinFor } from "./src/no-sim/build.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
if (process.env.VITE_ZEROFEE_EXTENSION_CHECK) throw new Error("the extension has no sample build (row 35: the real app, never a Sim): unset VITE_ZEROFEE_EXTENSION_CHECK");
const outDir = "build";

// The web build's switches, for this build: the public release's app set, the AgentZero chat, the relay, this target.
const relay = relayUrl();
// VITE_FORK pinned off: the mainnet copy (packages/core/src/fork.ts) is never the extension
const env = { VITE_ZEROFEE_PUBLIC: "1", VITE_ZEROFEE_TARGET: "extension", VITE_AGENTZERO_CHAT: "1", VITE_ZEROFEE_RELAY: relay, VITE_ZEROFEE_EXTENSION_CHECK: "", VITE_FORK: "" };
Object.assign(process.env, env);

/** Row 35: each Sim module the web app reaches is the extension's own stand-in; the build stops if any Sim, demo or mock
 *  module is still in a chunk, or the real core isn't. */
function noSim(): PluginOption {
  return {
    name: "zerofee-extension-no-sim",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      return r && standinFor(r.id) ? standinFor(r.id) : null;
    },
    generateBundle(_o, bundle) {
      const ids = Object.values(bundle).flatMap((c) => (c.type === "chunk" ? c.moduleIds : []));
      const bad = simProblems(ids);
      if (bad.length) this.error(`row 35: the extension is the real app, never a Sim:\n  ${bad.join("\n  ")}`);
    },
  };
}

/** The web app's own build rules, minus its site-only plugins (its tab title, the second device's entry). */
async function webRules(): Promise<{ plugins: PluginOption[]; alias: unknown }> {
  const mod = (await import("../web/vite.config.ts")) as { default: (e: { mode: string; command: string }) => UserConfig };
  const web = mod.default({ mode: "production", command: "build" });
  const plugins = (web.plugins ?? []).flat().filter((p) => p && typeof p === "object" && "name" in p && p.name === "zerofee-release-stubs") as PluginOption[];
  if (plugins.length !== 1) throw new Error("apps/web/vite.config.ts changed: its release stand-ins plugin wasn't found");
  return { plugins, alias: web.resolve?.alias };
}

/** build/ holds the panel and the content script already (npm run build runs them first); the manifest is written last. */
function manifest(): PluginOption {
  return {
    name: "zerofee-extension-manifest",
    buildStart() {
      // the old sample build's folder never sits beside the real one
      rmSync(join(here, "build-check"), { recursive: true, force: true });
      // the app's own folder starts empty every build: no chunk of an earlier build (or of the release) stays behind
      rmSync(join(here, outDir, "app"), { recursive: true, force: true });
      for (const page of ["app.html", "approve.html"]) rmSync(join(here, outDir, page), { force: true });
    },
    closeBundle() {
      // a build that stopped (the no-Sim gate) wrote no app: no manifest and no build marker for it either
      if (!existsSync(join(here, outDir, "app/app.js"))) return;
      const source = JSON.parse(readFileSync(join(here, "public/manifest.json"), "utf8"));
      writeFileSync(join(here, outDir, "manifest.json"), JSON.stringify(builtManifest(source, extensionCsp(relay)), null, 2) + "\n");
      // which build this is, for the built-manifest test and the zip's gate (always the real one: row 35)
      writeFileSync(join(here, outDir, "app/build.json"), JSON.stringify({ check: false }) + "\n");
    },
  };
}

export default defineConfig(async () => {
  const web = await webRules();
  return {
    plugins: [noSim(), react(), ...web.plugins, manifest()],
    resolve: { alias: web.alias as never },
    base: "./",
    publicDir: "../web/public",
    define: Object.fromEntries(Object.entries(env).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)])),
    build: {
      outDir,
      emptyOutDir: false,
      target: "chrome116",
      modulePreload: { polyfill: false },
      sourcemap: false,
      rolldownOptions: {
        input: { app: "app.html", approve: "approve.html" },
        output: { entryFileNames: "app/[name].js", chunkFileNames: "app/chunks/[name]-[hash].js", assetFileNames: "app/assets/[name]-[hash][extname]" },
      },
    },
  };
});

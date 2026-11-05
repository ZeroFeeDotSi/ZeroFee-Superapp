// D157 (product decision, 4 Nov): the Chrome extension is the real, final app, with NO Sim at all. build-zip.sh runs this on the
// built folder before it zips: it fails when any built file carries the web's Sim or its MockBridge, by their exact
// words, or a Sim / sample chunk by name, or when the folder is the load check's sample build.
//   node tools/extension/no-sim.ts apps/extension/build      (exit 1 and the reason when anything is found)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Exact strings of the web's Sim and its MockBridge, each with the source it comes from (so the check can fire). */
export const SIM_MARKERS: readonly { text: string; from: string }[] = [
  { text: "ZeroFee, on pretend money", from: "apps/web/src/gallery/sim-intro.ts" }, // the Sim's intro
  { text: "Sim: pretend money", from: "apps/web/src/shell/mode-mark.ts" }, // the Sim's mark
  { text: "zf.demo.setup", from: "apps/web/src/gallery/demo-start.ts" }, // the Sim's kept set-up
  { text: "ml-dsa-65-hash:Qz8mDeviceKeyH4nd1e000000000000000000001", from: "packages/shell-api/src/MockBridge.ts" }, // MockBridge's sample key
  { text: "Try: someone starts a recovery", from: "packages/shell-api/src/MockBridge.ts" }, // MockBridge's sample flows
  // row 35: the Sim modules the real app's own code reaches (the extension's build swaps each for a stand-in)
  { text: "This is the Sim. On the iPhone app it does this for real.", from: "packages/agent/src/chat/sim.ts" }, // AgentZero's Sim line
  { text: "In the Sim, AgentZero answers only a few questions.", from: "apps/web/src/agentzero/sim-chat.ts" }, // the Sim's chat
  { text: "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM", from: "packages/trade/src/demo-engine.ts" }, // Trade's sample wallet
  { text: "Simulation · sample coins, pretend money", from: "packages/browser/src/sim/sites-data.ts" }, // the Sim's made-up sites
  { text: "Sim can't start in this browser.", from: "apps/web/src/demo-line.ts" }, // the Sim's storage line
];
/** Chunks that only the Sim loads: the demo page, its sample money and markets, the sample perps, the gallery. */
export const SIM_CHUNK = /^(Demo|demo-money|demo-samples|demo-start|recorded|recorded-data|sample|MockBridge|SimIntro|sim-intro|sim-storage|Screens|FundWalk)-[A-Za-z0-9_-]+\.js$/;

const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });

/** What in `dir` is Sim (empty: nothing). */
export function simIn(dir: string): string[] {
  const found: string[] = [];
  try {
    if (JSON.parse(readFileSync(join(dir, "app/build.json"), "utf8")).check !== false) found.push("app/build.json: the load check's sample build");
  } catch {
    found.push("app/build.json is missing: not the extension's release build");
  }
  for (const f of files(dir)) {
    const name = f.split("/").pop()!;
    if (SIM_CHUNK.test(name)) found.push(`${relative(dir, f)}: a Sim chunk`);
    if (!/\.(js|html|css|json)$/.test(name)) continue;
    const text = readFileSync(f, "utf8");
    for (const m of SIM_MARKERS) if (text.includes(m.text)) found.push(`${relative(dir, f)}: "${m.text}"`);
  }
  return found;
}

/** Each marker must still be in its source, or its check could never fire. */
export function markersInSource(repo: string): string[] {
  return SIM_MARKERS.filter((m) => !readFileSync(join(repo, m.from), "utf8").includes(m.text)).map((m) => `"${m.text}" is gone from ${m.from}: update tools/extension/no-sim.ts`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const bad = [...markersInSource(repo), ...simIn(process.argv[2] ?? join(repo, "apps/extension/build"))];
  if (bad.length) { console.error(`STOP: the extension's build has Sim in it (D157: no Sim at all):\n  ${bad.join("\n  ")}`); process.exit(1); }
  console.log("no Sim in the extension's build");
}

// Ledger row 3 (product decision, 3 Nov): the Sim's AgentZero runs on ZeroFee's own Anthropic key, SERVER SIDE ONLY (the relay's
// /v0/agentzero/sim, apps/quotes/agentzero-sim.mjs). This builds the real client bundles (the web app as the phone and
// the public Sim build it, and the Chrome extension's three) with a canary in every server-only key's env name, and
// checks that no canary and no key's shape is in any chunk or asset. Control: the same scan finds a canary that a
// VITE_ name does carry into the bundle (Vite's own rule), so a clean scan means something.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { execFileSync } from "node:child_process";

const web = fileURLToPath(new URL("../..", import.meta.url));
const ext = fileURLToPath(new URL("../../../extension", import.meta.url));
const repo = fileURLToPath(new URL("../../../..", import.meta.url));
/** The relay's server-only secrets (apps/quotes/api/relay.mjs), each set to its own canary for the build. */
const SERVER_ONLY = ["ANTHROPIC_API_KEY", "AGENTZERO_STORE_KEY", "AGENTZERO_SECRET", "AGENTZERO_TEST_TOKEN", "AGENTZERO_SIM_DAILY_USD", "AGENTZERO_SIM_PER_IP_USD"];
const canary = (name: string) => `sk-ant-api03-CANARY${name.replace(/_/g, "")}0123456789abcdefghij`;
/** A real Anthropic key's shape (an api or admin key), never a regex or a placeholder in the app's own words. */
const KEY_SHAPE = /sk-ant-(?:api|admin)\d\d-[A-Za-z0-9_-]{20,}/;

async function bundleText(root: string, configFile: string, env: Record<string, string>): Promise<string> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    const out = (await build({ root, configFile, logLevel: "silent", mode: "production", build: { write: false, reportCompressedSize: false } })) as Rollup.RollupOutput | Rollup.RollupOutput[];
    return (Array.isArray(out) ? out : [out]).flatMap((o) => o.output).map((f) => (f.type === "chunk" ? f.code : typeof f.source === "string" ? f.source : Buffer.from(f.source).toString("latin1"))).join("\n");
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const canaries = Object.fromEntries(SERVER_ONLY.map((n) => [n, canary(n)]));
const leaks = (text: string) => [...SERVER_ONLY.filter((n) => text.includes(canaries[n]!)), ...(KEY_SHAPE.test(text) ? [`a key's shape: ${text.match(KEY_SHAPE)![0].slice(0, 14)}…`] : [])];

test("no server-only key is in any client bundle: the web app (phone build and the public Sim build) and the extension, built with a canary in each key's env name (control: a VITE_ name does reach the bundle)", { timeout: 600_000 }, async () => {
  const builds: [string, string, string, Record<string, string>][] = [
    ["web (phone)", web, `${web}/vite.config.ts`, {}],
    ["web (public Sim)", web, `${web}/vite.config.ts`, { VITE_ZEROFEE_PUBLIC: "1", VITE_HOME_PROOF: "1", VITE_WEB_TRADE: "1" }],
    ["extension", ext, `${ext}/vite.config.ts`, {}],
    ["extension content", ext, `${ext}/vite.content.config.ts`, {}],
    // the extension's app build (vite.app.config.ts) writes its manifest into build/ as it goes, so it is not built
    // here; its code is the same packages the web builds above carry, and the source scan below covers its src
  ];
  for (const [name, root, config, extra] of builds) {
    const text = await bundleText(root, config, { ...canaries, ...extra });
    assert.ok(text.length > 1_000, `${name}: the bundle was built (${text.length} characters)`);
    assert.deepEqual(leaks(text), [], `${name}: no server-only key`);
  }
  // control: Vite does put a VITE_ name's value in the bundle when the code reads it, so the scan above can see one.
  // VITE_ZEROFEE_RELAY is read by the web app (deploy-app.sh sets it); a canary there is found.
  const relayCanary = "https://relay-canary-0123456789.invalid";
  const withRelay = await bundleText(web, `${web}/vite.config.ts`, { ...canaries, VITE_ZEROFEE_PUBLIC: "1", VITE_HOME_PROOF: "1", VITE_ZEROFEE_RELAY: relayCanary });
  assert.ok(withRelay.includes(relayCanary), "control: a VITE_ value the code reads is in the bundle");
  assert.deepEqual(leaks(withRelay), []);
});

test("no client source reads a server-only key: no VITE_ name for an Anthropic or AgentZero key, and only the relay imports its Sim module outside tests (control: the relay's own entry does)", () => {
  const grep = (pattern: string, paths: string[]) => {
    try {
      return execFileSync("git", ["grep", "-n", "-E", pattern, "--", ...paths], { cwd: repo, encoding: "utf8" }).trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  };
  const client = ["apps/web/src", "apps/extension/src", "packages", ":(exclude)*.test.ts", ":(exclude)*.test.tsx"];
  assert.deepEqual(grep("VITE_[A-Z_]*(ANTHROPIC|CLAUDE_KEY|AGENTZERO_(STORE|SECRET|TEST))", client), []);
  assert.deepEqual(grep("process\\.env\\.(ANTHROPIC_API_KEY|AGENTZERO_STORE_KEY|AGENTZERO_SECRET)", client), []);
  assert.deepEqual(grep("(from|import\\()\\s*[\"'][^\"']*quotes/[^\"']*\\.mjs", client), []);
  assert.ok(grep("anthropicKey: env\\.ANTHROPIC_API_KEY", ["apps/quotes/api/relay.mjs"]).length === 1, "control: the relay's entry reads the key from its own env");
});

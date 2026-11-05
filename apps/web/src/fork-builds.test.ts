// The mainnet copy (VITE_FORK=1, packages/core/src/fork.ts) is a local build only. Every shipped build can't be it:
// the phone's (apps/ios/build-web.sh), the public site's (apps/web/deploy-app.sh) and the Chrome extension's
// (tools/extension/build-zip.sh, vite.app.config.ts) unset or pin it off before they build, none ever sets it, and the
// web build refuses it beside any release target. (speed-budget.test.ts: with it off, nothing of the copy ships.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");
const SHIPPED: { file: string; build: RegExp }[] = [
  { file: "apps/ios/build-web.sh", build: /npm run -w @zerofee\/web build/ },
  { file: "apps/web/deploy-app.sh", build: /npm run -s -w @zerofee\/web build/ },
  { file: "tools/extension/build-zip.sh", build: /npm run -s build/ },
];

test("the phone, the public site and the extension unset VITE_FORK before they build, and never set it", () => {
  for (const { file, build } of SHIPPED) {
    const s = read(file);
    const unset = s.search(/^unset VITE_FORK$/m), built = s.search(build);
    assert.ok(unset >= 0, `${file} unsets VITE_FORK`);
    assert.ok(built > unset, `${file} builds after it unsets VITE_FORK`);
    const code = s.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    assert.doesNotMatch(code, /VITE_FORK=|export VITE_FORK/, `${file} never sets VITE_FORK`);
  }
  // the extension's own app build pins it off in its define, whatever the shell says
  assert.match(read("apps/extension/vite.app.config.ts"), /VITE_ZEROFEE_EXTENSION_CHECK: "", VITE_FORK: "" \};/);
  // the phone's own core gets nothing from the environment but the proof flag (control: tools/ios/core-proof-flag.test.ts)
  assert.match(read("apps/ios/core/build.mjs"), /export const CORE_ENV = \{ VITE_HOME_PROOF: process\.env\.VITE_HOME_PROOF === "1" \? "1" : "" \};/);
});

test("the web build refuses VITE_FORK=1 beside a release target (control: alone, it builds the copy)", async () => {
  const { default: config } = (await import("../vite.config.ts")) as { default: (e: { mode: string; command: string }) => unknown };
  const keys = ["VITE_FORK", "VITE_ZEROFEE_PUBLIC", "VITE_ZEROFEE_TARGET"] as const;
  const kept = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const run = (env: Partial<Record<(typeof keys)[number], string>>) => {
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, env);
    try { return config({ mode: "production", command: "build" }); } finally { for (const k of keys) if (kept[k] === undefined) delete process.env[k]; else process.env[k] = kept[k]; }
  };
  assert.throws(() => run({ VITE_FORK: "1", VITE_ZEROFEE_PUBLIC: "1" }), /mainnet copy/);
  assert.throws(() => run({ VITE_FORK: "1", VITE_ZEROFEE_TARGET: "extension" }), /mainnet copy/);
  assert.throws(() => run({ VITE_FORK: "1", VITE_ZEROFEE_TARGET: "second-device" }), /mainnet copy/);
  assert.doesNotThrow(() => run({ VITE_FORK: "1" }), "control: the copy's own build");
  assert.doesNotThrow(() => run({ VITE_ZEROFEE_PUBLIC: "1" }), "control: the public build without the flag");
});

test("the shipped CSPs are unchanged: no loopback origin in the phone's, the site's or the extension's connect-src (the copy's own build is served by vite preview with no CSP, so its fetches to the copy's nodes need none)", () => {
  const local = /(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)/;
  assert.doesNotMatch(read("apps/ios/connect-hosts.txt"), local, "the phone's and the site's approved hosts");
  assert.doesNotMatch(read("apps/web/vercel.json"), local, "the public site's headers");
  assert.doesNotMatch(read("apps/ios/build-web.sh").match(/^WSS_HOSTS=.*$/m)![0], local);
  // the copy's build adds no CSP of its own (vite.config.ts writes none; index.html has none): control, so this holds
  assert.doesNotMatch(read("apps/web/index.html"), /Content-Security-Policy/);
  assert.doesNotMatch(read("apps/web/vite.config.ts"), /Content-Security-Policy|127\.0\.0\.1/);
});

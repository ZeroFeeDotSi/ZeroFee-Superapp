// D157 (product decision, 4 Nov): the extension is the real app with no Sim. The zip's gate (no-sim.ts) finds the web's Sim and
// MockBridge by their exact words, Sim chunks by name, and the load check's sample build; a planted marker fails it.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SIM_MARKERS, markersInSource, simIn } from "./no-sim.ts";

const repo = fileURLToPath(new URL("../../", import.meta.url));
function folder(build: unknown | null = { check: false }, files: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "zf-nosim-"));
  mkdirSync(join(dir, "app/chunks"), { recursive: true });
  if (build !== null) writeFileSync(join(dir, "app/build.json"), JSON.stringify(build));
  writeFileSync(join(dir, "app/app.js"), "export const home = 'Add Send Swap Move';");
  for (const [p, t] of Object.entries(files)) writeFileSync(join(dir, p), t);
  return dir;
}

test("a clean release folder passes (control)", () => {
  const dir = folder();
  try { assert.deepEqual(simIn(dir), []); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("every planted Sim or MockBridge marker fails the zip", () => {
  for (const m of SIM_MARKERS) {
    const dir = folder({ check: false }, { "app/chunks/full-app-abc123.js": `var a="${m.text}";` });
    try { assert.ok(simIn(dir).some((f) => f.includes(m.text)), m.text); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("a Sim chunk by name, the sample build, or no build marker fails it", () => {
  for (const name of ["Demo-x1Y2.js", "demo-money-Ab.js", "demo-samples-Q.js", "recorded-data-Z.js", "sample-zt4qDz_D.js", "MockBridge-1.js"]) {
    const dir = folder({ check: false }, { [`app/chunks/${name}`]: "1" });
    try { assert.ok(simIn(dir).some((f) => f.includes("a Sim chunk")), name); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const real = folder({ check: false }, { "app/chunks/demo-core-DQyB51oq.js": "1" }); // control: the real core's chunk is not Sim
  try { assert.deepEqual(simIn(real), []); } finally { rmSync(real, { recursive: true, force: true }); }
  const sample = folder({ check: true });
  const none = folder(null);
  try {
    assert.ok(simIn(sample).some((f) => f.includes("sample build")));
    assert.ok(simIn(none).some((f) => f.includes("missing")));
  } finally { rmSync(sample, { recursive: true, force: true }); rmSync(none, { recursive: true, force: true }); }
});

test("each marker is still in its source, so the gate can fire", () => {
  assert.deepEqual(markersInSource(repo), []);
});

test("the built release (apps/extension/build), when there is one, has no Sim", { skip: !existsSync(join(repo, "apps/extension/build/app/build.json")) ? "no build here" : false }, () => {
  assert.deepEqual(simIn(join(repo, "apps/extension/build")), []);
});

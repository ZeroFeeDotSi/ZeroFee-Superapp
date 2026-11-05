// The phone's isolated core passes its events to the page through Swift, from one list in apps/ios/core/entry.ts. An
// event the core emits that isn't on it never reaches the page on the phone, though the web build hears it (security
// review 2 Nov: recovery.renewed was missing, so the phone's Browser kept the replaced words' wallets for the session).
// Swift has no test target here, so this reads the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

test("every event the core emits reaches the phone's page, except approval.needed (the sheet is Swift's)", () => {
  const entry = read("apps/ios/core/entry.ts");
  const list = /const EVENTS = \[([^\]]*)\]/.exec(entry);
  assert.ok(list, "entry.ts names its events in one list");
  const passed = new Set([...list[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!));
  const emitted = new Set<string>();
  for (const file of ["packages/core/src/demo-core.ts", "packages/core/src/subwallets.ts"]) {
    for (const m of read(file).matchAll(/\bemit\("([a-z][a-zA-Z.]+)"/g)) emitted.add(m[1]!);
  }
  assert.ok(emitted.has("recovery.renewed") && emitted.has("subwallet.session.ended"), "the control: the scan finds the core's events");
  for (const e of emitted) {
    if (e === "approval.needed") assert.ok(!passed.has(e), "never the page's");
    else assert.ok(passed.has(e), `${e} reaches the page on the phone`);
  }
  // Browser's engine listens for it on the bridge the phone gives it
  assert.match(read("packages/browser/src/service.ts"), /bridge\.on\("recovery\.renewed", \(\) => engine\.forgetWallets\(\)\)/);
});

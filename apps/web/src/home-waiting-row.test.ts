// A held Safe change has a row on Home (5 Nov): new backup words waiting their time (a SetRecoveryKey held by the rules)
// showed nowhere on the Sim's Home. The Sim's Home had no "Waiting for you" slot at all (gallery/Screens.tsx hosted()),
// while the app's had it (App.tsx). Both Homes now take the same slot; the row is the account's waiting list, with the time
// it is ready (Security's HeldRowView counts it down).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BridgeResult } from "@zerofee/core/bridge";
import type { TxOutcome } from "@zerofee/core/signer";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { v4Account } from "../../../packages/core/src/release4-account.test.ts";

const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
/** The slots a Home is hosted with: the object passed to hostApps(…, { … }) up to its rows/place lines. */
const homeSlots = (file: string) => {
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  const at = src.indexOf("rows: (");
  assert.ok(at > 0, `${file} hosts Security's rows`);
  return src.slice(at, src.indexOf("place: (", at));
};
const WAITING_SLOT = /waiting: \(\) => <SecurityWaiting bridge=\{\w+\} \/>/;

test("the Sim's Home and the app's Home both show the account's waiting changes (control: the Sim's slots before the fix had none)", () => {
  assert.match(homeSlots("./App.tsx"), WAITING_SLOT, "the app (control: it always had it)");
  assert.match(homeSlots("./gallery/Screens.tsx"), WAITING_SLOT, "the Sim");
  const before = "rows: (go) => <SecurityRows account={account} bridge={securityBridge} open={go} />,\n    place: (place, step, onBack) =>";
  assert.doesNotMatch(before, WAITING_SLOT, "control: the Sim's slots as they were");
});

test("Sim: new words held by the rules are a Waiting row with their ready time, not ready yet (control: none before, none after a no)", async () => {
  const words = (round: number) => Array.from({ length: 24 }, (_, i) => `r${round}w${i}`);
  const m = createMockBridge({ latencyMs: 0, mainnetRules: {}, sampleWords: words, askApproval: false });
  ok(await m.call("account.create", { recoveryDelaySeconds: 2 * 86_400 }));
  assert.deepEqual(ok(await m.call<unknown[]>("account.waiting")), [], "control: nothing waits");
  const fresh = ok(await m.call<{ words: string[] }>("recovery.renew")).words;
  const out = ok(await m.call<TxOutcome & { readyAtIso: string }>("recovery.renewConfirm", { positions: [3, 8, 21], words: [fresh[2], fresh[7], fresh[20]] }));
  assert.equal(out.status, "waiting");
  const rows = ok(await m.call<{ id: string; title: string; change?: true; ready: boolean; readyAtIso: string }[]>("account.waiting"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.title, "Replace your backup words");
  assert.equal(rows[0]!.change, true);
  assert.equal(rows[0]!.ready, false, "its time isn't up");
  assert.equal(rows[0]!.readyAtIso, out.readyAtIso, "the row says when it's ready");
  assert.ok(Date.parse(rows[0]!.readyAtIso) > Date.now() + 86_400e3);
});

test("app core: a waiting SetRecoveryKey is a row on account.waiting with its ready time (control: a ready one says ready)", async () => {
  const { core, a } = await v4Account();
  try {
    const later = Date.now() + 3 * 3_600_000;
    a.rules!.waiting.push({ id: 7, change: { SetRecoveryKey: { public_key: "ed25519:11111111111111111111111111111111" } }, readyAtNs: BigInt(later) * 1_000_000n, needsDevice: false, approved: false });
    const [row] = ok(await core.call<{ id: string; title: string; change?: true; ready: boolean; readyAtIso: string }[]>("account.waiting"));
    assert.equal(row!.id, "7");
    assert.equal(row!.title, "Add your backup words to your account");
    assert.equal(row!.change, true);
    assert.equal(row!.ready, false);
    assert.equal(Date.parse(row!.readyAtIso), later);
    a.rules!.waiting[0]!.readyAtNs = BigInt(Date.now() - 60_000) * 1_000_000n;
    const [now] = ok(await core.call<{ ready: boolean }[]>("account.waiting"));
    assert.equal(now!.ready, true, "control");
  } finally {
    core.close();
  }
});

// QA's k-trade3 lap (5 Nov), Home's rows: a swap said "Done in 51 s" 1 m 27 s before its SOL landed, and
// after an unlock a ghost "Moving $2.10 · Slower than usual" row showed for a move that had landed. Each test has its
// control.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import { afterEnd, foldInto, moveTrack, watchLive, type Folded, type LiveTrack, type Seen } from "./live-steps.ts";

const at = Date.now() - 40 * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const swap = (leg: SpendingActivity["status"]): Folded => ({
  id: "mv-lap-swap-key-0000001", kind: "top-up", usd: "2.10", status: "done", shown: true, atIso: iso(at), words: "Moving $2.10 to your SOL wallet", goesTo: ["sol"],
  legs: [{ id: "lap-leg-1", kind: "ready", usd: "2.07", status: leg, shown: true, atIso: iso(at + 51_000), words: "", network: "sol", of: "mv-lap-swap-key-0000001" }],
});

test("lap FAIL 3: a swap of the Safe's NEAR into SOL whose money is in the NEAR wallet and whose SOL leg is still on its way is not done: its last step waits for the leg's landing (control: the leg landed, done in the SOL wallet)", () => {
  const going = moveTrack(swap("on-its-way"), "Swap $2.10 of NEAR for SOL")!;
  assert.equal(going.end, undefined, "never \"Done\" with the SOL leg out");
  assert.notEqual(going.steps.at(-1)!.state, "done");
  assert.match(going.steps.at(-1)!.label, /SOL wallet/);
  const done = moveTrack(swap("done"), "Swap $2.10 of NEAR for SOL")!;
  assert.equal(done.end?.ok, true);
  assert.equal(done.end?.line, "In your SOL wallet.");
});

const track = (o: Partial<LiveTrack>): LiveTrack => ({ id: "move:m1", kind: "move", title: "Move $2.10 to your SOL wallet", wallets: [], startMs: at, steps: [{ label: "Arriving in your SOL wallet", state: "doing" }], ...o });

test("lap FAIL 4: a job whose end this phone already told is never drawn going or slow again (control: one never told is drawn; a told one that is still ended is drawn)", () => {
  const seen: Seen = { "move:m1": { start: at, done: {}, told: true } };
  const slow = track({ end: { ok: false, slow: true, line: "Slower than usual." } });
  assert.deepEqual(afterEnd([track({}), slow], seen), [], "the read behind its end draws nothing");
  assert.equal(afterEnd([track({})], { "move:m1": { start: at, done: {} } }).length, 1, "control: never told, drawn");
  assert.equal(afterEnd([track({ end: { ok: true, line: "In your SOL wallet." } })], seen).length, 1, "control: ended, drawn");
});

test("lap FAIL 4: after an unlock, the first read still shows a move that landed (and was told) on its way: no ghost row on Home (control: the same read for a move never told shows it)", async () => {
  const run = async (told: boolean) => {
    const store: Record<string, string> = { "live-seen": JSON.stringify({ "move:mv-first": { start: at, done: { 0: at }, ...(told ? { told: true } : {}) } }) };
    const stale: SpendingActivity = { id: "mv-first", kind: "top-up", usd: "2.10", status: "done", shown: true, atIso: iso(at), words: "Moving $2.10 to your SOL wallet", goesTo: ["sol"] };
    const bridge = {
      call: async (m: string, p?: { key: string; value: string }) => {
        if (m === "spending.activity") return { ok: [stale] };
        if (m === "device.store.get") return { ok: { value: store[p!.key] ?? null } };
        if (m === "device.store.set") { store[p!.key] = p!.value; return { ok: null }; }
        return { ok: null };
      },
      on: () => () => {},
    };
    let got: LiveTrack[] = [];
    const stop = watchLive(bridge as never, () => ({ adds: [], movements: [] }), (t) => { got = t; });
    await new Promise((r) => setTimeout(r, 20));
    stop();
    return got;
  };
  assert.deepEqual(await run(true), [], "told it landed: no \"Moving $2.10 · Slower than usual\" row");
  const control = await run(false);
  assert.equal(control.length, 1, "control: never told, the slow row shows");
  assert.equal(control[0]!.end?.slow, true);
});

// the Sim's top-up crawl, 5 Nov: a second live row "Move $2.91 to your SOL wallet · Leaving your NEAR wallet" beside the Add
test("lap FAIL 4: a site Add's leg 2 (`of` the Add) is a step of the Add's one track, named for the site's wallet, done only once leg 2 landed (control: a Move's own legs still fold under the Move)", () => {
  const add: SpendingActivity = { id: "mv-site-add-key-000001", kind: "top-up", usd: "3.00", status: "done", shown: true, atIso: iso(at), words: "Moving $3.00 to your pump.fun wallet", site: "pump" };
  const leg2 = (status: SpendingActivity["status"]): SpendingActivity => ({ id: "fm-leg2", kind: "ready", usd: "2.91", status, shown: true, atIso: iso(at + 30_000), words: "Adding $2.91 to your pump.fun wallet", network: "sol", of: add.id });
  const rows = foldInto([add, leg2("on-its-way")]);
  assert.equal(rows.length, 1, "one record, one row");
  const t = moveTrack(rows[0]!)!;
  assert.equal(t.title, "Add $3.00 to your pump.fun wallet");
  // train 16's named steps (who does the work, NAMED_STEP.land), named for the site's wallet, never "your SOL wallet"
  assert.equal(t.steps.at(-1)!.label, "Solana is landing it in your pump.fun wallet");
  assert.doesNotMatch(t.steps.map((x) => x.label).join(" | "), /SOL wallet/);
  assert.equal(t.end, undefined, "in the NEAR wallet is not in the site's wallet");
  const done = moveTrack(foldInto([add, leg2("done")])[0]!)!;
  assert.equal(done.end?.ok, true);
  assert.equal(done.end?.line, "In your pump.fun wallet.");
  // control: a Move's own leg still folds under the Move, named as before
  const move: SpendingActivity = { id: "mv-move-key-0000000001", kind: "top-up", usd: "5.00", status: "done", shown: true, atIso: iso(at), words: "Moving $5.00 to your SOL wallet", goesTo: ["sol"] };
  const legs = foldInto([move, { ...leg2("on-its-way"), id: "fm-leg-move", words: "Moving $4.90 to SOL", of: move.id }]);
  assert.equal(legs.length, 1);
  assert.equal(moveTrack(legs[0]!)!.title, "Move $5.00 to your SOL wallet");
});

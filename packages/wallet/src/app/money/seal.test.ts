// A closed money sheet hears nothing more (phone test, 3 Nov): what it asked that comes back after its Close is
// dropped, and anything it asks after that is never asked, so no next step, Problem screen or line follows a sheet
// that is gone (control: before the Close it answers as ever).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { sealBridge, sealShell } from "./seal.ts";

const tick = () => new Promise((r) => setTimeout(r, 5));
const settledIn = async (p: Promise<unknown>) => { let done = false; void p.then(() => (done = true)); await tick(); return done; };

test("sealBridge: before the Close it answers (control); a call in flight at the Close is dropped; one asked after is never asked; events stop", async () => {
  let gone = false, release!: (v: unknown) => void;
  const asked: string[] = [];
  const handlers: ((p: unknown) => void)[] = [];
  const inner: Bridge = {
    call: ((m: string) => { asked.push(m); return m === "slow" ? new Promise((r) => (release = r)) : Promise.resolve({ ok: 1 }); }) as Bridge["call"],
    on: (_e, h) => { handlers.push(h as (p: unknown) => void); return () => {}; },
  };
  const b = sealBridge(inner, () => gone);
  assert.deepEqual(await b.call("fast"), { ok: 1 }, "control: answers before the Close");
  const heard: unknown[] = [];
  b.on("x", (p) => heard.push(p));
  handlers[0]!("before");
  const inFlight = b.call("slow");
  gone = true;                                                           // the person taps ✕
  release({ ok: "late" });
  assert.equal(await settledIn(inFlight), false, "the late answer is dropped");
  assert.equal(await settledIn(b.call("next")), false, "a step after the Close never answers");
  assert.deepEqual(asked, ["fast", "slow"], "and is never asked");
  handlers[0]!("after");
  assert.deepEqual(heard, ["before"], "events stop at the Close");
});

test("sealShell: no Problem or Waiting screen for a closed sheet (control: before, the shell's own); opening an app stays", async () => {
  let gone = false;
  const shown: string[] = [];
  const shell = { bridge: { call: async () => ({ ok: 1 }), on: () => () => {} }, showProblem: async () => (shown.push("problem"), { kind: "nothing", label: "OK" }), showWaiting: () => void shown.push("waiting"), openApp: () => void shown.push("app") } as never;
  const s = sealShell(shell, () => gone);
  await s.showProblem({} as never);
  s.showWaiting({} as never);
  gone = true;
  assert.equal(await settledIn(s.showProblem({} as never)), false);
  s.showWaiting({} as never);
  s.openApp("trade" as never);
  assert.deepEqual(shown, ["problem", "waiting", "app"]);
});

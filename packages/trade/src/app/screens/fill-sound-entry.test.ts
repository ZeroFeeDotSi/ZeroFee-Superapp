// Bug report, 5 Nov (QA's re-check, item 7): a Buy from a Trade list row played no ting, because the row's tap
// never armed the sound (only the sheet's did) and a phone plays audio only once a touch woke it. Every entry point that
// rings on a fill must arm inside the tap, before anything is awaited; each is pinned here, with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import type { Bridge } from "@zerofee/core/bridge";
import { createFeedback } from "../feedback.ts";

const dir = new URL("./", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, dir), "utf8");

/** The body of the tap handler `const press = ...` up to its first await (what runs inside the touch). */
function beforeFirstAwait(src: string): string {
  const at = src.indexOf("const press = ");
  assert.ok(at >= 0, "a press handler");
  const body = src.slice(at);
  const aw = body.search(/\bawait\b|void tap\(\)/);
  return aw < 0 ? body : body.slice(0, aw);
}

test("every screen that rings on a fill arms the sound in its tap, before any await (control: a press without arm fails the check)", () => {
  const ringing = readdirSync(dir).filter((f) => f.endsWith(".tsx") && /feel\.filled\(/.test(read(f)));
  assert.deepEqual(ringing.sort(), ["Discover.tsx", "TradeSheet.tsx"], "the row chip and the sheet are the two entry points that ring");
  for (const f of ringing) {
    const src = read(f);
    // a component's press: each file has one; RowBuy's and the sheet's
    assert.match(beforeFirstAwait(src), /feel\.arm\(\)/, `${f}: arm() inside the tap`);
  }
  const control = "const press = async (el) => { busy.current = true; tapBurst(el, () => feel.key()); const rec = await svc.trade(p); void feel.filled(); };";
  assert.doesNotMatch(beforeFirstAwait(control), /feel\.arm\(\)/, "control: the old row press (filled, no arm) is caught");
});

test("the row's press: arm comes right after the tap's burst, before the ready check can return", () => {
  const press = beforeFirstAwait(read("Discover.tsx"));
  const arm = press.indexOf("feel.arm()"), early = press.indexOf("ready < quick");
  assert.ok(arm >= 0 && early >= 0 && arm < early, "armed before any early return");
});

test("the behaviour behind it: armed in the tap, the fill rings; never armed, a fill is silent (the row's old path)", async () => {
  const bridge = { call: async (m: string) => (m === "device.store.get" ? { ok: { value: null } } : { ok: {} }), on: () => () => {} } as unknown as Bridge;
  const run = async (arm: boolean) => {
    let made = 0, oscs = 0;
    const ctx = () => {
      made++;
      const node = () => ({ connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} } });
      return { currentTime: 0, destination: {}, state: "running", resume: async () => {}, createGain: node,
        createOscillator: () => { oscs++; return { ...node(), type: "", frequency: { setValueAtTime() {} }, start() {}, stop() {}, onended: null }; } } as never;
    };
    const f = createFeedback(bridge, ctx);
    if (arm) f.arm();
    await f.filled("buy");
    return { made, oscs };
  };
  assert.deepEqual(await run(true), { made: 1, oscs: 3 }, "armed: one AudioContext, three sines");
  assert.deepEqual(await run(false), { made: 0, oscs: 0 }, "control: never armed, no AudioContext, no sound");
});

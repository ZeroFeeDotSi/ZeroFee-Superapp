// The trade sheet's taps and sound: a fill is a success tap and a soft ting (only with Trade sounds on, only once armed by
// the tap), a sell's a step lower than a buy's; a refusal a warning tap, a keypad press a light tap; nothing here can fail a
// trade, and no sound file is ever asked for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { Bridge } from "@zerofee/core/bridge";
import { createFeedback, TRADE_SOUND_FILE } from "./feedback.ts";
import { savePrefs } from "./prefs.ts";

type Ev = [string, ...number[]];
interface Gain { events: Ev[]; out: unknown[]; disconnected: boolean }
interface Osc { type: string; freq: number[]; startAt: number[]; stopAt: number[]; out: unknown[]; disconnected: boolean; onended: (() => void) | null }

function setup() {
  const m = new Map<string, string>(), haptics: string[] = [];
  const bridge = {
    call: async (method: string, p: Record<string, string>) => {
      if (method === "device.haptic") { haptics.push(p.kind!); return { ok: { ok: true } }; }
      if (method === "device.store.get") return { ok: { value: m.get(p.key!) ?? null } };
      m.set(p.key!, p.value!); return { ok: {} };
    },
    on: () => () => {},
  } as unknown as Bridge;
  const oscs: Osc[] = [], gains: Gain[] = [];
  const destination = { name: "speaker" };
  let made = 0, resumed = 0;
  const ctx = () => {
    made++;
    return {
      currentTime: 2, destination, state: "suspended" as const, resume: async () => { resumed++; },
      createOscillator: () => {
        const o: Osc = { type: "", freq: [], startAt: [], stopAt: [], out: [], disconnected: false, onended: null };
        oscs.push(o);
        return Object.assign(o, { frequency: { setValueAtTime: (f: number) => o.freq.push(f) }, connect: (n: unknown) => o.out.push(n), disconnect: () => { o.disconnected = true; }, start: (t: number) => o.startAt.push(t), stop: (t: number) => o.stopAt.push(t) });
      },
      createGain: () => {
        const g: Gain = { events: [], out: [], disconnected: false };
        gains.push(g);
        const rec = (name: string) => (...a: number[]) => { g.events.push([name, ...a]); };
        return Object.assign(g, { gain: { setValueAtTime: rec("set"), linearRampToValueAtTime: rec("linear"), exponentialRampToValueAtTime: rec("exp"), setTargetAtTime: rec("target") }, connect: (n: unknown) => g.out.push(n), disconnect: () => { g.disconnected = true; } });
      },
    } as never;
  };
  return { bridge, haptics, oscs, gains, destination, ctx, made: () => made, resumed: () => resumed };
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

async function fill(side?: "buy" | "sell") {
  const s = setup(), f = createFeedback(s.bridge, s.ctx);
  f.arm();
  await f.filled(side);
  return s;
}

test("a buy: a success tap and the ting, three sines at 441, 882 and 1764 Hz, at 1.0, 0.5 and 0.08, dying away over 0.16, 0.11 and 0.05 s", async () => {
  const s = await fill("buy");
  assert.equal(s.resumed(), 1, "the phone's audio is let go inside the touch");
  assert.deepEqual(s.haptics, ["success"]);
  assert.deepEqual(s.oscs.map((o) => o.freq), [[441], [882], [1764]]);
  assert.ok(s.oscs.every((o) => o.type === "sine"));
  const [master, ...parts] = s.gains;
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((g) => g.events), [
    [["set", 1, 2], ["target", 0, 2.004, 0.16]],
    [["set", 0.5, 2], ["target", 0, 2.004, 0.11]],
    [["set", 0.08, 2], ["target", 0, 2.004, 0.05]],
  ]);
  parts.forEach((g, i) => { assert.equal(s.oscs[i]!.out[0], g, "each sine through its own level"); assert.equal(g.out[0], master, "into the master"); });
  assert.deepEqual(master!.out, [s.destination], "only the master reaches the speaker");
});

test("the master: 4 ms linear rise to 0.10 (V1's file played at 0.55), an exponential fade, 0.6 s in all; every sine stops at 0.6 s", async () => {
  const s = await fill("buy");
  const ev = s.gains[0]!.events;
  assert.deepEqual(ev[0], ["set", 0, 2]);
  assert.equal(ev[1]![0], "linear"); assert.equal(ev[1]![1], 0.1); assert.ok(close(ev[1]![2]!, 2.004));
  assert.equal(ev[2]![0], "exp"); assert.ok(ev[2]![1]! <= 0.001, "fades to nothing"); assert.ok(close(ev[2]![2]!, 2.6));
  const peak = Math.max(...ev.map((e) => (e[0] === "set" || e[0] === "linear" ? e[1]! : 0)));
  assert.equal(peak, 0.1, "never louder than 0.10");
  assert.ok(s.oscs.every((o) => o.startAt.length === 1 && o.startAt[0] === 2));
  assert.ok(s.oscs.every((o) => o.stopAt.length === 1 && close(o.stopAt[0]!, 2.6)), "stopped at 0.6 s");
});

test("no nodes left behind: once the last sine ends, every node is let go (control: not before)", async () => {
  const s = await fill("sell");
  s.oscs[0]!.onended!(); s.oscs[1]!.onended!();
  assert.ok(!s.gains[0]!.disconnected && s.oscs.every((o) => !o.disconnected), "control: still ringing, still wired");
  s.oscs[2]!.onended!();
  assert.ok(s.oscs.every((o) => o.disconnected), "the sines");
  assert.ok(s.gains.every((g) => g.disconnected), "their levels and the master");
});

test("a sell: the same shape a step lower, 350, 700 and 1400 Hz (control: a buy's is 441)", async () => {
  const s = await fill("sell");
  assert.deepEqual(s.oscs.map((o) => o.freq), [[350], [700], [1400]]);
  assert.deepEqual(s.gains.slice(1).map((g) => g.events.map((e) => e[1])), [[1, 0], [0.5, 0], [0.08, 0]]);
  assert.deepEqual(s.gains.slice(1).map((g) => g.events[1]![3]), [0.16, 0.11, 0.05]);
  assert.equal(s.gains[0]!.events[1]![1], 0.1);
  const b = await fill("buy");
  assert.equal(b.oscs[0]!.freq[0], 441);
});

test("one AudioContext for every tap and fill", async () => {
  const s = setup(), f = createFeedback(s.bridge, s.ctx);
  f.arm(); await f.filled("buy"); f.arm(); await f.filled("sell");
  assert.equal(s.made(), 1);
  assert.equal(s.oscs.length, 6, "two tings");
});

test("Trade sounds off: the tap still comes, no sound (control: on, it rings); never armed: no sound either", async () => {
  const s = setup(), f = createFeedback(s.bridge, s.ctx);
  await savePrefs(s.bridge, { v: 1, sounds: false });
  f.arm(); await f.filled("buy");
  assert.deepEqual(s.haptics, ["success"]);
  assert.equal(s.oscs.length, 0); assert.equal(s.gains.length, 0);
  await savePrefs(s.bridge, { v: 1, sounds: true });
  await f.filled("buy");
  assert.equal(s.oscs.length, 3, "control: sounds on, the ting");
  const s2 = setup(), g = createFeedback(s2.bridge, s2.ctx);
  await g.filled();
  assert.equal(s2.made(), 0); assert.equal(s2.oscs.length, 0);
  assert.deepEqual(s2.haptics, ["success"]);
});

test("a refusal is a warning tap, a keypad press a light one; no audio device at all is fine", async () => {
  const s = setup(), f = createFeedback(s.bridge, () => undefined);
  f.failed(); f.key(); f.arm(); await f.filled();
  assert.deepEqual(s.haptics, ["warning", "tap", "success"]);
  const broken = createFeedback({ call: async () => { throw new Error("no shell"); }, on: () => () => {} } as unknown as Bridge, () => { throw new Error("no audio"); });
  broken.arm(); broken.key(); broken.failed();
  await broken.filled();
});

test("no sound file: none is named, none ships, the default fetches nothing (control: a named file would be fetched)", async () => {
  assert.equal(TRADE_SOUND_FILE, null);
  assert.ok(!existsSync(new URL("../../../../apps/web/public/sounds/cha-ching.mp3", import.meta.url)), "the old file is gone");
  const real = globalThis.fetch, asked: string[] = [];
  globalThis.fetch = (async (u: string) => { asked.push(String(u)); throw new Error("no"); }) as typeof fetch;
  try {
    const s = setup(), f = createFeedback(s.bridge, s.ctx);
    f.arm(); await f.filled("buy");
    assert.deepEqual(asked, [], "nothing fetched");
    assert.equal(s.oscs.length, 3, "the drawn ting");
  } finally { globalThis.fetch = real; }
  const s = setup(), fetched: string[] = [];
  const ctx = () => ({ ...(s.ctx() as Record<string, unknown>), decodeAudioData: async () => { throw new Error("x"); } }) as never;
  createFeedback(s.bridge, ctx, "/control.wav", async (u) => { fetched.push(u); return new ArrayBuffer(0); }).arm();
  assert.deepEqual(fetched, ["/control.wav"], "control: a named file is read on the tap");
});

// What a person feels and hears from the trade sheet (V1 port slice 5; UI's device.haptic, 82c54f6): a success tap with a
// soft ting when a buy or sell fills, a warning tap when one is refused or fails, a light tap on each keypad press.
// The sound follows Trade's own "Trade sounds" (Settings, on by default); the taps follow the phone's own setting (the
// shell's call does nothing where there's no motor). The ting is drawn by Web Audio on the spot (bug report, 5 Nov: "the
// sound for buying and selling sucks"; the ask is a quiet hint that the trade filled): three sines, a 4 ms rise, then a fade,
// 0.6 s in all; a sell rings a step lower than a buy. No sound file ships. A phone plays audio only after a touch, so
// `arm()` is called inside the tap, and the sound plays when the fill comes back.
import type { Bridge } from "@zerofee/core/bridge";
import type { Side } from "../types.ts";
import { loadPrefs } from "./prefs.ts";

type Ctx = Pick<AudioContext, "currentTime" | "destination" | "createOscillator" | "createGain" | "resume" | "state"> & Partial<Pick<AudioContext, "createBufferSource" | "decodeAudioData">>;

/** No sound file: the ting below is drawn on the spot and nothing is asked for. A path here would play that file instead. */
export const TRADE_SOUND_FILE: string | null = null;
/** The level for a file, if one is ever named. */
const FILE_VOLUME = 0.55;
type CtxMaker = () => Ctx | undefined;

const browserCtx: CtxMaker = () => {
  const A = (globalThis as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext;
  return A ? new A() : undefined;
};

/** One sine of the ting: its pitch, its level, and how fast it dies away (the time-constant, in seconds). */
export interface TingTone { freq: number; gain: number; decay: number }
/** A buy: 441 Hz with its octave and a faint double octave. */
export const BUY_TING: readonly TingTone[] = [{ freq: 441, gain: 1, decay: 0.16 }, { freq: 882, gain: 0.5, decay: 0.11 }, { freq: 1764, gain: 0.08, decay: 0.05 }];
/** A sell: the same shape, a step lower. */
export const SELL_TING: readonly TingTone[] = [{ freq: 350, gain: 1, decay: 0.16 }, { freq: 700, gain: 0.5, decay: 0.11 }, { freq: 1400, gain: 0.08, decay: 0.05 }];
/** The loudest the whole ting gets (V1's file played at 0.55). */
export const TING_PEAK = 0.1;
/** The rise, then the whole length. */
export const TING_ATTACK = 0.004;
export const TING_LENGTH = 0.6;

/** The ting: three sines into one master level, 4 ms up, an exponential fade, everything stopped and let go at 0.6 s. */
export function ting(ctx: Ctx, side: Side): void {
  const t0 = ctx.currentTime, end = t0 + TING_LENGTH;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(TING_PEAK, t0 + TING_ATTACK);
  master.gain.exponentialRampToValueAtTime(0.0001, end);
  master.connect(ctx.destination);
  const nodes: AudioNode[] = [master];
  const parts = side === "sell" ? SELL_TING : BUY_TING;
  let left = parts.length;
  for (const p of parts) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(p.freq, t0);
    g.gain.setValueAtTime(p.gain, t0);
    g.gain.setTargetAtTime(0, t0 + TING_ATTACK, p.decay);
    o.connect(g); g.connect(master);
    nodes.push(o, g);
    // once the last sine has stopped, every node is let go: nothing stays wired to the speaker
    o.onended = () => { if (--left === 0) for (const n of nodes) n.disconnect(); };
    o.start(t0); o.stop(end);
  }
}

export interface Feedback {
  /** Inside the person's tap: lets the phone play the fill's sound later. */
  arm(): void;
  /** A buy or sell filled. */
  filled(side?: Side): Promise<void>;
  /** A trade was refused or failed (not a "no" the person said). */
  failed(): void;
  /** A keypad press. */
  key(): void;
}

export function createFeedback(bridge: Bridge, makeCtx: CtxMaker = browserCtx, file: string | null = TRADE_SOUND_FILE, fetchFile: (url: string) => Promise<ArrayBuffer> = (u) => fetch(u).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))): Feedback {
  // one AudioContext for the sheet, made (or woken) inside the first tap
  let ctx: Ctx | undefined;
  // a named file, read and decoded once, on the first tap (never before a person touched the page); none by default
  let buf: AudioBuffer | undefined;
  let loading: Promise<void> | undefined;
  const load = (c: Ctx) => {
    if (!file || buf || loading || !c.decodeAudioData) return;
    loading = fetchFile(file).then((a) => c.decodeAudioData!(a)).then((b) => { buf = b; }, () => { loading = undefined; });
  };
  const playFile = (c: Ctx): boolean => {
    if (!buf || !c.createBufferSource) return false;
    const src = c.createBufferSource(), gain = c.createGain();
    gain.gain.value = FILE_VOLUME;
    src.buffer = buf;
    src.connect(gain);
    gain.connect(c.destination);
    src.onended = () => { src.disconnect(); gain.disconnect(); };
    src.start();
    return true;
  };
  const haptic = (kind: "success" | "tap" | "warning") => { void bridge.call("device.haptic", { kind }).catch(() => undefined); };
  return {
    arm() {
      try { ctx ??= makeCtx(); if (ctx?.state === "suspended") void ctx.resume().catch(() => undefined); if (ctx) load(ctx); } catch { ctx = undefined; }
    },
    async filled(side: Side = "buy") {
      haptic("success");
      const p = await loadPrefs(bridge).catch(() => ({ sounds: true }));
      if (!p.sounds || !ctx) return;
      try { if (!playFile(ctx)) ting(ctx, side); } catch { /* no sound is never a failed trade */ }
    },
    failed() { haptic("warning"); },
    key() { haptic("tap"); },
  };
}

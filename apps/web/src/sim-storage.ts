// Sim's storage is its own (product decision, 3 Nov). The public
// build serves Sim and Real from one origin, so they would share localStorage and sessionStorage: the shell's tasks, the
// Browser's picks, AgentZero's asks, a kept Home. In Sim the page's storage is swapped, before any app code loads, for
// one that keeps every key under "sim:" (simStorage); Real's keys keep their names, so nothing of a real account moves.
// Shared by both: the theme, the mode choice itself, and this layout's version (none of them money). The sample's own
// "zf.demo.*" keys are Sim's by name. Switching modes reloads the page (mode.ts switchWebMode), so memory never crosses.
//
// The public origin ran only the sample demo before this (its keys unprefixed): adoptOldDemo moves those keys under
// "sim:" once, so a sample task or pick never shows in Real. It moves nothing where a real account may live here.
import { WEB_MODE_KEY } from "./mode.ts";
import { WEB_LINE_HIDDEN_KEY } from "@zerofee/shell-api/web-wallet-words.ts";

export const SIM_PREFIX = "sim:";
/** This layout's version (adoptOldDemo ran here). */
export const LAYOUT_KEY = "zf.web.layout";
// the web line's × (WEB_LINE_HIDDEN_KEY): closed in one mode, closed in both
const SHARED: ReadonlySet<string> = new Set(["zf.theme", "zf.theme.picked", WEB_MODE_KEY, LAYOUT_KEY, WEB_LINE_HIDDEN_KEY]);
const shared = (key: string) => SHARED.has(key) || key.startsWith("zf.demo.");
/** The key Sim reads and writes in place of `key`. */
export const simKey = (key: string) => (shared(key) ? key : `${SIM_PREFIX}${key}`);

/** The page's storage as Sim sees it: every key under "sim:" (but the shared ones). Every call goes to `base`. */
export function simStorage(base: Storage): Storage {
  const own = () => {
    const out: string[] = [];
    for (let i = 0; i < base.length; i++) {
      const k = base.key(i);
      if (k === null) continue;
      if (k.startsWith(SIM_PREFIX)) out.push(k.slice(SIM_PREFIX.length));
      else if (shared(k)) out.push(k);
    }
    return out;
  };
  return {
    getItem: (key: string) => base.getItem(simKey(String(key))),
    setItem: (key: string, value: string) => base.setItem(simKey(String(key)), String(value)),
    removeItem: (key: string) => base.removeItem(simKey(String(key))),
    key: (i: number) => own()[i] ?? null,
    get length() {
      return own().length;
    },
    // Sim's own keys only: Real's (and the shared ones) stay
    clear: () => {
      for (const k of own()) if (!shared(k)) base.removeItem(`${SIM_PREFIX}${k}`);
    },
  };
}

/**
 * In Sim, before any app code: `localStorage` and `sessionStorage` become Sim's own. True when both now are; false when
 * the browser wouldn't let us (the caller then doesn't start Sim: fail closed).
 */
export function installSimStorage(g: typeof globalThis = globalThis): boolean {
  try {
    for (const name of ["localStorage", "sessionStorage"] as const) {
      const base = g[name];
      const sim = simStorage(base);
      Object.defineProperty(g, name, { value: sim, configurable: true, enumerable: true, writable: false });
      if (g[name] !== sim) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Once per browser, in either mode: the old public demo's keys (unprefixed, sample money) move under "sim:". Nothing moves
 * where a real account may live here: any "mainnet:" key, or `realHere` (the page saw a mainnet vault, or couldn't tell).
 */
export function adoptOldDemo(base: Storage, realHere: boolean): "moved" | "kept" | "done" {
  try {
    if (base.getItem(LAYOUT_KEY)) return "done";
    const keys: string[] = [];
    for (let i = 0; i < base.length; i++) {
      const k = base.key(i);
      if (k !== null) keys.push(k);
    }
    const real = realHere || keys.some((k) => k.startsWith("mainnet:"));
    if (!real) {
      for (const k of keys) {
        if (shared(k) || k.startsWith(SIM_PREFIX)) continue;
        const v = base.getItem(k);
        if (v !== null) base.setItem(`${SIM_PREFIX}${k}`, v);
        base.removeItem(k);
      }
    }
    base.setItem(LAYOUT_KEY, "1");
    return real ? "kept" : "moved";
  } catch {
    // blocked storage: nothing kept, nothing to move
    return "done";
  }
}

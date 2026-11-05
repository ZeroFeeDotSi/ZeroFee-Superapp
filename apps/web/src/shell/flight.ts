// The test flight recorder (product decision, 4 Nov): while a tester walks the real app (the iPhone app, the laptop link), every
// step reaches its reader within about a second, sealed end to end, so a button that "does nothing" shows its cause.
// For the test builds only: main.tsx loads this file only when the build sets VITE_TEST_TRACE=1 (never the
// public build), and it starts only with VITE_TEST_TRACE_KEY (the reader's X25519 public key) and VITE_TEST_TRACE_ID.
//
// What it records: screen changes (the app, the pushed page or selected tab, the top sheet's name); taps (the nearest
// button or link's aria-label or text, at most 40 characters); every call through the shell's one bridge (flight-tap.ts:
// the method, ms, ok or the Problem's code and whatHappened); uncaught errors and unhandled rejections (the message and
// its first stack frame); long tasks over 200 ms; visibility; and the source (phone or laptop).
// Never: a call's params or result, an input's value, an address, a key, words, a phrase, a token, the clipboard. Every
// free text passes `scrub` (addresses, hex, long tokens, emails, NEAR names, word runs), and a tap whose label is a bare
// lowercase word (a recovery word's chip) or a key of the keypad is recorded as "[word]" or "[key]".
//
// Batches: every second, or at 30 events (never more often than every 600 ms, so at most 100 POSTs a minute, under the
// relay's 120), sealed (flight-seal.ts) and POSTed to the relay's /v0/trace/<id>, fire and forget. Past 500 queued,
// new events are dropped and counted. Nothing here ever throws into the app or waits on the network.
import { onPhone } from "@zerofee/shell-api/approval-words.ts";
import { TRACE_ID, readerKey, sealBatch } from "./flight-seal.ts";
import { setFlightSink, type CallNote } from "./flight-tap.ts";
import { setStepSink, type StepNote } from "@zerofee/shell-api/step-trace.ts";

export type FlightEvent =
  | { t: number; k: "start" }
  | { t: number; k: "screen"; app: string; view?: string; sheet?: string }
  | { t: number; k: "tap"; l: string; dis?: 1 }
  | { t: number; k: "call"; m: string; ms: number; code?: string; what?: string; threw?: string }
  | { t: number; k: "error"; msg: string; at?: string }
  | { t: number; k: "long"; ms: number }
  | { t: number; k: "vis"; s: string }
  | { t: number; k: "drop"; n: number }
  /** A named step (packages/shell-api step-trace.ts): a site's sign-in through ZeroFee's wallet. Fixed words only. */
  | { t: number; k: "step"; s: string; h: string; r: string; ms?: number };

/** A step note as the recorder sends it: its name, the site's host, the fixed reason word, its time. */
export const stepEvent = (n: StepNote, t: number): FlightEvent => ({ t, k: "step", s: n.s, h: n.host, r: n.r, ...(n.ms !== undefined ? { ms: n.ms } : {}) });

export const QUEUE_MAX = 500;
export const BATCH_AT = 30;
const BATCH_MAX = 100;
const GAP_MS = 600;
const SEALED_MAX = 60_000;

/** Free text, made safe to leave the phone: anything that could be an address, a key, a token, an email, a NEAR name or
 *  a run of words is replaced; whitespace collapsed; at most `max` characters. */
export function scrub(raw: unknown, max: number): string {
  let s = typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : String(raw);
  s = s
    .replace(/\b(?:https?|wss?|zerofee-app|chrome-extension):\/\/([^/\s?#"'<>]+)[^\s"'<>)]*/gi, "$1/…")
    .replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, "@…")
    .replace(/0x[0-9a-fA-F]{6,}/g, "0x…")
    .replace(/\b[0-9a-fA-F]{16,}\b/g, "#…")
    .replace(/[A-Za-z0-9+/_=-]{24,}/g, "…")
    .replace(/\b[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.(?:near|testnet|tg)\b/g, "….near")
    .replace(/\b(?:[a-z]{3,8}\s+){11,}[a-z]{3,8}\b/g, "[words]")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A Problem code or a method name: a plain dotted name, else "?". */
const nameOk = (s: unknown, max = 80): string => (typeof s === "string" && /^[A-Za-z0-9._:-]{1,80}$/.test(s) ? s.slice(0, max) : "?");

/** A bridge call's event: the method, its ms, and ok or the Problem's code and whatHappened (never params or results). */
export function callEvent(n: CallNote, t: number): FlightEvent {
  const e: Extract<FlightEvent, { k: "call" }> = { t, k: "call", m: nameOk(n.method), ms: Math.max(0, Math.round(n.ms)) };
  if (n.code !== undefined) e.code = nameOk(n.code);
  if (n.what !== undefined) e.what = scrub(n.what, 140);
  if (n.threw !== undefined) e.threw = scrub(n.threw, 140);
  return e;
}

/** What an element is called, for a tap: its aria-label or its text, scrubbed, at most 40 characters. A bare lowercase
 *  word (a recovery word's chip, a suggestion) is "[word]"; a keypad's digit or point is "[key]". */
export function labelText(raw: string): string {
  const s = scrub(raw, 40);
  if (/^(?:\d{1,2}[.)]?\s*)?[a-z]+(?:\s+[a-z]+)*$/.test(s)) return "[word]";
  if (/^[\d.,·]{1,3}$/.test(s)) return "[key]";
  return s;
}

type El = { tagName?: string; className?: unknown; textContent?: string | null; disabled?: boolean; getAttribute(n: string): string | null; closest(s: string): El | null };
const TAPPABLE = "button, a[href], [role=button], [role=tab], [role=option], [role=switch], [role=menuitem], [role=link], [role=checkbox], [role=radio], summary";
const FIELD = "input, textarea, select, [contenteditable]";

/** A tap's event for the element under the finger, or null when it isn't on anything tappable. A field is named by its
 *  label only, never its value. */
export function tapOf(target: El | null, t: number): FlightEvent | null {
  if (!target || typeof target.closest !== "function") return null;
  const field = target.closest(FIELD);
  if (field) return { t, k: "tap", l: `field ${scrub(field.getAttribute("aria-label") ?? field.getAttribute("placeholder") ?? field.getAttribute("type") ?? (field.tagName ?? "").toLowerCase(), 34)}`.trim() };
  const el = target.closest(TAPPABLE);
  if (!el) return null;
  const named = el.getAttribute("aria-label") ?? el.textContent ?? "";
  let l = labelText(named);
  if (!l) {
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).find((c) => /^[a-z][\w-]{0,30}$/i.test(c)) : undefined;
    l = `${(el.tagName ?? "?").toLowerCase()}${cls ? `.${cls}` : ""}`;
  }
  const dis = el.disabled === true || el.getAttribute("aria-disabled") === "true";
  return dis ? { t, k: "tap", l, dis: 1 } : { t, k: "tap", l };
}

/** A stack's first frame: "fn file.js:12:34" (no origin, no query), or undefined. */
export function firstFrame(stack: unknown): string | undefined {
  if (typeof stack !== "string") return undefined;
  for (const line of stack.split("\n")) {
    const loc = line.match(/([^/\s(@]+?)(?:\?[^:\s)]*)?:(\d+):(\d+)\)?\s*$/);
    if (!loc) continue;
    const fn = line.match(/^\s*at\s+([^\s(]+)\s+\(/)?.[1] ?? line.match(/^\s*([^@\s]+)@/)?.[1] ?? "";
    return scrub(`${fn ? `${fn} ` : ""}${loc[1]}:${loc[2]}:${loc[3]}`, 120);
  }
  return undefined;
}

/** An error's event: its message (scrubbed) and first frame. A rejection with a Problem in it names its code. */
export function errorOf(reason: unknown, t: number, fallbackAt?: string): FlightEvent {
  let msg: string;
  if (reason instanceof Error) msg = `${reason.name}: ${reason.message}`;
  else if (typeof reason === "string") msg = reason;
  else if (reason && typeof reason === "object" && "code" in reason) msg = `problem ${nameOk((reason as { code: unknown }).code)}`;
  else msg = `[${typeof reason}]`;
  const at = firstFrame(reason instanceof Error ? reason.stack : undefined) ?? fallbackAt;
  return at ? { t, k: "error", msg: scrub(msg, 160), at } : { t, k: "error", msg: scrub(msg, 160) };
}

export interface Recorder {
  push(e: FlightEvent): void;
  /** Seal and send what is queued. `final`: the page is going away (keepalive, no gap). */
  flush(final?: boolean): void;
  queued(): number;
}

/** The queue, the batches and the seal. `post` sends one sealed batch and answers the relay's status (never awaited by
 *  the app). */
export function createRecorder({ reader, id, url, source, post, now = Date.now }: { reader: Uint8Array; id: string; url: string; source: "phone" | "laptop"; post: (url: string, body: string, final: boolean) => Promise<number>; now?: () => number }): Recorder {
  const queue: FlightEvent[] = [];
  let dropped = 0;
  let seq = 0;
  let last = -Infinity;
  let pausedUntil = 0;
  const flush = (final = false) => {
    try {
      const t = now();
      if (queue.length === 0 && dropped === 0) return;
      if (!final && (t - last < GAP_MS || t < pausedUntil)) return;
      const batch = queue.splice(0, BATCH_MAX);
      if (dropped) (batch.unshift({ t, k: "drop", n: dropped }), (dropped = 0));
      let box = sealBatch(JSON.stringify({ v: 1, src: source, seq, ev: batch }), reader, id);
      while (box.length > SEALED_MAX && batch.length > 1) {
        queue.unshift(...batch.splice(Math.ceil(batch.length / 2)));
        box = sealBatch(JSON.stringify({ v: 1, src: source, seq, ev: batch }), reader, id);
      }
      seq++;
      last = t;
      if (box.length > SEALED_MAX) return;
      post(url, box, final).then(
        (status) => {
          if (status === 429) pausedUntil = now() + 10_000;
        },
        () => undefined,
      );
    } catch {
      // never into the app
    }
  };
  return {
    push(e) {
      if (queue.length >= QUEUE_MAX) {
        dropped++;
        return;
      }
      queue.push(e);
      if (queue.length >= BATCH_AT) flush();
    },
    flush,
    queued: () => queue.length,
  };
}

const sendBatch = (url: string, body: string, final: boolean): Promise<number> =>
  fetch(url, { method: "POST", headers: { "content-type": "text/plain" }, body, keepalive: final, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" }).then((r) => r.status);

/** Starts the recorder (main.tsx, the test builds only). False, and nothing at all happens, without a valid reader
 *  key, trace id and relay. */
export async function startFlight(cfg: { key?: string; id?: string; relay?: string }): Promise<boolean> {
  const reader = readerKey(cfg.key);
  const id = typeof cfg.id === "string" ? cfg.id.trim() : "";
  const relay = typeof cfg.relay === "string" && /^https:\/\/[^/?#\s]+$/.test(cfg.relay.trim().replace(/\/$/, "")) ? cfg.relay.trim().replace(/\/$/, "") : "";
  if (!reader || !TRACE_ID.test(id) || !relay || typeof document === "undefined") return false;
  const rec = createRecorder({ reader, id, url: `${relay}/v0/trace/${id}`, source: onPhone() ? "phone" : "laptop", post: sendBatch });
  const at = () => Date.now();
  rec.push({ t: at(), k: "start" });
  setFlightSink((n) => rec.push(callEvent(n, at())));
  setStepSink((n) => rec.push(stepEvent(n, at())));

  // Taps: the finger's element, even a disabled button (its click never fires: that is the "does nothing" case).
  document.addEventListener("pointerdown", (e) => {
    try {
      const hit = (e.target as unknown as El | null)?.closest?.(`${TAPPABLE}, ${FIELD}`) ? (e.target as unknown as El) : (document.elementFromPoint(e.clientX, e.clientY) as unknown as El | null);
      const ev = tapOf(hit, at());
      if (ev) rec.push(ev);
    } catch {
      // never into the app
    }
  }, { capture: true, passive: true });
  // a keyboard's press (Enter, Space) is a click with no pointer
  document.addEventListener("click", (e) => {
    if (e.detail !== 0) return;
    const ev = tapOf(e.target as El | null, at());
    if (ev) rec.push(ev);
  }, { capture: true, passive: true });

  addEventListener("error", (e: ErrorEvent) => {
    const file = typeof e.filename === "string" && e.filename ? `${e.filename.split(/[?#]/)[0]!.split("/").pop()}:${e.lineno}:${e.colno}` : undefined;
    rec.push(e.error !== undefined && e.error !== null ? errorOf(e.error, at(), file) : errorOf(String(e.message ?? ""), at(), file));
  });
  addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => rec.push(errorOf(e.reason, at())));

  // Long tasks over 200 ms: the browser's own report where it has one (Chrome), else a timer that notices it ran late
  // (WebKit has no longtask entries); never across a visibility change.
  let visAt = 0;
  if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
    new PerformanceObserver((list) => {
      for (const x of list.getEntries()) if (x.duration > 200) rec.push({ t: at(), k: "long", ms: Math.round(x.duration) });
    }).observe({ type: "longtask" });
  } else {
    let tick = performance.now();
    setInterval(() => {
      const n = performance.now();
      const late = n - tick - 100;
      tick = n;
      if (late > 200 && document.visibilityState === "visible" && Date.now() - visAt > 1000) rec.push({ t: at(), k: "long", ms: Math.round(late) });
    }, 100);
  }

  document.addEventListener("visibilitychange", () => {
    visAt = Date.now();
    rec.push({ t: at(), k: "vis", s: document.visibilityState });
    if (document.visibilityState === "hidden") rec.flush(true);
  });
  addEventListener("pagehide", () => rec.flush(true));

  // Screens: the app on screen (screen-app.ts), the pushed page's name or the selected tab, and the top sheet's name.
  const { screenAppNow } = await import("./screen-app.ts");
  const shown = (el: Element) => el.getClientRects().length > 0;
  const lastShown = (sel: string) => [...document.querySelectorAll(sel)].filter(shown).pop();
  const nameOf = (el: Element | undefined): string => {
    if (!el) return "";
    const by = el.getAttribute("aria-labelledby");
    const label = el.getAttribute("aria-label") ?? (by ? document.getElementById(by)?.textContent : null) ?? "";
    return scrub(label, 40) || "sheet";
  };
  let was = "";
  setInterval(() => {
    try {
      if (document.visibilityState !== "visible") return;
      const app = nameOk(screenAppNow() || "none", 40);
      const view = scrub((lastShown(".af-top .zf-label")?.textContent ?? lastShown('[role=tab][aria-selected="true"]')?.textContent) ?? "", 40);
      const sheet = nameOf(lastShown('[role="dialog"], [role="alertdialog"]'));
      const key = `${app}|${view}|${sheet}`;
      if (key === was) return;
      was = key;
      rec.push({ t: at(), k: "screen", app, ...(view ? { view } : {}), ...(sheet ? { sheet } : {}) });
    } catch {
      // never into the app
    }
  }, 250);

  setInterval(() => rec.flush(), 1000);
  return true;
}

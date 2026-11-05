// Chrome's DevTools protocol over a pipe, for the extension's scripted checks (link-e2e.ts, worker-wake.ts): Chrome
// started with --remote-debugging-pipe reads fd 3 and writes fd 4; messages end with \0.
import type { Readable, Writable } from "node:stream";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Cdp {
  private id = 0;
  private pending = new Map<number, { ok: (v: any) => void; no: (e: Error) => void }>();
  private buf = "";
  private w: Writable;
  private listeners: ((m: any) => void)[] = [];
  constructor(w: Writable, r: Readable) {
    this.w = w;
    r.on("data", (d: Buffer) => {
      this.buf += d.toString("utf8");
      for (let i; (i = this.buf.indexOf("\0")) >= 0;) {
        const m = JSON.parse(this.buf.slice(0, i));
        this.buf = this.buf.slice(i + 1);
        const p = m.id && this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); m.error ? p.no(new Error(`${m.error.message}`)) : p.ok(m.result); }
        else if (m.method) for (const f of this.listeners) f(m);
      }
    });
  }
  /** Events (no id): console errors and exceptions, for the log. */
  on(f: (m: any) => void) { this.listeners.push(f); }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    return new Promise((ok, no) => this.pending.set(id, { ok, no }));
  }
}

/** An expression for the first element matching `sel` that is shown and not inside an inert neighbour app. */
export const live = (sel: string) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.offsetParent && !e.closest("[inert]"))`;

/** A page or worker, driven by evaluating small expressions in it. */
export function page(cdp: Cdp, session: string) {
  const js = async <T>(expression: string, opts: { gesture?: boolean } = {}): Promise<T> => {
    const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: opts.gesture ?? false }, session);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  const visibleButton = (match: string) => `[...document.querySelectorAll("button")].find((b) => b.offsetParent && !b.disabled && !b.closest("[inert]") && (${match}))`;
  return {
    js,
    async waitFor(expression: string, what: string, ms = 30_000): Promise<boolean> {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (await js<boolean>(`Boolean(${expression})`).catch(() => false)) return true; await sleep(250); }
      throw new Error(`timed out waiting for ${what}`);
    },
    /** Presses the visible, enabled button whose own text is exactly `text`. */
    async press(text: string) {
      const ok = await js<boolean>(`(() => { const b = ${visibleButton(`b.textContent.trim() === ${JSON.stringify(text)}`)}; if (!b) return false; b.click(); return true; })()`, { gesture: true });
      if (!ok) throw new Error(`no button "${text}"`);
    },
    async pressLabel(label: string) {
      const ok = await js<boolean>(`(() => { const b = ${visibleButton(`b.getAttribute("aria-label") === ${JSON.stringify(label)}`)}; if (!b) return false; b.click(); return true; })()`, { gesture: true });
      if (!ok) throw new Error(`no button labelled "${label}"`);
    },
    /** Presses the row (a button) holding `text` as one of its lines. */
    async pressRow(text: string) {
      const ok = await js<boolean>(`(() => { const t = [...document.querySelectorAll("button span")].find((s) => s.textContent.trim() === ${JSON.stringify(text)} && !s.closest("[inert]")); const b = t && t.closest("button"); if (!b) return false; b.click(); return true; })()`, { gesture: true });
      if (!ok) throw new Error(`no row "${text}"`);
    },
    /** Types into a React input (the native setter, then an input event), without the value ever reaching the log. */
    async type(selector: string, value: string) {
      const ok = await js<boolean>(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); if (!i) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
      if (!ok) throw new Error(`no input ${selector}`);
    },
    text: (selector: string) => js<string | null>(`${live(selector)}?.textContent?.trim() ?? null`),
    has: (needle: string) => js<boolean>(`(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n; (n = w.nextNode());) if (n.textContent.includes(${JSON.stringify(needle)}) && !n.parentElement.closest("[inert]")) return true; return false; })()`),
    async key(key: string, code: number) { for (const type of ["keyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: code }, session); },
  };
}


/** A link code's shape (Crockford base32, 5-5, or 10 in a row): never printed, whatever a line holds. */
const CODE = /\b[0-9A-HJKMNP-TV-Z]{5}-?[0-9A-HJKMNP-TV-Z]{5}\b/g;
export const redact = (s: string) => s.replace(CODE, "(code)");

/** A log for the scripted checks: UTC time, seconds since `t0`, and the line with any code-shaped text taken out. */
export function makeLog(t0 = Date.now()) {
  let failed = false;
  const log = (s: string) => console.log(redact(`${new Date().toISOString().slice(11, 19)}Z +${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${s}`));
  const check = (ok: boolean, what: string) => { log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failed = true; return ok; };
  return { log, check, failed: () => failed };
}

type Target = { targetId: string; type: string; url: string };
export const targets = async (cdp: Cdp) => (await cdp.send("Target.getTargets")).targetInfos as Target[];
export const workerOf = async (cdp: Cdp, extId: string) => (await targets(cdp)).find((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${extId}/`));

/** Stops the extension's worker, as Chrome does to an idle one; true once it is gone. `session`: one of its pages. */
export async function stopWorker(cdp: Cdp, extId: string, session: string): Promise<boolean> {
  const gone = async () => { for (let i = 0; i < 20; i++) { if (!(await workerOf(cdp, extId))) return true; await sleep(250); } return false; };
  await cdp.send("ServiceWorker.enable", {}, session).catch(() => undefined);
  await cdp.send("ServiceWorker.stopAllWorkers", {}, session).catch(() => undefined);
  if (await gone()) return true;
  const sw = await workerOf(cdp, extId);
  if (sw) await cdp.send("Target.closeTarget", { targetId: sw.targetId }).catch(() => undefined);
  return gone();
}

/**
 * Opens the side panel the way a person does, with the toolbar button (the worker sets it to open the panel just after
 * it starts, so the press is repeated until the panel is there). The panel's page target.
 */
export async function openPanel(cdp: Cdp, extId: string): Promise<{ targetId: string }> {
  const url = `chrome-extension://${extId}/panel.html`;
  for (let i = 0; i < 10; i++) {
    const tab = ((await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] })).targetInfos as Target[]).find((t) => t.type === "tab" && !t.url.startsWith("chrome-extension://"));
    if (tab) await cdp.send("Extensions.triggerAction", { id: extId, targetId: tab.targetId }).catch(() => undefined);
    for (let j = 0; j < 8; j++) {
      const p = (await targets(cdp)).find((t) => t.type === "page" && t.url === url);
      if (p) return p;
      await sleep(250);
    }
  }
  throw new Error("the side panel didn't open from the toolbar button");
}

/**
 * Chrome's flags for the checks. Headless Chrome has no browser UI, so it never opens a side panel: the checks use a
 * window placed off screen instead, with the fake camera and permission flags (nothing asks the person anything).
 */
export const chromeFlags = (profile: string, extra: string[] = []) => [
  "--window-position=-2400,-2400", "--window-size=1280,900", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", ...extra, "about:blank",
];

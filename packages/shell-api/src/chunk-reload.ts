// A deploy swaps the web app's chunks under an open page: the next screen whose code loads later asks for a file that is
// gone, and the page shows "Trade stopped working." until the person reloads by hand (QA Sim crawl, 5 Nov,
// 030, 057). Here the page reloads once by itself instead, onto the new build.
//
// Never a loop: before it reloads, it stamps sessionStorage with the build it is on and the time. The same build asking
// again within RELOAD_WINDOW_MS shows the normal error (the files really are missing, or the person is offline).
// Never on the phone: the iPhone app loads its own files (zerofee-app://app), so a missing chunk there is no deploy, and a
// reload would fix nothing. Never under a job that is just starting (a "job:" row the page alone carries): that row would
// end as closed, so the normal error shows and the job goes on. Every other job row is in Home's sealed store and
// survives a reload (job-start.ts sealJobs); the reload waits for its last write first.
// Never offline (audit 12 C1): a reload with no network is Chrome's own "No internet" page, and the person's app, Jobs
// and figures are gone. Offline, the screen says so in the app's own words (offlineWords) and asks for the chunk again
// once the phone is back (whenOnline); only a chunk still missing then is a deploy, and reloads.

/** The sessionStorage key of the last reload: { build, at }. */
export const CHUNK_RELOAD_KEY = "zf.chunk-reload.v1";
/** A second chunk error on the same build within this time is shown, not reloaded. */
export const RELOAD_WINDOW_MS = 30_000;
/** How long the reload waits for the job rows' last write. */
export const SETTLE_CAP_MS = 1_500;

/** The error a chunk that didn't arrive throws, in every browser this app runs in, and Vite's own CSS preload. */
const CHUNK_WORDS = [
  /Failed to fetch dynamically imported module/i, // Chrome, Edge
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari, iOS
  /Unable to preload CSS/i, // Vite's preload helper
  /Loading (CSS )?chunk [^ ]+ failed/i,
];

/** True only for an error that says a chunk's file didn't arrive. */
export function isChunkError(e: unknown): boolean {
  if (!e || typeof e !== "object") return typeof e === "string" && CHUNK_WORDS.some((re) => re.test(e));
  const x = e as { name?: unknown; message?: unknown; payload?: unknown; cause?: unknown };
  if (x.name === "ChunkLoadError") return true;
  if (typeof x.message === "string" && CHUNK_WORDS.some((re) => re.test(x.message as string))) return true;
  // vite:preloadError's event carries the error as payload
  return x.payload !== undefined && x.payload !== e ? isChunkError(x.payload) : false;
}

export interface ChunkReloadDeps {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  now: () => number;
  /** The build this page is on (its entry script's hashed name). */
  build: () => string;
  /** The page reloads. */
  reload: () => void;
  /** The iPhone app's own files: never reloads. */
  native: () => boolean;
  /** The page has a network (navigator.onLine): offline it never reloads. */
  online: () => boolean;
  /** A job the page alone carries is starting: never reloads under it. */
  busy: () => boolean;
  /** Resolves once the job rows' last write is in (capped by SETTLE_CAP_MS). */
  settled: () => Promise<unknown>;
}

let deps: ChunkReloadDeps | null = null;
let reloading = false;

/** The page's own answers (main.tsx calls it once, at start). */
export function setChunkReloadDeps(d: Partial<ChunkReloadDeps>): void {
  deps = { ...pageDeps(), ...deps, ...d };
}

/** Tests: forget the page's answers and any reload under way. */
export function resetChunkReload(): void { deps = null; reloading = false; }

/** A reload is already on its way: draw nothing new (no error flashes before the page goes). */
export function chunkReloading(): boolean { return reloading; }

function pageDeps(): ChunkReloadDeps {
  const g = globalThis as { sessionStorage?: Storage; document?: Document; location?: Location };
  return {
    storage: (() => { try { return g.sessionStorage ?? null; } catch { return null; } })(),
    now: () => Date.now(),
    build: () => g.document?.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute("src") ?? "dev",
    reload: () => g.location?.reload(),
    native: () => g.location?.protocol === "zerofee-app:",
    online: () => typeof navigator === "undefined" || navigator.onLine !== false,
    busy: () => false,
    settled: () => Promise.resolve(),
  };
}

/**
 * On a chunk error: reload once, onto the new build. True if a reload is on its way (the caller can draw nothing);
 * false for any other error, on the phone, offline, under a starting job, or when this build already reloaded within the window
 * (the caller shows its normal error).
 */
export function reloadForChunk(e: unknown): boolean {
  if (reloading) return true;
  if (!isChunkError(e)) return false;
  const d = (deps ??= pageDeps());
  if (d.native() || d.busy() || !d.online()) return false;
  const build = d.build(), at = d.now();
  let last: { build?: unknown; at?: unknown } | null = null;
  try { last = JSON.parse(d.storage?.getItem(CHUNK_RELOAD_KEY) ?? "null"); } catch { last = null; }
  if (last && last.build === build && typeof last.at === "number" && at - last.at >= 0 && at - last.at < RELOAD_WINDOW_MS) return false;
  // no storage to stamp means no guard: never reload without one
  try { d.storage!.setItem(CHUNK_RELOAD_KEY, JSON.stringify({ build, at })); } catch { return false; }
  reloading = true;
  const cap = new Promise((ok) => setTimeout(ok, SETTLE_CAP_MS));
  void Promise.race([d.settled().catch(() => undefined), cap]).then(() => d.reload());
  return true;
}

/** Listens for Vite's own chunk error (every later import in a build goes through it). The error still reaches its
 *  caller, so a page that doesn't reload shows the normal error. Returns the way to stop listening. */
export function installChunkReload(target: Pick<Window, "addEventListener" | "removeEventListener">): () => void {
  const on = (ev: Event) => { reloadForChunk((ev as Event & { payload?: unknown }).payload ?? ev); };
  target.addEventListener("vite:preloadError", on);
  return () => target.removeEventListener("vite:preloadError", on);
}

/** True while the page has no network (the same answer reloadForChunk asks). */
export function chunkOffline(): boolean { return !(deps ??= pageDeps()).online(); }

/** What a screen whose code didn't arrive says while offline, in the app's own words: never Chrome's page. */
export const offlineWords = (name?: string): string => `You're offline. Your money is safe. ${name ? `${name} opens` : "This opens"} when you're back.`;

/** Calls `again` once when the phone is back online (the window's online event). Returns the way to stop waiting. */
export function whenOnline(again: () => void): () => void {
  const g = globalThis as { addEventListener?: Window["addEventListener"]; removeEventListener?: Window["removeEventListener"] };
  if (typeof g.addEventListener !== "function") return () => undefined;
  const on = () => { stop(); again(); };
  const stop = () => g.removeEventListener?.("online", on);
  g.addEventListener("online", on);
  return stop;
}

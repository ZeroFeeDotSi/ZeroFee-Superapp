// QA's MUST (Sim crawl, 5 Nov/030/057): a deploy swapped the chunks under an open page, and every later screen
// showed "Trade stopped working." until a hand reload. A chunk error now reloads the page once, onto the new build, and
// never loops. Each test has its control.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { CHUNK_RELOAD_KEY, RELOAD_WINDOW_MS, chunkReloading, installChunkReload, isChunkError, reloadForChunk, resetChunkReload, setChunkReloadDeps } from "./chunk-reload.ts";
import { STARTING, jobStarting, jobsWritten, sealJobs, startJob } from "./job-start.ts";
import { taskStore } from "./tasks.ts";
import type { Bridge } from "@zerofee/core/bridge";

const CHROME = new TypeError("Failed to fetch dynamically imported module: https://app.zerofee.si/assets/TradeApp-AbC123.js");
const SAFARI = new TypeError("Importing a module script failed.");
const FIREFOX = new TypeError("error loading dynamically imported module: https://app.zerofee.si/assets/Receive-x.js");
const CSS = new Error("Unable to preload CSS for /assets/Trade-x.css");
const flush = () => new Promise((r) => setTimeout(r, 5));

function page(o: { native?: boolean; busy?: boolean; build?: string; storage?: boolean; settled?: () => Promise<unknown> } = {}) {
  const m = new Map<string, string>();
  const p = { m, reloads: 0, now: 1_000_000, build: o.build ?? "/assets/index-AAA.js" };
  resetChunkReload();
  setChunkReloadDeps({
    storage: o.storage === false ? null : { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) },
    now: () => p.now,
    build: () => p.build,
    reload: () => void p.reloads++,
    native: () => o.native === true,
    busy: () => o.busy === true,
    settled: o.settled ?? (() => Promise.resolve()),
  });
  return p;
}
/** The next page load: the same tab's sessionStorage, nothing else from before. */
function nextLoad(p: ReturnType<typeof page>) {
  const kept = new Map(p.m);
  const q = page({ build: p.build });
  for (const [k, v] of kept) q.m.set(k, v);
  q.now = p.now;
  return q;
}

beforeEach(() => resetChunkReload());

test("the chunk errors of Chrome, Safari, Firefox and Vite's CSS preload are chunk errors; anything else is not (control)", () => {
  for (const e of [CHROME, SAFARI, FIREFOX, CSS, { name: "ChunkLoadError", message: "x" }, { payload: CHROME }]) assert.equal(isChunkError(e), true, String((e as Error).message));
  for (const e of [new Error("Cannot read properties of undefined (reading 'tradeApp')"), new TypeError("Failed to fetch"), new Error("Solana didn't answer"), null, undefined, 42, { payload: new Error("boom") }]) assert.equal(isChunkError(e), false, String(e));
});

test("a chunk error reloads the page exactly once, after the job rows' last write (control: before that write, no reload yet)", async () => {
  let written!: () => void;
  const p = page({ settled: () => new Promise<void>((ok) => (written = ok)) });
  assert.equal(reloadForChunk(CHROME), true);
  assert.equal(chunkReloading(), true);
  // the same page's other lazy screens fail too: still one reload
  assert.equal(reloadForChunk(SAFARI), true);
  assert.equal(reloadForChunk(new Error("anything")), true);
  await flush();
  assert.equal(p.reloads, 0, "waits for the job rows' write");
  written();
  await flush();
  assert.equal(p.reloads, 1);
  assert.deepEqual(JSON.parse(p.m.get(CHUNK_RELOAD_KEY)!), { build: "/assets/index-AAA.js", at: 1_000_000 });
});

test("a second chunk error on the same build inside the window shows the error and doesn't reload (controls: past the window, or on a new build, it reloads once more)", async () => {
  const p = page();
  assert.equal(reloadForChunk(CHROME), true);
  await flush();
  assert.equal(p.reloads, 1);
  // the reloaded page is still on the same build (the old index.html was served again): it shows the normal error
  const q = nextLoad(p);
  q.now += RELOAD_WINDOW_MS - 1;
  assert.equal(reloadForChunk(CHROME), false);
  assert.equal(chunkReloading(), false);
  await flush();
  assert.equal(q.reloads, 0);
  // control: past the window, the same build may reload once more
  const r = nextLoad(q);
  r.now = p.now + RELOAD_WINDOW_MS;
  assert.equal(reloadForChunk(CHROME), true);
  await flush();
  assert.equal(r.reloads, 1);
  // control: a newer build inside the window reloads once
  const s = nextLoad(r);
  s.build = "/assets/index-BBB.js";
  assert.equal(reloadForChunk(CHROME), true);
  await flush();
  assert.equal(s.reloads, 1);
});

test("an error that isn't a chunk error never reloads and leaves no stamp (control: a chunk error on the same page does)", async () => {
  const p = page();
  assert.equal(reloadForChunk(new Error("Cannot read properties of undefined (reading 'tradeApp')")), false);
  assert.equal(reloadForChunk(new TypeError("Failed to fetch")), false);
  await flush();
  assert.equal(p.reloads, 0);
  assert.equal(p.m.has(CHUNK_RELOAD_KEY), false);
  assert.equal(reloadForChunk(CHROME), true);
  await flush();
  assert.equal(p.reloads, 1);
});

test("the phone never reloads (its files are its own), nor a page with no session storage to stamp (control: the web page does)", async () => {
  const phone = page({ native: true });
  assert.equal(reloadForChunk(SAFARI), false);
  await flush();
  assert.equal(phone.reloads, 0);
  const blind = page({ storage: false });
  assert.equal(reloadForChunk(CHROME), false);
  await flush();
  assert.equal(blind.reloads, 0);
  const web = page();
  assert.equal(reloadForChunk(SAFARI), true);
  await flush();
  assert.equal(web.reloads, 1);
});

test("a job that is just starting is never reloaded under (control: once its real row came, it reloads)", async () => {
  const tasks = taskStore().forApp("wallet");
  const job = startJob(tasks, { title: "Move $5.00" });
  assert.ok(job.id.startsWith(STARTING));
  assert.equal(jobStarting(), true);
  const p = page({ busy: jobStarting() });
  assert.equal(reloadForChunk(CHROME), false);
  await flush();
  assert.equal(p.reloads, 0);
  job.made([]);
  assert.equal(jobStarting(), false);
  const q = page({ busy: jobStarting() });
  assert.equal(reloadForChunk(CHROME), true);
  await flush();
  assert.equal(q.reloads, 1);
});

test("jobsWritten waits for the job rows' write into Home's sealed store (control: with nothing writing it is done at once)", async () => {
  let done = false;
  await jobsWritten().then(() => (done = true));
  assert.equal(done, true);
  const sealed = new Map<string, string>();
  let release!: () => void;
  const gate = new Promise<void>((ok) => (release = ok));
  const bridge = {
    call: async (method: string, p: Record<string, unknown> = {}) => {
      if (method === "device.store.get") return { ok: { value: null } };
      if (method === "device.store.set") { await gate; sealed.set(String(p.key), String(p.value)); return { ok: { ok: true } }; }
      return { problem: { code: "unknown" } };
    },
    on: () => () => undefined,
  } as unknown as Bridge;
  assert.equal(await sealJobs(bridge, undefined), true);
  const job = startJob(taskStore().forApp("wallet"), { title: "Send $3.00" });
  let written = false;
  const w = jobsWritten().then(() => (written = true));
  await flush();
  assert.equal(written, false);
  release();
  await w;
  assert.equal(written, true);
  assert.match(sealed.get("job-rows.v1") ?? "", /Send \$3\.00/);
  job.gone();
  await jobsWritten();
});

test("Vite's vite:preloadError reloads the page once; the event's error still reaches its caller (control: a non-chunk payload doesn't)", async () => {
  const p = page();
  const t = new EventTarget();
  const off = installChunkReload(t as unknown as Window);
  const ev = (payload: unknown) => Object.assign(new Event("vite:preloadError", { cancelable: true }), { payload });
  const other = ev(new Error("boom"));
  t.dispatchEvent(other);
  await flush();
  assert.equal(p.reloads, 0);
  const chunk = ev(CHROME);
  t.dispatchEvent(chunk);
  assert.equal(chunk.defaultPrevented, false, "the import still throws to its own error screen");
  await flush();
  assert.equal(p.reloads, 1);
  off();
});

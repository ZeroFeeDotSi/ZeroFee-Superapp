// the audit's MUST (8 Nov; product decision, 5 Nov: every action looks done at once, "Job created." and the time left): Private's
// way home made NO Jobs row. Its core moves (ledger.fromPrivate: kind "private" from "private", one per coin) were handed to
// its job as "send:<id>" rows, but no live track is ever made for them (live-steps sendTrack leaves Private's way home
// out), so the job's starting row was dropped after HANDOFF_MS and Jobs had nothing. Now the coins are parts of one job
// (their carry) and that job's own row goes on in place: going, then done once every coin is in the Safe. Both the Sim
// (MockBridge on the test's own clock) and the real ledger's record (private-pay.ts fromPrivate), plus controls. Drawn
// through vite's loader as private-home-sheet.test.ts does.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { createTaskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { simClock } from "@zerofee/shell-api/testing/sim-clock.ts";
import type { Bridge } from "@zerofee/core/bridge";
import { fromPrivate as ledgerFromPrivate } from "../../private-pay.ts";
import type { Balance, Movement } from "../../types.ts";
import type { LiveTrack } from "../money/live-steps.ts";

type Mod = typeof import("./Private.tsx");
let server: ViteDevServer;
let P: Mod;
// one module graph with the page (vite's): the job's carry and its watch are the page's own
let L: typeof import("../money/live-steps.ts");
let C: typeof import("@zerofee/shell-api/job-carry.ts");
before(async () => {
  server = await createServer({ configFile: false, root: fileURLToPath(new URL(".", import.meta.url)), logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  P = (await server.ssrLoadModule("./Private.tsx")) as Mod;
  L = (await server.ssrLoadModule("../money/live-steps.ts")) as typeof L;
  C = (await server.ssrLoadModule("@zerofee/shell-api/job-carry.ts")) as typeof C;
});
after(async () => { await server?.close(); });

const turn = () => new Promise<void>((r) => setImmediate(r));

/** Approve on Private's sheet (the screen's own handlers), the task store, and Home's live watch publishing to it (as
 *  LiveHome does). `movements`: what Home's feed holds (ledger.activity). */
async function approve(bridge: Pick<Bridge, "call" | "on">, movements: () => Promise<Movement[]>, rows: Balance[], usd: string) {
  const store = createTaskStore();
  const tasks = store.forApp("wallet");
  let feed: Movement[] = [];
  const sent = new Map<string, string>();
  const watch = L.watchLive(bridge as Bridge, () => ({ adds: [], movements: feed }), (list: LiveTrack[], _c, tell) => L.publishTracks(tasks, tell ?? list, sent));
  let step: import("./Private.tsx").HomeStep = "no";
  const set = (s: typeof step) => { step = s; };
  const plan = P.homePlan(rows, Number(usd.slice(1)));
  const taps = P.homeTaps({ step: () => step, set, run: () => P.homeFromPrivate({ tasks, caps: plan.caps, usd, bridge, set, onProblem: () => {}, refresh: () => {} }) });
  taps.open();
  taps.approve();
  const read = async () => { feed = await movements(); watch.poke(); for (let i = 0; i < 6; i++) await turn(); };
  const jobs = (): Task[] => store.list().filter((t) => t.id.startsWith("job:"));
  return { read, jobs, all: () => store.list(), step: () => step, stop: () => watch() };
}

const SIM_ROWS: Balance[] = [
  { tokenId: "usdc", symbol: "USDC", amount: "30", usd: "30", held: "private", chain: "near" } as unknown as Balance,
];

test("Sim: Approve on Private's Move makes ONE Jobs row, going (its time left, NEAR Confidential named) then done, for two coins [before: the row went after HANDOFF_MS, none ended]", async () => {
  const clock = simClock();
  const mock = clock.watch(createMockBridge({ latencyMs: 0, settleMs: 50, timers: clock.timers, hiddenStart: { usdc: "30", near: "1.5" } }));
  const pocket = await mock.call<{ rows: Balance[] }>("ledger.private", {});
  assert.ok("ok" in pocket);
  const rows = pocket.ok.rows.filter((r) => Number(r.amount) > 0);
  assert.equal(rows.length, 2, "two coins in Private");
  const total = `$${rows.reduce((n, r) => n + Number(r.usd), 0).toFixed(2)}`;
  const s = await approve(mock, async () => { const r = await mock.call<Movement[]>("ledger.activity", { limit: 50 }); return "ok" in r ? r.ok : []; }, rows, total);
  await clock.quiet();
  await s.read();
  const going = s.jobs();
  assert.equal(going.length, 1, "one job row");
  assert.equal(going[0]!.state, "pending", "going");
  assert.equal(going[0]!.usd, total);
  assert.ok(typeof going[0]!.endsAt === "number" && going[0]!.endsAt > going[0]!.startedAt, "its time left");
  assert.ok(going[0]!.steps.some((x) => x.label === L.HOME_TRACK_WORDS.doing && x.state === "doing"), JSON.stringify(going[0]!.steps));
  assert.equal(s.step(), "sent");
  // the two coins' own moves are parts of it, never rows of their own
  assert.equal(s.all().filter((t) => t.id.startsWith("send:")).length, 0, "no row per coin");
  await clock.advance(60);
  await s.read();
  const done = s.jobs();
  assert.equal(done.length, 1, "still one row");
  assert.equal(done[0]!.state, "done", "fails before: the row was left pending (then dropped), never done");
  assert.equal(done[0]!.detail, L.HOME_TRACK_WORDS.landed);
  assert.ok(done[0]!.steps.some((x) => x.label === "Through NEAR Confidential" && x.state === "done"), "NEAR Confidential named on its receipt");
  s.stop();
});

test("core path: the real ledger's record (private-pay.ts fromPrivate, the core's subwallet.private.home) is ONE Jobs row going then done [before: none]", async () => {
  const record: Movement[] = [];
  let n = 0;
  const homes: Record<string, { id: string; status: string }> = {};
  const call = async (m: string, p?: Record<string, unknown>): Promise<never> => {
    if (m === "ledger.fromPrivate") {
      const out = await ledgerFromPrivate<{ id: string; status: string }>(p ?? {}, "wallet", {
        rows: [{ tokenId: "nep141:usdc.near", amount: "30" }, { tokenId: "near", amount: "1.5" }],
        decimals: () => 6,
        home: async (tokenId) => { const ok = { id: `pm-${++n}`, status: "pending" }; homes[tokenId] = ok; return { ok }; },
        status: (x) => (x.status === "done" ? "done" : "moving"),
        remember: async (x) => { record.unshift(x); },
        emit: () => {},
        iso: () => new Date().toISOString(),
      });
      return { ok: out } as never;
    }
    if (m === "ledger.activity") return { ok: record.map((x) => ({ ...x })) } as never;
    return { problem: { code: "x.none", whatHappened: "none", money: { state: "safe", where: "" }, next: { kind: "nothing" } } } as never;
  };
  const bridge = { call, on: () => () => {} } as unknown as Bridge;
  const rows: Balance[] = [
    { tokenId: "nep141:usdc.near", symbol: "USDC", amount: "30", usd: "30", held: "private", chain: "near" } as unknown as Balance,
    { tokenId: "near", symbol: "NEAR", amount: "1.5", usd: "3.86", held: "private", chain: "near" } as unknown as Balance,
  ];
  const s = await approve(bridge, async () => ((await call("ledger.activity")) as unknown as { ok: Movement[] }).ok, rows, "$33.86");
  for (let i = 0; i < 6; i++) await turn();
  await s.read();
  assert.equal(record.length, 2, "two coins, two core moves");
  assert.equal(s.jobs().length, 1);
  assert.equal(s.jobs()[0]!.state, "pending", "going");
  // the core's record ends each coin done
  for (const m of record) m.status = "done";
  await s.read();
  const [job] = s.jobs();
  assert.equal(s.jobs().length, 1, "one row");
  assert.equal(job!.state, "done", "fails before: never done");
  assert.equal(job!.usd, "$33.86");
  s.stop();
});

test("control: a coin out of Private with no job (the sweep, an older build) makes no track; a part stopped ends the one job failed with where the money is", () => {
  const at = Date.now();
  const m = (id: string, status: Movement["status"]): Movement => ({ id, kind: "private", from: "private", to: "usdc", amount: "1", status, startedAtIso: new Date(at).toISOString(), updatedAtIso: new Date(at + 5_000).toISOString(), explorerUrls: [] } as unknown as Movement);
  assert.deepEqual(L.homeTracks([m("home:a", "moving")], () => undefined), []);
  // a Send from Private is not a way home
  assert.deepEqual(L.homeTracks([{ ...m("home:b", "moving"), kind: "pay" } as Movement], () => "job:x"), []);
  const [t] = L.homeTracks([m("home:a", "done"), m("home:b", "problem")], () => "job:x", () => "$2.00");
  assert.equal(t!.id, "job:x");
  assert.deepEqual(t!.end, { ok: false, line: L.HOME_TRACK_WORDS.part, whole: true });
  const [ok] = L.homeTracks([m("home:a", "done"), m("home:b", "done")], () => "job:x");
  assert.deepEqual(ok!.end, { ok: true, line: L.HOME_TRACK_WORDS.landed });
  assert.equal(ok!.steps[2]!.atMs, 5000, "Done in its own time");
  // a carried part joins its job (the page's own carry)
  C.carryTo(["send:home:c"], { job: "job:y" });
  assert.equal(L.homeTracks([m("home:c", "moving")])[0]!.id, "job:y");
});

test("the copy review's trims: the one-slider sheet's bar reads Check this; the page's job line has the time left, then \"Landed in your Safe.\" for 60 s on the page's clock, then goes", () => {
  const html = renderToStaticMarkup(createElement(P.MoveAllSheet, { usd: "$20.00", stays: "$13.86", slide: { value: 20, max: 33.86, onChange: () => {} }, onApprove: () => {}, onClose: () => {} }));
  assert.match(html, /<div class="zf-label zf-sheet__title">Check this<\/div>/, "fails before: Move");
  const t0 = 1_000_000;
  // the audit's Move S4 (8 Nov): two short lines, never four ideas on one
  assert.equal(P.madeLine(t0, t0), "Job created. About 10 seconds left.\nIt goes through NEAR Confidential. Watch it in Activity.");
  assert.equal(P.madeLine(t0, t0 + 4_000), "Job created. About 6 seconds left.\nIt goes through NEAR Confidential. Watch it in Activity.");
  assert.match(renderToStaticMarkup(createElement(P.HomeRow, { step: "sent", has: false, onOpen: () => {}, line: P.madeLine(t0, t0) })), /Job created\. About 10 seconds left\.<br\/>It goes through NEAR Confidential\./);
  assert.equal(P.PRIVATE_MOVE_WORDS.landed, "Landed in your Safe.");
  assert.equal(P.landedShown(t0, t0), true);
  assert.equal(P.landedShown(t0, t0 + 59_999), true);
  assert.equal(P.landedShown(t0, t0 + 60_000), false, "gone after 60 s");
  assert.equal(P.landedShown(null, t0), false);
  assert.equal(P.allLanded(["a", "b"], [{ id: "a", status: "done" }, { id: "b", status: "done" }]), true);
  assert.equal(P.allLanded(["a", "b"], [{ id: "a", status: "done" }, { id: "b", status: "problem" }]), false, "control: one stopped is not landed");
  // the row: the given line while it goes; nothing once it landed (the slot under the figure says so)
  assert.match(renderToStaticMarkup(createElement(P.HomeRow, { step: "sent", has: false, onOpen: () => {}, line: P.madeLine(t0, t0) })), /data-testid="private-home-made">Job created\. About 10 seconds left\./);
  assert.equal(renderToStaticMarkup(createElement(P.HomeRow, { step: "sent", has: false, onOpen: () => {}, line: null })), "");
});

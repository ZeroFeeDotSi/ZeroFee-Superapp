// A site wallet's Take out as Home's own job (QA's real $2 Take out, 5 Nov): its row on Now from the core's
// record, followed to its end, its page with proof, and one row only. Each test has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { backPage, backTrack, BACK_WORDS, type SiteBack } from "./site-back.ts";
import { taskOf, watchLive, type LiveTrack } from "./live-steps.ts";

const T0 = Date.parse("2026-11-05T19:05:00Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();
const DEP1 = "7W2aAzTvNRkvGZD6QcdupwUsiFjV3fhfUgVxKP9Dv2o6", DEP2 = "ab".repeat(32);  // generated sample
const back = (o: Partial<SiteBack["back"]> = {}, home?: SiteBack["home"]): SiteBack => ({ back: { id: "fm-moveback-key-1", status: "pending", usd: 2, site: "pump", startedAtIso: iso(0), updatedAtIso: iso(0), ...o }, ...(home ? { home } : {}) });
const states = (t: LiveTrack) => t.steps.map((s) => s.state).join(" ");

test("a Take out's row follows the core's record to its end: going, landed, came back, stopped (each says where the money is)", () => {
  const going = backTrack(back(), T0);
  assert.equal(going.id, "back:fm-moveback-key-1");
  assert.equal(going.title, "Take $2.00 out of your pump.fun wallet");
  assert.deepEqual(going.steps.map((s) => s.label), ["Out of your pump.fun wallet", "Through NEAR Confidential", "Into your Safe"]);
  assert.equal(states(going), "doing waiting waiting");
  assert.equal(going.end, undefined, "still going: no end");
  const legTwo = backTrack(back({ status: "done", updatedAtIso: iso(60), settled: { amountOut: "1900000" } }, { status: "pending" }), T0);
  assert.equal(states(legTwo), "done done doing");
  // under $2 into Spending: the least that lands, said before it lands (the audit's NIT); control: $5 says just where it goes
  assert.equal(legTwo.steps[2]!.label, "Into your Safe. At least $1.86 lands.");
  assert.equal(backTrack(back({ status: "done", settled: { amountOut: "5000000" } }, { status: "pending" }), T0).steps[2]!.label, "Into your Safe");
  assert.match(readFileSync(new URL("../../../../core/src/float-floors.ts", import.meta.url), "utf8"), /HOME_LEAST_PERCENT = 98n/, "the 98 % is the core's own");
  assert.equal(legTwo.steps[1]!.atMs, 60_000, "its time from the core's own record");
  const landed = backTrack(back({ status: "done", updatedAtIso: iso(60) }, { status: "done", updatedAtIso: iso(200) }), T0);
  assert.deepEqual(landed.end, { ok: true, line: BACK_WORDS.done });
  assert.equal(states(landed), "done done done");
  // 1Click gave leg 1 back: the core's refund goes to Spending (refundTo the NEAR wallet), never "your pump.fun wallet"
  const refunded = backTrack(back({ status: "refunded", updatedAtIso: iso(90) }), T0);
  assert.deepEqual(refunded.end, { ok: false, line: "The swap didn't go through. It's in your NEAR wallet." });
  const failed = backTrack(back({ status: "failed" }), T0);
  assert.equal(failed.end!.line, "Nothing left your pump.fun wallet.");
  const homeBack = backTrack(back({ status: "done", settled: { amountOut: "1900000" } }, { status: "refunded" }), T0);
  assert.deepEqual(homeBack.end, { ok: false, line: "It didn't reach your Safe. $1.90 is in your NEAR wallet." });
  // leg 2 refused (the core's words on the move back): said, with what arrived; control: without them it is still going
  const stopped = backTrack(back({ status: "done", settled: { amountOut: "1900000" }, homeStopped: "1Click's price was too low." }), T0);
  assert.deepEqual(stopped.end, { ok: false, line: "It didn't reach your Safe. $1.90 is in your NEAR wallet." });
  assert.equal(states(stopped), "done done failed");
  assert.equal(backTrack(back({ status: "done", settled: { amountOut: "1900000" } }), T0).end, undefined, "control: no words, still going");
});

test("its Activity centre task opens its own page in Home's Activity (never the Browser), with its proof and both 1Click deposits", () => {
  const b = back({ status: "done", proof: { start: { chain: "sol", hash: "np53HV", url: "https://solscan.io/tx/np53HV" }, deposit: DEP1, privateEnd: true } }, { status: "done", proof: { deposit: DEP2, privateStart: true, end: { chain: "near", hash: "Hh1", url: "https://evil.example/tx/Hh1" } } });
  assert.equal(taskOf(backTrack(b)).open?.route, "activity:back:fm-moveback-key-1");
  const page = backPage(b);
  assert.deepEqual(page.swaps, [DEP1, DEP2], "View: each leg's deposit on NEAR Intents' explorer");
  assert.deepEqual(page.started, { tx: { chain: "sol", hash: "np53HV", url: "https://solscan.io/tx/np53HV" } });
  assert.deepEqual(page.steps[1]!.end, { private: true }, "Spending's side has no public record: said, never a made-up link");
  assert.deepEqual(page.finished, { tx: { chain: "near", hash: "Hh1" } }, "control: a link off the explorers' list is dropped");
  assert.equal(page.done, true);
  assert.equal(backPage(back()).done, undefined, "control: going, not done");
  // the Activity screen sends "back:" ids to this page
  const act = readFileSync(new URL("../screens/Activity.tsx", import.meta.url), "utf8");
  assert.match(act, /openId\?\.startsWith\("back:"\) \? openBack/);
});

test("Home's watch reads the Take outs (that read is what resumes leg 2 after a reload) and shows one as its own row; control: none, no row", async () => {
  for (const backs of [[back({ status: "done", startedAtIso: new Date().toISOString() }, { status: "pending" })], []]) {
    const asked: string[] = [];
    const bridge = {
      call: async (m: string) => {
        asked.push(m);
        if (m === "subwallet.site.moveBacks") return { ok: backs };
        if (m === "spending.activity") return { ok: [] };
        return { ok: { value: null } };
      },
      on: () => () => {},
    };
    let got: LiveTrack[] = [];
    const stop = watchLive(bridge as never, () => ({ adds: [], movements: [] }), (t) => { got = t; });
    await new Promise((r) => setTimeout(r, 20));
    stop();
    assert.ok(asked.includes("subwallet.site.moveBacks"), "read on open, no tap");
    assert.equal(got.length, backs.length);
    if (backs.length) assert.equal(states(got[0]!), "done done doing");
  }
});

test("one row: the Browser no longer makes its own Take out task (QA: its row opened the Browser tab)", () => {
  for (const f of ["SiteWalletApp.tsx", "SocialHub.tsx", "YourWallets.tsx"]) {
    const src = readFileSync(new URL(`../../../../browser/src/social/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /backTask\(|followBack\(/, f);
    assert.match(src, /kind: "siteback"/, `control: ${f} still opens the Take out`);
  }
});

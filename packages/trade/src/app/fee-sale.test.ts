// QA 16's two MUSTs on the S6 shots (8 Nov): once Sell is tapped and the fee asked, the job runs on its own with the page
// closed (the fee lands, the sale goes, Activity's Now row carries it; a job ends early only before any money moved), and
// the receipt's time is the whole job, from the tap to sold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ProblemError } from "@zerofee/core/problem";
import { saleAfterFee } from "./fee-sale.ts";
import { gasEnd } from "./sale-gas.ts";

const short = () => new ProblemError({ code: "trade.sol.low", whatHappened: "You need a little more SOL.", nextStep: { kind: "retry" } } as never);
function rig(o: { quotes: (() => unknown)[]; trade?: () => Promise<{ id: string; status: string }>; feeFailed?: boolean }) {
  const log: string[] = [];
  let t = 1_000, asked = 0, sold = 0;
  const tasks = {
    publish: () => true,
    update: (id: string, p: { steps?: { label: string; state: string }[]; detail?: string }) => { log.push(`update ${id} ${p.steps?.map((s) => `${s.label}:${s.state}`).join(",") ?? ""} ${p.detail ?? ""}${(p as { endsAt?: number }).endsAt ? ` ends ${(p as { endsAt?: number }).endsAt}` : ""}`.replace(/ +/g, " ").trim()); return true; },
    end: (id: string, state: string, detail?: string) => { log.push(`end ${id} ${state} ${detail ?? ""}`.trim()); return true; },
  };
  const run = saleAfterFee({
    quote: async () => { const q = o.quotes[Math.min(asked++, o.quotes.length - 1)]!; const r = q(); if (r instanceof Error) throw r; return { ready: async () => {} }; },
    trade: async () => { sold++; return o.trade ? o.trade() : { id: "r1", status: "done" }; },
    tasks, id: "trade-1", at: 900, feeFailed: () => !!o.feeFailed, walletName: "your SOL wallet", back: "Back in your SOL wallet",
    doneDetail: () => "Sold in 5.10 s",
    now: () => t, sleep: async (ms) => { t += ms; }, limitMs: 10_000, everyMs: 1_500,
  });
  return { run, log, sold: () => sold, asked: () => asked };
}

test("the page closed while the fee moves: the sale goes by itself once the fee lands, once, and the job ends done", async () => {
  const r = rig({ quotes: [short, short, () => ({})] });
  assert.equal(await r.run, "done");
  assert.equal(r.asked(), 3, "asked again while the fee was on its way");
  assert.equal(r.sold(), 1, "one sale");
  assert.deepEqual(r.log, [
    "update trade-1 Fees first · $2.50:done,Sent:doing,Landed:waiting,Back in your SOL wallet:waiting ends 6000",
    "update trade-1 Fees first · $2.50:done,Sent:done,Landed:done,Back in your SOL wallet:done Sold in 5.10 s",
    "end trade-1 done Sold in 5.10 s",
  ]);
});

test("the fee came back: nothing sold, the job says where the money is; another no ends it said; too long ends it said", async () => {
  const back = rig({ quotes: [short], feeFailed: true });
  assert.equal(await back.run, "failed");
  assert.equal(back.sold(), 0);
  assert.deepEqual(back.log, [`end trade-1 failed ${gasEnd({ failed: true, walletName: "your SOL wallet" }).detail}`]);
  const no = rig({ quotes: [() => new ProblemError({ code: "trade.coin.unsellable", whatHappened: "No one is buying this coin right now.", nextStep: { kind: "retry" } } as never)] });
  assert.equal(await no.run, "failed");
  assert.deepEqual(no.log, ["end trade-1 failed No one is buying this coin right now."]);
  const late = rig({ quotes: [short] });
  assert.equal(await late.run, "failed");
  assert.equal(late.sold(), 0);
  assert.match(late.log.at(-1)!, /^end trade-1 failed The fee didn't reach your SOL wallet in time, so nothing was sold\. Your coins are still in your SOL wallet\.$/);
  // a sale the chain refused ends with its own words
  const refused = rig({ quotes: [() => ({})], trade: async () => ({ id: "r1", status: "failed", problem: { whatHappened: "The price moved too much." } }) as never });
  assert.equal(await refused.run, "failed");
  assert.match(refused.log.at(-1)!, /end trade-1 failed The price moved too much\./);
});

test("the sheet: closing after the fee was asked hands the job on (never ends it); the receipt is timed from the tap", () => {
  const src = readFileSync(new URL("./screens/TradeSheet.tsx", import.meta.url), "utf8");
  const close = src.slice(src.indexOf("const tappedAmt = useRef(amt);"), src.indexOf("}, []);", src.indexOf("const tappedAmt = useRef(amt);")));
  assert.match(close, /if \(!gasAskedRef\.current\) \{ const e = gasEnd\(\{ failed: false, closed: true, walletName \}\); tasks\?\.end\(job\.id, e\.state, e\.detail\); return; \}/);
  assert.match(close, /void saleAfterFee\(\{/);
  assert.match(close, /trade: \(p\) => svc\.trade\(p, undefined, \{ task: job\.id, tapAt: job\.at \}\)/, "the closed page's sale is timed from the tap too");
  assert.match(src, /setGasAsked\(true\);\n    gasAskedRef\.current = true;/);
  assert.match(src, /    const at = tapAt\.current \|\| performance\.now\(\);/);
  assert.doesNotMatch(src, /gasJob\.current \? performance\.now\(\)/, "never timed from when the sale went");
  assert.match(src, /disabled=\{side === "sell" && gasAsked && queued === intent && v !== value\}/, "the amount can't change once its fee was asked");
  assert.equal(gasEnd({ failed: false, closed: true, walletName: "your SOL wallet" }).detail, "You closed it before anything moved. Nothing was sold.");
});

test("QA 16's MUST: the job shows time left from its first frame: the Move sheet's NEAR wallet to chain leg, then the sale's", async () => {
  const { gasJobEndsAt, saleEndsAt, SALE_SEC } = await import("./sale-gas.ts");
  const { LEG_SEC, timeLeft, TIME_WORDS } = await import("@zerofee/shell-api/job-steps.ts");
  assert.equal(gasJobEndsAt(0), (LEG_SEC.nearOut + SALE_SEC) * 1000);
  assert.equal(timeLeft(gasJobEndsAt(0), 0, 0), "32 s left");
  assert.notEqual(timeLeft(saleEndsAt(0), 0, 0), TIME_WORDS.none);
  const src = readFileSync(new URL("./screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(src, /steps: gasJobSteps\(at\), endsAt: gasJobEndsAt\(at\) \}\);/, "the fee job's first frame has its time");
  assert.match(src, /endsAt: tradeEndsAt\(svc, coin\.chain, taskAt\),\n      steps: \[/, "every trade's job too (builder 22: the chain's measured pace)");
});

// QA's Sim test (5 Nov), items 4, 5 and 7 of its MUST list: Move above Private's two sheets agree and Private moves as
// they say; a Take out says one arrival figure before the tap; a site's Take out and AgentZero's funding are jobs made at
// the tap ("Job created.", the time left, where the money comes from). No wall clock: every time is a fixed figure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEG_SEC } from "@zerofee/shell-api/job-steps.ts";
import { splitLines } from "@zerofee/core/private-route";
import { costRows, fillLegs, fillOf, homeCut, type Leg, type SafeCoinRow } from "../screens/move-split.ts";
import { BACK_WORDS, TAKE_OUT_ETA_SEC, takeOutJob } from "./site-back.ts";
import { FUND_JOB_WORDS, fundJob } from "../../../../agent/src/app/fund-words.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const $c = (c: bigint) => `$${(Number(c) / 100).toFixed(2)}`;

test("item 4: Move above Private (crawl K: Private $5 USDC + $8.86 in NEAR, SOL +$30): the Move sheet's legs and the Check sheet's lines are one split, and Private's figure is what it really keeps (control: Private with $20 USDC, it pays $10)", () => {
  const coins: SafeCoinRow[] = [{ tokenId: USDC, amount: "5000", usd: "5000", symbol: "USDC" }, { tokenId: USDC, amount: "5", usd: "5", symbol: "USDC", held: "private" }, { tokenId: "nep141:wrap.near", amount: "4", usd: "8.86", symbol: "NEAR", held: "private" }];
  // the sliders' legs as the crawl had them: Safe → SOL $21.14, Private → SOL $8.86
  const legs: Leg[] = [{ from: "safe", to: "sol", usd: 21.14 }, { from: "private", to: "sol", usd: 8.86 }];
  const f = fillOf(legs, coins)!;
  assert.deepEqual(f, { need: 30, fill: 30 });
  const pays = fillLegs(legs, f);
  assert.deepEqual(pays.legs, [{ from: "safe", to: "sol", usd: 30 }], "the Move sheet: Safe → SOL $30, nothing from Private");
  assert.equal(pays.privateUsd, 0, "Private's row stays $13.86, as it does after landing (its USDC: +$30 fill, -$30 paid)");
  // the Check sheet's block, as the Sim (MockBridge wordsFor) and the core (intents.ts legsBlock) draw it
  const lines = splitLines(3000n, BigInt(Math.round(f.fill * 100)), $c);
  assert.deepEqual(lines, ["From your Safe · $30.00", "Together · $30.00"], "never \"From Private · $5.00 … Stays in Private · $5.00\"");
  const safeLine = Number(lines.find((l) => l.startsWith("From your Safe"))!.split("$")[1]);
  assert.equal(safeLine, pays.legs.find((l) => l.from === "safe")!.usd, "the two sheets say the same Safe figure");
  // control: Private holds $20 USDC, so it pays $10 of its own and the Safe fills $20 (fillStepUsd of $10.30 short)
  const more = coins.map((c) => (c.held === "private" && c.symbol === "USDC" ? { ...c, amount: "20", usd: "20" } : c));
  const g = fillOf(legs, more)!;
  const pays2 = fillLegs(legs, g);
  assert.deepEqual(pays2.legs, [{ from: "safe", to: "sol", usd: 20 }, { from: "private", to: "sol", usd: 10 }]);
  assert.equal(pays2.privateUsd, -10);
  assert.deepEqual(splitLines(3000n, 2000n, $c), ["From Private · $10.00", "From your Safe · $20.00", "Together · $30.00"]);
});

test("item 5: a Take out says one arrival figure before the tap: the Safe's row is the \"Arrives\" row's least, never the gross $20 (control: a Move out of the Safe cuts nothing)", () => {
  const home: Leg[] = [{ from: "sol", to: "safe", usd: 20 }];
  const rows = costRows(home)!.rows;
  const arrives = Number(rows.find((r) => r.label.startsWith("Arrives"))!.value.replace(/[^0-9.]/g, ""));
  // the crawl's sheet: Safe was $5,288.01, said $5,308.01 (+20.00), "at least $18.36"
  const safeShown = Math.round((5288.01 + 20 - homeCut(home)) * 100) / 100;
  assert.equal(Math.round((safeShown - 5288.01) * 100) / 100, arrives, "the row's change is the one arrival figure");
  assert.ok(arrives < 20 && arrives > 18);
  assert.equal(homeCut([{ from: "safe", to: "sol", usd: 20 }]), 0, "control: nothing comes home, nothing cut");
  const sheet = readFileSync(new URL("../screens/MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /x\.place === "safe" && !running \? Math\.round\(\(said\(split\) - homeCut\(legs\)\) \* 100\) \/ 100/);
  // the time said is the route's measured leg (SOL wallet into NEAR, 79-112 s on mainnet), the one the job counts down
  assert.equal(TAKE_OUT_ETA_SEC, LEG_SEC.chainIn);
});

test("item 7: a site's Take out is a job at the tap: its row's title, dollars and measured time; \"Job created.\" before the core answers; a refusal ends the row with its words (control: the old \"Taking it out…\" line is gone)", () => {
  assert.deepEqual(takeOutJob(10, "pump.fun"), { title: BACK_WORDS.title("$10.00", "pump.fun"), usd: "$10.00", etaSec: LEG_SEC.chainIn });
  const src = readFileSync(new URL("./SiteMoney.tsx", import.meta.url), "utf8");
  const go = src.slice(src.indexOf("function SiteBackSheetFor("), src.indexOf("const legNetworks ="));
  const made = go.indexOf("const job = startJob(tasks, takeOutJob(picked, name));"), call = go.indexOf("const r = await one(w);");
  assert.ok(made > 0 && made < call, "the job exists before the first call");
  assert.ok(go.indexOf("setMade(`$${picked.toFixed(2)}`);") < call, "the receipt is drawn in the tap's turn");
  assert.match(go, /job\.failed\(r\.line \|\| BACK_WORDS\.stillThere\(name\)\);/, "a refusal ends the row, the sheet comes back");
  assert.match(go, /job\.made\(went\.map\(\(x\) => `\$\{BACK_ID\}\$\{x\.id\}`\)\);/, "the Take out's own rows take over");
  assert.match(src, /data-testid="takeout-made"[^]*?\{JOB_WORDS\.created\}[^]*?<TimeLeft etaSec=\{TAKE_OUT_ETA_SEC\} watch \/>/);
  assert.doesNotMatch(go, /Taking it out…/);
});

test("item 7: AgentZero's funding is a job made on the Safe's yes, saying where the money comes from and its time (control: no fund flag, no job)", () => {
  const f = fundJob(10, 10);
  assert.deepEqual(f, { job: { title: "Add $10.00 to AgentZero's wallet", usd: "$10.00", etaSec: LEG_SEC.privateNear, approve: true }, said: { amount: "$10.00", from: "From your Safe" } });
  assert.equal(fundJob(25, 15).said.amount, "$15.00", "a raise adds the difference");
  const app = readFileSync(new URL("../../../../agent/src/app/AgentApp.tsx", import.meta.url), "utf8");
  assert.match(app, /const f = fund \? fundJob\(usd, Math\.max\(0, usd - pocketUsd\)\) : null;/);
  assert.match(app, /onOwnApproval\(\(yes\) => \{ if \(yes && !job\) \{ job = startMoneyJob\(shell\.tasks, f\.job\);/);
  assert.match(app, /data-testid="az-fund-made"[^]*?\{JOB_WORDS\.created\}[^]*?data-testid="az-fund-from">\{funded\.from\}/);
  assert.match(app, /setPocket\(choice, runningList\(jobs\), needsAnyAddress\(jobs\), true\)/, "only the fund button makes it");
  assert.equal(FUND_JOB_WORDS.from, "From your Safe");
});

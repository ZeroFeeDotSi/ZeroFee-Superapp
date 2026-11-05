// QA's Sim test (5 Nov), 056 and 062: the pump.fun page shows its address six and six, as every outside address does
// (core format.ts outsideShort), never four and four; and its Take out is a job at the tap ("Job created.", its time
// left) on every way in: each Take out on a site's page opens the one money sheet's site Take out, which makes the job
// before the core is called. No network, no clock: pure figures and the sources.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { outsideShort } from "@zerofee/core/format";
import { shortAddress } from "./site-wallet.ts";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("056: the site page's address is six and six, as outsideShort (control: a short name stays whole)", () => {
  const sol = "CxSAqWx1fT9pLm3kR7vB2nJ8yHd4Gs6Ze5UoNcLsn4";
  assert.equal(shortAddress(sol), "CxSAqW…NcLsn4");
  assert.equal(shortAddress(sol), outsideShort(sol));
  assert.doesNotMatch(shortAddress(sol), /^.{4}….{4}$/, "never four and four");
  // the site's own details page cuts the same way
  assert.match(src("./SiteApp.tsx"), /const short = outsideShort;/);
  assert.doesNotMatch(src("./SiteApp.tsx"), /slice\(0, 4\)/);
  // control
  assert.equal(shortAddress("pump.fun"), "pump.fun");
});

test("062: a site wallet's Take out is a job at the tap: every site page's Take out opens the money sheet's site Take out, which makes the job before it calls the core (control: no site page moves money back itself)", () => {
  for (const f of ["./SiteWalletApp.tsx", "./SiteApp.tsx", "./SocialHub.tsx", "./YourWallets.tsx"]) {
    const s = src(f);
    assert.match(s, /shell\.openMoney\(\{ kind: "siteback"/, `${f}: its Take out opens the one sheet`);
    assert.doesNotMatch(s, /subwallet\.site\.moveBack"/, `${f}: control, never its own move back`);
  }
  const host = src("../../../wallet/src/app/money/MoneyHost.tsx");
  assert.match(host, /if \(ask\.kind === "siteback"\) return [^]*?<SiteBackSheet /);
  const money = src("../../../wallet/src/app/money/SiteMoney.tsx");
  const go = money.slice(money.indexOf("function SiteBackSheetFor("), money.indexOf("const legNetworks ="));
  const job = go.indexOf("const job = startJob(tasks, takeOutJob(picked, name));"), call = go.indexOf("const r = await one(w);");
  assert.ok(job > 0 && call > job, "the job exists before the core's first call");
  assert.match(money, /data-testid="takeout-made"[^]*?\{JOB_WORDS\.created\}[^]*?<TimeLeft etaSec=\{TAKE_OUT_ETA_SEC\} watch \/>/, "\"Job created.\" and its time left");
});

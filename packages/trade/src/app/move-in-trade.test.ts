// 4 Nov: people trading want to move money quickly without leaving Trade: a job is made and that is it. Trade's top row (the wallets' own tabs) has a Move button: Home's own Move sheet over Trade (the shell's money
// host, as Browser's site money is), never a new sheet. It ends the moment the move's jobs are made (`quick`), back to
// Trade, each leg going on in Activity. Read from the source, as the screens' wiring tests do (no DOM here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { MoneyAsk } from "@zerofee/shell-api/money.ts";

const here = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const app = here("./TradeApp.tsx"), discover = here("./screens/Discover.tsx");
const host = here("../../../wallet/src/app/money/MoneyHost.tsx"), sheet = here("../../../wallet/src/app/screens/MoveSheet.tsx");

test("Move opens from Trade: the wallets' row has a Move button (the Copywriter's words), and it opens Home's Move over Trade, quick", () => {
  assert.match(discover, /\{onMove && <button className="dc-move" aria-label="Move money between your Safe and your wallets" onClick=\{onMove\}>Move<\/button>\}/);
  assert.match(discover, /<ChainTabs [^\n]*\{\.\.\.\(onMove \? \{ onMove \} : \{\}\)\}/, "Discover hands it to its top row");
  // the web wallet has no Safe and no Move (Home's own rule): no button there
  assert.match(app, /<Discover [^\n]*\{\.\.\.\(webWallet\(\) \? \{\} : \{ onMove: \(\) => void openMove\(\) \}\)\}/);
  // Home's own sheet, through the shell's money host: never a sheet of Trade's own
  assert.match(app, /shell\.openMoney\(back \? fundAsk\(back\.coin\.chain, back\.value\) : \{ kind: "move", quick: true \}/);
  const ask: MoneyAsk = { kind: "move", quick: true };
  assert.equal(ask.kind, "move");
});

test("Trade's quick Move is Home's own: the tap makes the job and the sheet says \"Job created.\" with Done back to Trade (product decision, 5 Nov); a leg that didn't go is said on the job's row; the Safe's money still leaves only through its Approve", () => {
  assert.match(host, /if \(ask\.kind === "move"\) return <MoveSheet [^\n]*\{\.\.\.\(ask\.quick \? \{ quick: true \} : \{\}\)\}/, "the host hands quick to Home's Move sheet");
  assert.match(sheet, /const ran = await runMove\(legs, planOf\(legs, now\), \{/);
  assert.match(sheet, /\{JOB_WORDS\.created\}/);
  // Done before the legs' ids are back: it went (the app that opened it hears so), never a Close that says nothing moved
  assert.match(sheet, /if \(!running\) return made !== null \? onDone\(""\) : onClose\(\);/);
  const run = readFileSync(new URL("../../../wallet/src/app/screens/move-run.ts", import.meta.url), "utf8");
  assert.equal(run.match(/missed\.push\(/g)?.length, 2, "each leg that didn't go is said on the row");
  assert.ok(run.indexOf('"spending.topUp"') < run.indexOf('"spending.move"'), "the Safe's Approve first");
});

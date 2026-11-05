// Real money, 4 Nov (findings 1-3 territory): Move said "Nothing to move yet" and Send "Nothing to send yet" over a $45
// Safe, because an unread Safe or wallet counted as $0 (move-split.ts placesNow: `o.safeUsd ?? 0`; MoneyHost read the
// Safe only on its own two-node read). Unread is not empty: a money sheet starts on the Safe two nodes agreed this
// session, says "Reading your money…" until every part answered, and says so when the wallets didn't answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { moveUnread } from "../screens/move-split.ts";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const both = [{ network: "sol" }, { network: "hood" }];

test("Move: an unread Safe, an unloaded or unread Spending, or a wallet Spending couldn't read is not empty (control: all read)", () => {
  assert.equal(moveUnread(null, { loaded: true, networks: both }), true, "the Safe not read yet");
  assert.equal(moveUnread("46.00", { loaded: false, networks: both }), true, "Spending not loaded");
  assert.equal(moveUnread("46.00", { loaded: true, unread: true, networks: both }), true, "Spending unread");
  assert.equal(moveUnread("0", { loaded: true, networks: [{ network: "sol" }] }), true, "ETH (RH) not read");
  assert.equal(moveUnread("0", { loaded: true, networks: both }), false, "control: everything answered, truly empty");
});

test("Move says it is reading while unread, before 'Nothing to move yet'", () => {
  const sheet = src("../screens/MoveSheet.tsx");
  assert.ok(sheet.indexOf("moveUnread(safeUsd, status)") > 0 && sheet.indexOf("moveUnread(safeUsd, status)") < sheet.indexOf("{MOVE_WORDS.nothing}"));
});

test("Send: no source while the wallets or the Safe are unread is 'reading'; a wallets read that failed says so", () => {
  const form = src("./SendForm.tsx"), sheet = src("./SendSheet.tsx");
  assert.match(form, /\{reading\s*\? <p/);
  assert.ok(form.indexOf("SEND_EMPTY.reading") < form.indexOf("SEND_EMPTY.none"), "reading is decided before 'Nothing to send yet'");
  assert.match(sheet, /reading=\{rowsRead === "failed" \? "failed" : !rowsRead \|\| \(!balancesRead && home\.balances === null\)\}/);
});

test("a money sheet starts on the Safe two nodes agreed this session (control: never the copy kept on the phone)", () => {
  const rt = src("../runtime.tsx");
  assert.match(rt, /useState<\{ at: number; rows: Balance\[\] \} \| null>\(\(\) => \(forMoney \? seenAgreed\.get\(seedFrom\) \?\? null : null\)\)/);
  assert.match(rt, /agreed: \(v\) => \{ if \(v && typeof v === "object"\) seenAgreed\.set\(seedFrom, v\); setAgreed\(v\); \}/);
  assert.doesNotMatch(rt, /seenAgreed\.set\([^)]*primedNow/, "control: the kept copy never seeds it");
});

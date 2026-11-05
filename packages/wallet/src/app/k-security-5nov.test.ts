// QA's crawl (5 Nov, the bundle, an AgentZero test): Activity and Settings had only Close (to Home) from
// Your account; Activity showed "D6po1b…Z1x4"; Details showed five full addresses to a screen reader and "Export key" ×5.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROOF_LINE, proofLine } from "@zerofee/core/proof-line";
import { createTaskStore } from "@zerofee/shell-api/tasks.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const wallet = read("./WalletApp.tsx");
const details = read("./screens/Details.tsx");
const detail = read("./screens/ActivityDetail.tsx");
const centre = read("../../../shell-api/src/TaskCentre.tsx");
const proofLineSrc = read("../../../shell-api/src/TxProofLine.tsx");
const bell = read("../../../shell-api/src/TaskBell.tsx");
const settings = read("../../../../apps/web/src/shell/SettingsPanel.tsx");
const host = read("../../../../apps/web/src/shell/AppHost.tsx");
const app = read("../../../../apps/web/src/App.tsx");

test("Activity and Settings from Your account go Back to it, as Details does", () => {
  assert.match(wallet, /shell\.tasks\.open\(\{ back: toAccount \}\)/, "Activity: the centre's ‹");
  assert.match(wallet, /setView\(\{ kind: "activity", fromAccount: true \}\)/, "Activity without a centre: its own page's Back");
  assert.match(wallet, /<PushedFrame name="Activity" onBack=\{backFrom\(view\)\}>/);
  assert.match(wallet, /go\(\(\) => shell\.openMenu\(toAccount\)\)/, "Settings");
  assert.doesNotMatch(wallet, /onClick=\{go\(shell\.openMenu\)\}/, "control: the old Close-only way in is gone");
  assert.match(wallet, /const toAccount = \(\) => \{ tabs\(\); setSheet\("account"\); \};/);
  // the centre and Settings draw the ‹ only when given a way back
  assert.match(centre, /<Sheet title=\{CENTRE_WORDS\.title\} onClose=\{onClose\} \{\.\.\.\(onBack \? \{ onBack \} : \{\}\)\}>/);
  assert.match(bell, /if \(active\) show\(ask\.app, ask\.back\);/);
  assert.match(settings, /\{onBack \? <button className="zf-sheet__back" onClick=\{onBack\} aria-label="Back"><Back \/><\/button> : <span aria-hidden="true" \/>\}/);
  assert.match(settings, /useBack\(onBack \?\? onClose\);/);
  assert.match(settings, /const onBack = backTo && \(\(\) => \{ onClose\(\); backTo\(\); \}\);/, "‹ closes Settings, then goes back");
  assert.match(app, /\{\.\.\.\(menuBack\.current \? \{ onBack: menuBack\.current \} : \{\}\)\}/);
  // a button's click event is never taken for a way back
  assert.match(host, /openMenu: \(back\) => onMenu\(typeof back === "function" \? back : undefined\),/);
  assert.match(app, /const openMenu = \(back\?: \(\) => void\) => \{ menuBack\.current = back \?\? null; setMenu\(true\); \};/);
});

test("the task store carries the way back with the ask; the bell's own open has none (control)", () => {
  const store = createTaskStore();
  let went = 0;
  store.forApp("wallet").open({ back: () => went++ });
  const ask = store.openAsk();
  assert.equal(typeof ask.back, "function");
  ask.back!();
  assert.equal(went, 1);
  store.forApp("wallet").open();
  assert.equal(store.openAsk().back, undefined, "control: no back, no ‹");
  store.forApp("wallet").open({ back: "x" as never });
  assert.equal(store.openAsk().back, undefined, "only a function is a way back");
});

test("a proof says its network and View, never its id; Copy proof only where there's no explorer", () => {
  assert.equal(proofLine("near", true), "On NEAR");
  assert.equal(proofLine("hood", false), "On Robinhood Chain · No public page yet.");
  assert.equal(proofLine("intents", true), "", "a swap order: its label and View");
  for (const src of [detail, proofLineSrc]) {
    assert.doesNotMatch(src, /shortTx\(/, "no short id on screen");
    assert.doesNotMatch(src, /aria-label=\{`(Copy|\$\{W\.copy\}) \$\{tx\.hash\}`\}/, "no id read out either");
    assert.match(src, /aria-label=\{PROOF_LINE\.copy\}/);
  }
  assert.equal(PROOF_LINE.copy, "Copy proof");
});

test("Details: short addresses, Copy names the wallet, one card for every wallet's key", () => {
  assert.match(details, /aria-label=\{`Copy \$\{label\}'s address`\}/);
  assert.doesNotMatch(details, /aria-label=\{`\$\{label\}: \$\{text\}\. Copy`\}/, "control: the full address in the label is gone");
  assert.equal((details.match(/"spending\.exportKey"/g) ?? []).length, 1, "one export path");
  assert.doesNotMatch(details, />Export key</, "no Export key on each card");
  assert.match(details, /<KeysCard wallets=\{shown\.filter\(\(w\) => w\.role !== "hub"\)\}/, "the NEAR wallet's cash has no key to show");
  assert.match(details, /disabled=\{!showKeyConfirmed\(typed\)\} onClick=\{\(\) => void exportKey\(\)\}>Show its key</, "the typed phrase still gates it");
  assert.match(details, /head: "A wallet's key", note: "Use it to open a wallet in another app\.", show: "Show a key", pick: "Which wallet\?"/);
});

test("the copy review's desktop audit (5 Nov): Details' Safe card is headed \"Your account\"; its id is a quiet short line, Copy copies all of it (control: never the raw id as a title)", async () => {
  const { shortKey } = await import("@zerofee/core/format");
  assert.equal(shortKey("zf-sample677952.testnet"), "zf-sam…tnet", "the core's short form");
  assert.equal(shortKey("abc.near"), "abc.near", "control: a short id stays whole");
  assert.match(details, /<div className="wl-dt-row1"><span className="t">Your account<\/span><span className="zf-small">NEAR<\/span><\/div>\n\s*\{account \? <AccountLine id=\{account\} \/> :/);
  assert.match(details, /onClick=\{\(\) => \{ void copy\(id\); [^}]*\}\}>\n\s*<span className="zf-small" translate="no">\{shortKey\(id\)\}<\/span>/, "quiet, short on screen, whole on copy");
  assert.match(details, /aria-label="Copy your account address"/, "the screen reader never reads the id");
  assert.doesNotMatch(details, /<Address text=\{account\}/, "control: the raw id is not the card's big line");
});

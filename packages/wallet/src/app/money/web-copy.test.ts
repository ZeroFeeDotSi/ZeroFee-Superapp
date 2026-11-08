// The Copywriter's batch 2, part A (4 Nov), QA's review of web wallet A+B, and the product order (sites
// are the phone app's): the web wallet's words, Send's honest lines and its password step-up. Each rule with its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WEB_WORDS } from "@zerofee/shell-api/web-wallet-words.ts";
import { WEB_SEND_FROM, WEB_SEND_WORDS as W, webSendLine, webTypedWhy } from "./web-send.ts";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

test("Settings' web words: backup words, Show (never Export or recovery phrase), Your keys, no plain \"safe\"", () => {
  assert.equal(WEB_WORDS.section, "Your keys");
  assert.equal(WEB_WORDS.showWords, "Show your backup words");
  assert.equal(WEB_WORDS.exportKey("SOL"), "Show your SOL private key");
  assert.equal(WEB_WORDS.wordsLead, "Anyone with these 24 words can take your money. Never share them. Write them on paper. Keep it where only you can find it.");
  for (const v of Object.values(WEB_WORDS)) {
    const s = typeof v === "function" ? (v as (n: string) => string)("X") : v;
    assert.doesNotMatch(s, /recovery phrase|Export|keep them safe/, s);
  }
});

test("Send's words: what to do next, no \"network\", an amount line that names what's wrong; Trade's Add row", () => {
  assert.equal(W.failed, "This didn't send. Nothing left your wallet. Try again.");
  assert.equal(W.badAmount, "Type a number above 0, like 0.5.");
  assert.equal(W.lands("ETH", "Robinhood Chain"), "They get ETH on Robinhood Chain. They won't see your wallet. Someone watching Robinhood Chain could still match the amount and time to you.", "honest: what is hidden (the wallet) and what is not (amount and time)");
  assert.equal((W as Record<string, unknown>).public, undefined, "control: the public line is gone");
  const trade = src("../../../../trade/src/app/TradeApp.tsx");
  assert.match(trade, /<span className="t">Add money<\/span><span className="d">From any wallet or exchange<\/span>/);
  assert.doesNotMatch(trade, /own address/);
});

test("bug (a): a send whose answer never came never says nothing left; it names the chain and says to check first", () => {
  assert.deepEqual(webSendLine({ thrown: true }, "1", "SOL", "Solana"), { went: false, line: "Solana hasn't answered yet. Check your wallet before you try again." });
  assert.deepEqual(webSendLine({ thrown: true }, "1", "ETH", "Robinhood Chain"), { went: false, line: "Robinhood Chain hasn't answered yet. Check your wallet before you try again." });
  // the core built and maybe sent it, then a problem with no words: not known to be unsent either
  assert.equal(webSendLine({ ok: { status: "problem", problem: {} as never } }, "1", "SOL", "Solana").line, W.unknown("Solana"));
  // control: a refusal before anything was signed (the bridge's problem) is the only "Nothing left your wallet"
  assert.deepEqual(webSendLine({ problem: {} }, "1", "SOL", "Solana"), { went: false, line: W.failed });
  const sheet = src("./WebSendSheet.tsx") + src("./web-send.ts");
  assert.doesNotMatch(sheet, /catch\(\(\) => \(\{ problem: \{ whatHappened: WEB_SEND_WORDS\.failed/, "a throw is never \"Nothing left\"");
  assert.match(src("./web-send.ts"), /o\.call\("subwallet\.sendPrivate", \{ \.\.\.o\.ask, toTokenId: o\.from\.lands \}\)\.catch\(\(\) => \(\{ thrown: true as const \}\)\)/);
});

test("decision A on the private Send: the password is the core's sheet's, never this sheet's (control: a refusal with a code keeps the core's words)", () => {
  const sheet = src("./WebSendSheet.tsx");
  assert.doesNotMatch(sheet, /setPassword|type="password"/);
  assert.doesNotMatch(src("./web-send.ts"), /password-needed|o\.password/);
  assert.equal(webSendLine({ problem: { code: "security.balance.low-coin", whatHappened: "Too little." } }, "1", "SOL", "Solana").line, "Too little.");
});

test("the amount line shows only for a finished amount that is wrong: never while \"0.\" is still being typed", () => {
  const bad = { why: W.badAmount };
  assert.equal(webTypedWhy("addr", "0.", bad), null);
  assert.equal(webTypedWhy("addr", "", bad), null);
  assert.equal(webTypedWhy("", "0", bad), null);
  assert.equal(webTypedWhy("addr", "0", bad), W.badAmount, "control: a finished 0 is named");
  assert.equal(webTypedWhy("addr", "0.5", { ok: {} as never }), null);
});

test("a site's top-up on the web is the one On your phone page; no site wallet is read or filled", () => {
  const host = src("./MoneyHost.tsx");
  assert.match(host, /if \(ask\.kind === "siteadd"\) return <OnYourPhone reason="site" name=\{ask\.name\} /);
  const sheet = src("./WebSendSheet.tsx");
  assert.doesNotMatch(sheet, /WebSiteAddSheet|WebPhoneOnly|spending\.wallets/);
});

// the copy review's edits to the web Send's refusal (5 Nov): (a) the wallet named is the row the money would have left, never a fixed
// name; (b) no "Tap Send to try again." where the lit Send button sits right under the line, only where it is off-screen.
const PRIVATE_REFUSED = (where: string) => ({ problem: { code: "security.send.private-refused", whatHappened: "NEAR Intents said no. Nothing moved.", money: { where } } });

test("the copy review (a): the refusal names the row the money was in (SOL wallet, Robinhood wallet, Safe), never a fixed name (control: the core's own fallback \"in your wallet\" is never what is said)", () => {
  assert.equal(webSendLine(PRIVATE_REFUSED("in your wallet"), "1", "SOL", "Solana", "SOL wallet").line, "NEAR Intents said no. Nothing moved. Your money is in your SOL wallet.");
  assert.equal(webSendLine(PRIVATE_REFUSED("in your wallet"), "1", "ETH", "Robinhood Chain", "Robinhood wallet").line, "NEAR Intents said no. Nothing moved. Your money is in your Robinhood wallet.");
  assert.equal(W.refused("NEAR Intents said no. Nothing moved.", "Safe"), "NEAR Intents said no. Nothing moved. Your money is in your Safe.");
  // each of the sheet's From rows carries its own row name, and webSendGo hands it on
  assert.deepEqual(WEB_SEND_FROM.map((f) => f.row), ["SOL wallet", "Robinhood wallet"]);
  assert.match(src("./web-send.ts"), /webSendLine\("ok" in r \? \{ ok: r\.ok\.sent \} : r, o\.ask\.amount, o\.from\.symbol, o\.from\.network, o\.from\.row\)/);
  assert.doesNotMatch(src("./web-send.ts"), /refused: \(what: string, where: string\)/, "the old shape took the core's fixed words");
});

test("the copy review (b): under the lit Send button the refusal has no \"Tap Send\"; off-screen it keeps it (control: the sheet's line sits right above Send)", () => {
  const sheetLine = webSendLine(PRIVATE_REFUSED("in your SOL wallet"), "1", "SOL", "Solana", "SOL wallet").line!;
  assert.doesNotMatch(sheetLine, /Tap Send/);
  assert.equal(W.refused("NEAR Intents said no. Nothing moved.", "SOL wallet", "off-screen"), "NEAR Intents said no. Nothing moved. Your money is in your SOL wallet. Tap Send to try again.");
  // the sheet: the line, then the lands line, then the lit Send, all on one screen
  const sheet = src("./WebSendSheet.tsx");
  const at = (s: string) => sheet.indexOf(s);
  assert.ok(at('data-testid="web-send-line"') > 0 && at('data-testid="web-send-line"') < at('data-testid="web-send-go"'), "Send sits under the line");
});

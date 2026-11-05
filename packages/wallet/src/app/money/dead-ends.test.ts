// The independent grade (3 Nov, the real app on testnet): Add failed on every row ("Add can't make an address on this
// phone yet. Try again." with no Try again), Send and Swap said "nothing" under a $28.10 Safe, and Move said "Nothing
// can move here yet." four times, then "Drag a slider". Money can't move on a test network (the swap service runs on
// mainnet only): each sheet now says so once (R2, 4 Nov: no sample-money button; Home hides the actions instead). On a real account, Send under a Safe that holds
// money says where it is and opens Move (sending straight from the Safe isn't open yet: SAFE_SEND_OPEN).
// Checked in headless Chrome on a fresh testnet account: each of the four sheets is the one line and Try sample money,
// which opens ?demo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("a test account is one whose Safe holds test NEAR, or the ledger says so (control: a real account's coins are not)", async () => {
  const { testAccount, TEST_SHEETS, TEST_WORDS } = await import("./dead-ends.ts");
  assert.equal(testAccount([{ test: true }], null), true);
  assert.equal(testAccount([], { code: "ledger.account.testnet" }), true);
  assert.equal(testAccount([{}], null), false, "control: real coins");
  assert.equal(testAccount(null, { code: "security.partner.unreachable" }), false, "control: another problem");
  for (const k of ["receive", "send", "swap", "move", "request"] as const) assert.ok(TEST_SHEETS[k], k);
  assert.equal(TEST_SHEETS.siteadd, "Put money in", "R2: a site wallet's Put money in");
  assert.equal(TEST_SHEETS.siteback, "Move to your Safe", "R2: and its Move to your Safe");
  assert.equal(TEST_SHEETS.cap, undefined, "control: a sheet that moves no money stays as it is");
  assert.equal(TEST_WORDS.line, "This is a test account, so money can't move here.");
  assert.equal("go" in TEST_WORDS, false, "R2: no sample-money button (drop, don't degrade)");
});

test("MoneyHost: a test account's money sheets are the one line, before any engine read; a link's Add keeps its own (control: a real account routes as before)", () => {
  const host = src("./MoneyHost.tsx");
  const gate = host.indexOf("if (testAccount(balances, balanceProblem) && TEST_SHEETS[ask.kind] && !(\"link\" in ask && ask.link)) return <TestOnly");
  assert.ok(gate > 0, "the gate");
  assert.ok(gate < host.indexOf('if (ask.kind === "send") return <SendLater'), "before Send, Add, Swap and Move");
  assert.doesNotMatch(host, /location\.assign\("\/\?demo"\)/, "R2: no weaker substitute");
  assert.match(src("../WalletApp.tsx"), /\{testNote && \(\s*<button className="wl-note" hidden=\{noteGone\}/, "the note stays in the page (hidden once dismissed), so Home's CSS knows a test account");
  assert.match(readFileSync(new URL("../wallet.css", import.meta.url), "utf8"), /\.wl-app:has\(\.wl-note\) :is\(\.wl-acts, \.wl-add-btn\) \{ display: none; \}/, "a test account's Home has no actions that can't work");
  assert.doesNotMatch(host, /Try again<\/button>\}?<\/Sheet>;\s*\}\s*function TestOnly/, "no Try again that can't work");
});

test("Send under a Safe that holds money says where it is and opens Move, once (control: with nothing anywhere, Add money as before)", async () => {
  const { SEND_EMPTY } = await import("./dead-ends.ts");
  assert.equal(SEND_EMPTY.inSafe, "Your money is in your Safe. Move some to a wallet to send it.");
  assert.equal(SEND_EMPTY.move, "Move money");
  const form = src("./SendForm.tsx");
  assert.match(form, /: onMove\s*\? <div className="wl-empty-wallet"><p className="wl-empty-wallet__line">\{SEND_EMPTY\.inSafe\}<\/p><button className="zf-btn zf-btn--quiet wl-add-btn" onClick=\{onMove\}/);
  assert.match(form, /: <><p className="zf-body">\{SEND_EMPTY\.none\}<\/p><button className="zf-btn" onClick=\{onAddMoney\}>Add money<\/button><\/>\}/, "control");
  assert.match(src("./MoneyHost.tsx"), /\{\.\.\.\(Number\(safeUsd\) >= 2 \? \{ onMove: \(\) => setAsk\(\{ kind: "move" \}\) \} : \{\}\)\}/, "only when the Safe holds a move's worth");
});

test("R2: on a test account a site wallet's Put money in is the one test line, before its sheet loads (control: a real account opens Put money in as before)", () => {
  const host = src("./MoneyHost.tsx");
  const gate = host.indexOf("if (testAccount(balances, balanceProblem) && TEST_SHEETS[ask.kind]");
  const site = host.indexOf('if (ask.kind === "siteadd") return <Suspense');
  assert.ok(gate > 0 && site > gate, "the gate comes before the site sheet");
  assert.ok(host.indexOf('if (ask.kind === "siteback") return <Suspense') > gate, "and before Move to your Safe");
});

test("R2: the gate's two halves for a site Add: a test account's coins trip it, a real account's don't", async () => {
  const { testAccount, TEST_SHEETS } = await import("./dead-ends.ts");
  assert.ok(testAccount([{ test: true }], null) && TEST_SHEETS.siteadd, "test account: the test line");
  assert.equal(testAccount([{}], null), false, "control: a real account goes on to SiteAddSheet");
});

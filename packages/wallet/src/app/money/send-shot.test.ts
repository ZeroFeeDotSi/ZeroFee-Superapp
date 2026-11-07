// A Send test (4 Nov): $16 from the SOL wallet to 83e7fbd5…74c6, an implicit NEAR account no NEAR has
// reached yet (mainnet, two nodes: UNKNOWN_ACCOUNT). The refusal sat at the top and read "There's no 83e7fb…74c6 on
// NEAR" ("our app thinks this isn't the right wallet"); the whole 64-hex was printed raw; "New address" looked like a
// button. Each with a control.
import { outsideShort } from "@zerofee/core/format";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FIRST_PAYMENT, shortId } from "./send-words.ts";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("Send's line sits right above Hold, where every money sheet says it; never at the top while the form is up (control: the sent screen still says it)", () => {
  const form = src("./SendForm.tsx"), sheet = src("./SendSheet.tsx");
  assert.match(form, /\{floor\.line === "said" \? <SheetLine text=\{said\} \/> : floor\.line === "why" && <p className="zf-small wl-send2__why"[^\n]*\n\s*\{\}\n\s*<div className="zf-fee">\n[^\n]*\n[^\n]*\n\s*<\/div>\n\s*(?:\{source\.cant && source\.swap && onSwap\n\s*\? <button [^\n]*\n\s*: source\.cant && source\.back && onBack\n\s*\? <button [^\n]*\n\s*: )?<button type="button" className="zf-btn wl-hold" disabled=\{!ready\} onClick=\{go\} data-testid="send-go">/, "the line, the fee block, then Hold (or, for a coin that can't go, its Swap or Move back in Hold's place)");
  assert.match(sheet, /said=\{line \?\? services\.line\}/);
  assert.doesNotMatch(sheet, /^\s*<SheetLine text=\{line \?\? services\.line\} \/>$/m, "no line at the top over the form");
  assert.match(sheet, /\{flying && <SheetLine text=\{line \?\? services\.line\} \/>\}/, "control: with no form, the line still shows");
  // every other money sheet already says its line right above its button
  for (const f of ["../screens/MoveSheet.tsx", "../screens/Spending.tsx", "./SiteMoney.tsx"]) {
    const s = src(f);
    for (const m of s.matchAll(/<SheetLine [^\n]*\/>\n(\s*)(\S[^\n]*)/g)) assert.match(m[2]!, /^(<button|\{)/, `${f}: ${m[2]}`);
  }
});

test("under To, a long id shows short with the whole one tap away; the first payment is a plain label (control: a short name shows whole)", () => {
  assert.equal(shortId("83e7fbd5142b7566020e937a988b3e86a76ddd776a9c9b4b6622543616ad74c6"), "83e7fb…ad74c6");
  assert.equal(shortId("83e7 fbd5 142b 7566 020e 937a 988b 3e86 a76d dd77 6a9c 9b4b 6622 5436 16ad 74c6"), "83e7fb…ad74c6", "groups of four");
  assert.equal(shortId("alex.near"), "alex.near", "control");
  // the copy review's ruling (5 Nov): 6+6 everywhere, the core sheet's own form (format.ts outsideShort: six past "0x")
  const evm = "0x5290aBcDeF0123456789aBcDeF012345679EE7";
  assert.equal(shortId(evm), "0x5290aB…679EE7");
  assert.equal(shortId(evm), outsideShort(evm), "the same formatter as the core's sheet");
  assert.equal(FIRST_PAYMENT, "First payment");
  const form = src("./SendForm.tsx");
  // a16 (Sim re-walk): the To field itself shows the address short once read; a tap into it shows the whole; one payee line
  assert.match(form, /const shortTo = who && !editing && target\.length > 24 && text\.trim\(\) === target \? shortId\(target\) : null;/);
  // the audit's conditions: the field's VALUE is always the whole address; the short form is a span over it, shown while the
  // field is not focused; the look-alike check and the no-typo-check line run on the whole address (target comes from who)
  assert.match(form, /<input ref=\{toField\} value=\{text\} onChange=\{\(e\) => setText\(e\.target\.value\)\} onFocus=\{\(\) => setEditing\(true\)\} onBlur=\{\(\) => setEditing\(false\)\}/);
  assert.doesNotMatch(form, /value=\{shortTo/, "control: the input never holds the short form");
  assert.match(form, /\{shortTo && <span className="wl-send2__short" aria-hidden="true" title=\{text\.trim\(\)\} onClick=\{\(\) => toField\.current\?\.focus\(\)\} data-testid="send-to-short">\{shortTo\}<\/span>\}/);
  assert.match(form, /const target = who \? \(who\.recipient\.kind === "address" \? who\.recipient\.address : who\.recipient\.accountId\) : "";\n\s*const lookalike = who \? lookalikeOf\(target, history\) : null;/, "the look-alike check reads the whole address");
  assert.match(form, /: lookalike \? LOOKALIKE_LINE/, "its line still reaches the screen (the why line over the button)");
  const card2 = form.slice(form.indexOf('<div className="wl-send2__card">'), form.indexOf('className="wl-send2__nets"'));
  assert.match(card2, /noTypoCheck\(who\.recipient\.address, network\) && <span className="zf-small" data-testid="send-no-check">\{NO_TYPO_CHECK\}<\/span>/, "the no-typo-check line renders in the card, on the whole address");
  assert.doesNotMatch(form, /shortId\((?!target\))/, "control: shortId is used for the display span only");
  assert.doesNotMatch(form, /data-testid="send-full"|wl-send2__full/, "control: no second line with the address");
  assert.match(card2, /\{network && routeLines\(network, nearLandsAs\(source\)\.coin, who\.recipient\.kind === "ledger"\)\.map\(\(l, i\) => \(i === 0 && agentLine \? <span key="agent" className="wl-send2__route" data-testid="send-agent-filled">\{toSlotLine\(agentLine, l\)\}<\/span> : <span key=\{l\} className="wl-send2__route" data-testid=\{i \? "send-lands" : "send-route"\}>/, "the network lines (the build's routeLines) sit in the card under the payee");
  assert.doesNotMatch(form.slice(form.indexOf("<Keypad ")), /wl-send2__route/, "control: no network line under the keypad");
  assert.match(form, /\{isNew && <span className="zf-small" data-testid="send-first">\{FIRST_PAYMENT\}<\/span>\}/);
  assert.doesNotMatch(form, /wl-send2__new|New address<\/span>/, "control: the pill is gone");
});

test("R3 (the design review §4.5): Send fits one phone screen: no balances line over it, From and To are one card with the address as read inside it, Hold has no ring (its fill sweeps), and the line above Hold rides the floor (controls: the pots line, the separate cards, the ring)", () => {
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./send.css", import.meta.url), "utf8");
  assert.match(sheet, /<MoneySheet title="Send" away=\{asking && \(busy \|\| !!flying\)\} onClose=\{flying \? madeDone : close\}>/, "no pots over the form");
  assert.doesNotMatch(sheet, /<MoneySheet title="Send" pots=\{pots\} away=/, "control: the old balances line");
  const card = form.slice(form.indexOf('<div className="wl-send2__card">'), form.indexOf('className="wl-send2__nets"'));
  for (const part of ['className="wl-send2__from"', 'className="py-field wl-send2__to"', 'data-testid="send-where"']) assert.ok(card.includes(part), part);
  assert.match(form, /placeholder="Name or address"/);
  assert.match(css, /\.wl-send2 \.wl-hold__ring \{ display: none; \}/);
  assert.match(css, /\.wl-send2__floor > \.wl-hold\.is-holding:not\(:disabled\) \{ background-position: 0 0, 0 0; transition: background-position 600ms linear; \}/, "the sweep is a layer over the pill's own lit fill (look 4)");
  // a16: the floor is its own box under the scrolling part (the keypad can never run under the button), with a fade above it
  assert.match(css, /\.wl-send2__scroll \{ flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;[^}]*overflow-y: auto;/);
  assert.match(css, /\.wl-send2 \.zf-keypad \{ flex: 0 1 224px; min-height: 136px; grid-auto-rows: minmax\(0, 1fr\); \}/, "the keypad's rows compress first");
  assert.match(css, /\.wl-send2__floor::before \{ content: ""; position: absolute;[^}]*bottom: 100%; height: 20px; background: linear-gradient\(to top, var\(--bg\), color-mix\(in srgb, var\(--bg\) 0%, transparent\)\);/);
  assert.doesNotMatch(css, /\.wl-send2 > \.wl-hold \{ overflow: hidden; \}/, "control: no clip, so the fade shows");
  assert.match(form, /<b>\{source\.place\}<\/b>/, "From reads \"From your SOL wallet\", never cut");
  assert.match(css, /\.wl-send2__floor > :is\(\.wl-send2__why, \.zf-money__line\) \{ margin: 0; padding: 0 16px; background: none; box-shadow: none; border-radius: 0; text-align: center; \}/, "the line sits right above its button");
  assert.match(css, /\.wl-send2__floor \{ position: relative; flex: none; display: flex; flex-direction: column; gap: 8px; padding-top: 4px; background: var\(--bg\); \}/, "the floor's ground is solid");
  assert.doesNotMatch(css, /position: sticky/, "control: nothing in Send is sticky any more");
});

test("product decision, 5 Nov: the To field's focus is the theme hairline on the field's own radius, never white, never square (pin; controls: the ring is on the field, none on its input)", () => {
  const css = readFileSync(new URL("./send.css", import.meta.url), "utf8");
  assert.match(css, /\.wl-send2__card \.py-field\.wl-send2__to:focus-within \{ border-radius: var\(--r-field, 16px\); box-shadow: inset 0 0 0 1px var\(--line\); \}/);
  assert.match(css, /\.wl-send2__card \.py-field\.wl-send2__to \{ border-radius: var\(--r-field, 16px\); \}/);
  assert.match(css, /\.wl-send2 \.py-field\.wl-send2__to input:focus-visible \{ box-shadow: none; \}/, "the bare input draws no square ring");
  assert.doesNotMatch(css, /wl-send2__to[^{]*:focus[^{]*\{[^}]*(#fff|white)/i, "control: never white");
});

test("Send's part-line is one quiet line with ellipsis; Home's moving row and its pulsing dot are styled (CSS pins)", () => {
  const send = readFileSync(new URL("./send.css", import.meta.url), "utf8");
  const wall = readFileSync(new URL("../wallet.css", import.meta.url), "utf8");
  assert.match(send, /\.wl-send2__part \{ margin: 6px 0 0; padding: 0 0 0 16px; font: 400 13px\/18px var\(--font\); color: var\(--mute\); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/);
  // a16: the row's markup (Home.tsx hot-moving) is the name <p class="wl-hw__moving"> (a dot BEFORE it, one line, cut
  // with "…"), the figure <b class="wl-hw__usd"> in its own right column (never cut), and TimeLeft's line as the sub-line
  assert.match(wall, /\.wl-hw--moving \{ grid-template-columns: minmax\(0, 1fr\) auto; grid-template-rows: auto auto;[^}]*padding: 0; \}\n\.wl-hw\.wl-hw--moving > \* \{ grid-column: auto; margin: 0; \}/);
  assert.match(wall, /\.wl-hw__moving \{[^}]*font: 500 17px\/24px var\(--font\); color: var\(--ink\); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/, "the title is the one line that is cut");
  assert.doesNotMatch(wall, /\.wl-hw__moving \{[^}]*width: 6px/, "the words are never sized as the dot");
  assert.match(wall, /\.wl-hw--moving > \.wl-hw__usd \{ grid-column: 2; grid-row: 1 \/ 3;[^}]*white-space: nowrap;[^}]*\}/, "the figure is its own column, never cut");
  assert.match(wall, /\.wl-hw--moving > \.zf-receipt__line \{ grid-column: 1; grid-row: 2;[^}]*font: 500 13px\/18px var\(--font-money, var\(--font\)\);[^}]*color: var\(--mute\); text-align: left;[^}]*\}/, "the time is the sub-line");
  assert.match(wall, /\.wl-hw__moving::before \{[^}]*width: 6px; height: 6px;[^}]*background: var\(--up\); \}/);
  const home = readFileSync(new URL("../screens/Home.tsx", import.meta.url), "utf8");
  assert.match(home, /<p className="wl-hw__moving">\{movingWords\?\.title\(m\.engine \? "your wallets" : m\.to\)\}<\/p>\n\s*<b className="wl-hw__usd">\{\$\(m\.usd\)\}<\/b>/, "the destination is the title, the figure its own column");
  assert.doesNotMatch(wall, /wl-hw-moving/, "the dot is still (train 10: no loops)");
});

test("Home's site row is a button with a quiet chevron that turns when open; its nested wallets sit under the name (CSS pins)", () => {
  const wall = readFileSync(new URL("../wallet.css", import.meta.url), "utf8");
  // the chevron is the markup's own <span class="wl-site__chev">›</span> (Home.tsx CoinRow), a fourth grid column; the
  // old ::after chevron would have drawn a second one next to it
  assert.doesNotMatch(wall, /\.wl-site::after/, "one chevron, the markup's");
  assert.match(wall, /\.wl-home \.wl-coin\.wl-site \{ grid-template-columns: var\(--logo\) 1fr auto auto; \}/);
  assert.match(wall, /\.wl-site__chev \{[^}]*color: var\(--mute\);[^}]*transition: transform var\(--dur-base\) var\(--ease-out\)/);
  assert.match(wall, /\.wl-site\[aria-expanded="true"\] \.wl-site__chev \{ transform: rotate\(90deg\); \}/);
  assert.match(wall, /\.wl-site__wallet \{[^}]*padding-left: 44px; border-top: 1px solid var\(--line\);/);
  assert.match(wall, /\.wl-site\[aria-expanded="true"\] \+ div\[data-wallet\] \{ background: none;/);
  assert.match(wall, /prefers-reduced-motion: reduce\) \{ \.wl-site__chev \{ transition: none; \} \}/);
});

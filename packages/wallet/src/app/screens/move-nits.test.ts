// e2e walk (3 Nov, 60 / 65): Move's header named Safe and Trading but not Hidden; "Moving $10.00 from your Safe" had no
// full stop; a take-out started at All ($151.00 of $151.07). Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { firstPick } from "./take-out-pick.ts";

test("a take-out starts at $10, or the row's whole dollars when it holds less (control: never the whole $151)", () => {
  assert.equal(firstPick(151.07), 10);
  assert.equal(firstPick(7.9), 7);
  assert.notEqual(firstPick(151.07), Math.floor(151.07));
});

test("Move's sliders (the Home plan §1.5): its head is where your money sits, never Hidden, a row or Trading (the Agent app's words); its lines end with a full stop (control: the old two-bar sheet is gone)", async () => {
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const { MOVE_WORDS } = await import("./move-split.ts");
  for (const [k, w] of Object.entries(MOVE_WORDS)) {
    const t = typeof w === "function" ? (w as (a: string, b: string) => string)("SOL", "$2") : w;
    assert.doesNotMatch(t, /Hidden|\brow\b|Trading|ETH on Robinhood|please|!/i, t);
    // labels (a heading, a button, the grouped summary's row names) are not sentences
    if (!["title", "head", "go", "moving", "done", "leavesFrom", "leaves", "arrivesIn", "arrives", "atLeast", "fees", "atMost", "time", "leave", "was", "who", "typed"].includes(k)) assert.match(t, /[.…]$/, `a sentence ends with a full stop: ${t}`);
  }
  assert.doesNotMatch(sheet, /homePots|MOVE_WORDS\.empty|Your Safe is empty/, "control: no pots line with Hidden and Trading, no empty-Safe stop");
  assert.match(sheet, /MOVE_WORDS\.nothing/, "only when nothing anywhere can move: Add money");
});

test("D137 + the grade of 3 Nov: a place whose figure changes shows two, today's (dim) and after the move (bright); one that doesn't change shows its figure once (control: before, \"$5,288.01 $5,288.01\" on every row)", async () => {
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  // R3 (spec §4.4): today's figure is said once, as "was $5,288.01" under the place's name, the new figure on the right
  assert.match(sheet, /\{Math\.abs\(shown - was\) >= 0\.005 && <span className="wl-mv-now"[^>]*>\{MOVE_WORDS\.was\(usdShort\(was\)\)\}<\/span>\}/);
  // finding 17: before the tap it is a field showing the same figure (move-typed.test.ts); while the legs run, text
  assert.match(sheet, /<span className="wl-mv-name">[\s\S]*?<\/span>\s*\{running \|\| x\.place === "safe" \|\| x\.place === "private"\s*\? <span className="wl-mv-usd"[^>]*>\{usdShort\(shown\)\}<\/span>/, "the new figure after the name block, once");
  assert.equal((await import("./move-split.ts")).MOVE_WORDS.was("$5,288.01"), "was $5,288.01");
  assert.doesNotMatch(sheet, /\{(running|legs\.length|moved)[^}]*&&\s*<span className="wl-mv-now"/, "never hidden for a place that moves, while dragging or running");
  assert.equal((sheet.match(/<span className="wl-mv-usd"/g) ?? []).length, 1, "the figure after the move, always");
});

test("D140 (the grade of 3 Nov: the total fell by the $310 on its way): from the tap on, Move holds the places as they were, so its total and each row's before stay; nothing moved, it reads live again (control: before, the live read under the moving legs)", () => {
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.match(sheet, /const now = frozen \?\? live;/);
  assert.match(sheet, /setBusy\(true\); setLine\(null\);\s*setFrozen\(now\);/);
  // nothing moved (refused before the job, or a no on the Safe's Approve): it reads live again; a job made keeps them
  assert.match(sheet, /const back = \(\) => \{ setMade\(null\); setBusy\(false\); setFrozen\(null\); \};/);
  assert.match(sheet, /refused: \(pr\) => \{ back\(\); const said = refusedLine\(pr\); if \(said !== null\) \{ setLine\(said\); setStep\(refusedStep\(pr\)\); \} else void problem\(pr, \(\) => undefined\); \},\s*declined: back,/);
  assert.match(sheet, /const total = totalOf\(now\);/, "the total from the held places");
});

test("D137 follow-up: Move says before the tap what each wallet keeps for its fees (control: not while it runs)", () => {
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const kept = keptLines\(now, legs\);/);
  assert.match(sheet, /const foot = running \? null : footNote\(\{[^}]*\bkept\b/);
});

test("the copy review's Move walk (5 Nov): one note under the rows at a time, the most important first: no way back, then the fill, then hints (rounding, kept, time); controls: each lower one shows only when those above are absent, none when all are", async () => {
  const { footNote } = await import("./move-split.ts");
  const all = { back: ["Back"], fill: "Fill", rest: "Rest", kept: ["Kept 1", "Kept 2"], time: "About 4 min." };
  assert.deepEqual(footNote(all), { kind: "move-back", text: "Back" });
  assert.deepEqual(footNote({ ...all, back: [] }), { kind: "move-fill", text: "Fill" });
  assert.deepEqual(footNote({ ...all, back: [], fill: null }), { kind: "move-rest", text: "Rest" });
  assert.deepEqual(footNote({ ...all, back: [], fill: null, rest: null }), { kind: "move-kept", text: "Kept 1" });
  assert.deepEqual(footNote({ back: [], fill: null, rest: null, kept: [], time: "About 4 min." }), { kind: "move-time", text: "About 4 min." });
  assert.equal(footNote({ back: [], fill: null, rest: null, kept: [], time: null }), null);
  // the sheet draws exactly one note paragraph from it (control: the old five stacked paragraphs are gone)
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.equal((sheet.match(/\{foot && <p className="zf-small wl-mv-foot" data-testid=\{foot\.kind\}>\{foot\.text\}<\/p>\}/g) ?? []).length, 1);
  assert.doesNotMatch(sheet, /kept\.map\(|back\.map\(|data-testid="move-fill"|data-testid="move-time"/);
});

test("the copy review's Move walk (5 Nov): Private's screen has a Move that opens Move with Private as its source (its row in focus); controls: not before Private holds money, and Home's own Move keeps its tab's focus", () => {
  const priv = readFileSync(new URL("./Private.tsx", import.meta.url), "utf8");
  assert.match(priv, /\{ready && rows\.length > 0 && onMove && <button className="zf-btn" data-testid="private-move" onClick=\{onMove\}>Move<\/button>\}/);
  const app = readFileSync(new URL("../WalletApp.tsx", import.meta.url), "utf8");
  assert.match(app, /<PrivateScreen [^\n]*?onMove=\{\(\) => shell\.openMoney\(\{ kind: "move", source: "private" \}, moved\)\}/);
  const host = readFileSync(new URL("../money/MoneyHost.tsx", import.meta.url), "utf8");
  assert.match(host, /ask\.source === "private" \? \{ wallet: "private" as const \} : ask\.wallet \? \{ wallet: ask\.wallet \} : \{\}/);
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /wallet === x\.place \? " is-focus" : ""/, "the source's row is the one in focus");
});

test("review L4: a slider that's off says why under it (control: before, it was off with no word)", () => {
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.match(sheet, /disabled=\{running \|\| busy \|\| r\.still\}/, "the slider is off when nothing can move");
  // R3 (spec §4.4): a place nothing can move has no slider, and its line sits under its name
  assert.match(sheet, /\{!running && r\.still && !allStill && <span className="wl-mv-now"[^>]*>\{MOVE_WORDS\.still\}<\/span>\}/, "and says so, unless no slider can move");
  assert.match(sheet, /\{!r\.still && <input type="range"/, "no slider for a place that can't move");
  // the grade (3 Nov, r-m04): no slider can move: said once, above Move, never four times and then "Drag a slider"
  assert.match(sheet, /const allStill = now\.every\(\(x\) => rangeOf\(now, x\.place, HOME_PROOF\)\.still\);\s*const block = allStill && total >= 2 \? MOVE_WORDS\.still : moveBlock\(legs, total, HOME_PROOF, now\);/);
});

test("Move's rows (review of the shots, 3 Nov): the Safe wears the shield Home's Safe tab shows, never a letter; each place says its dollars once, no % column (control: \"0 %\" beside $21.66 is gone)", () => {
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.match(sheet, /x\.place === "safe" \? <span className="wl-mv-shield"><TabSafe \/><\/span> : x\.place === "private" \? <PrivateMark size=\{24\} \/> : <CoinIcon/);
  assert.doesNotMatch(sheet, /x\.place === "private" \? <CoinIcon/, "control: Private wears its eye-slash mark, never a letter");
  assert.match(sheet, /import \{ (?:ActMove, )?(?:PrivateMark, )?TabSafe \} from "\.\.\/icons\.tsx";/);
  assert.doesNotMatch(sheet, /wl-mv-pct|\} %<|percent/, "control: no share column");
  assert.equal((sheet.match(/<span className="wl-mv-usd"/g) ?? []).length, 1, "the figure after the move, once per row");
});

test("R3 (the design review §4.4): Move opens on the total and one line, no \"Where your money sits\" header; \"Drag a slider\" is that line, never a paragraph above Move; the privacy line is one tap away and only with a plan (control: the old head and paragraph are gone)", () => {
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.match(sheet, /<div className="wl-mv-hero">\s*<p className="wl-mv-total"[^>]*>\{usdShort\(total\)\}<\/p>\s*<p className="wl-mv-lead">\{running \? \(allEnded \? "" : MOVE_WORDS\.closeOk\) : MOVE_WORDS\.untouched\}<\/p>/);
  assert.doesNotMatch(sheet, /wl-mv-head|<span className="zf-label">\{MOVE_WORDS\.head\}/, "control: no header row");
  assert.match(sheet, /\{block && block !== MOVE_WORDS\.untouched\n\s*\? <p className="zf-small wl-mv-why"/, "the why line above Move only for a real reason");
  assert.match(sheet, /\{!running && legs\.length > 0 && \(\s*<div className="wl-mv-who">[\s\S]*?aria-expanded=\{who\}[\s\S]*?\{who && <p className="zf-small wl-mv-foot" data-testid="move-private">\{MOVE_WORDS\.privately\}<\/p>\}/);
  assert.doesNotMatch(sheet, /\{!running && <p className="zf-small wl-mv-foot">\{MOVE_WORDS\.privately\}<\/p>\}/, "control: never the always-on grey paragraph");
  const css = readFileSync(new URL("../money/move-swap.css", import.meta.url), "utf8");
  assert.match(css, /\.zf-sheet__content:has\(> \.wl-mv-hero\) > :is\(\.wl-mv-why, \.zf-money__line\):has\(\+ \.wl-sheet-go\) \{ position: sticky; bottom: 74px;/, "the line rides the floor with its button");
  assert.match(css, /\.zf-group \.wl-mv-leg__fill \{ display: none; \}/, "one progress device: no fill bar");
});

test("R3 (review, 4 Nov): Move has no ribbon (a bar with no words), and no money sheet cuts content hard at either edge: the top fades out before the title, the floor is solid and square with a 32 px fade above it (controls: the ribbon and the rounded band's corners)", () => {
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.doesNotMatch(sheet, /wl-mv-ribbon|wl-mv-seg/, "control: the ribbon is gone");
  const css = readFileSync(new URL("../wallet.css", import.meta.url), "utf8");
  assert.match(css, /\.zf-money \.zf-sheet__content \{ -webkit-mask-image: linear-gradient\(to bottom, transparent 0, transparent calc\(var\(--zf-top, env\(safe-area-inset-top, 0px\)\) \+ 48px\), #000 calc\(var\(--zf-top, env\(safe-area-inset-top, 0px\)\) \+ 68px\)\);/);
  assert.match(css, /\.zf-sheet__content > \.wl-sheet-go:not\(\.wl-sheet-go ~ \.wl-sheet-go\)::before \{ content: ""; position: absolute; [^}]*top: -56px; bottom: calc\(-1 \* \(env\(safe-area-inset-bottom, 0px\) \+ 28px\)\); background: linear-gradient\(to bottom, color-mix\(in srgb, var\(--bg\) 0%, transparent\) 0, var\(--bg\) 32px, var\(--bg\) 56px, transparent 56px,/);
  // the fade never reaches past the sheet's own bottom padding: a box below it made every sheet scroll 34 pt and lifted
  // the button off the floor at the end of a scroll (control: -96px)
  assert.doesNotMatch(css, /bottom: -96px/);
  assert.match(css, /\.zf-sheet__content > :not\(\.wl-mv-why, \.zf-money__line\):has\(\+ \.wl-sheet-go:not\(\.wl-sheet-go ~ \.wl-sheet-go\)\) \{ margin-bottom: 60px; \}/, "the last line clears the fade");
  assert.match(css, /\.zf-sheet__content > \.wl-sheet-go:not\(\.wl-sheet-go ~ \.wl-sheet-go\) \{ overflow: visible; \}/, "the pill never clips its own fade");
});

test("the crawl (4 Nov): an unread Safe is never drawn as \"Safe $0\": the sheet says it is reading until the Safe answers, whatever the wallets hold", () => {
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.match(sheet, /if \(\(total < 2 \|\| safeUsd === null\) && !running\) \{\s*if \(moveUnread\(safeUsd, status\)\)/);
});

test("one figure per Move (QA's MUST, Sim test: the first Jobs frame said $2.11 for a $2.04 sheet): \"Job created.\" says what was typed, the rows say their legs (control: the old round-up is gone)", () => {
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.match(sheet, /made: \(usd\) => \{ setMade\(Math\.round\(usd \* 100\) \/ 100\);/);
  assert.match(sheet, /<span className="wl-mv-leg__v">\{usdShort\(r\.leg\.usd\)\}<\/span>/);
  assert.doesNotMatch(sheet, /gridStays|shownLegUsd|extraAtTap|usd \+ extra/, "control: the Safe → NEAR wallet round-up");
  assert.match(sheet, /const fills = fillLine\(legs, coins, SAFE_FILL_OPEN\);/, "the top-up is its own step line");
});

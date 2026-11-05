// The chat flow (the copy review, 5 Nov; $ZEROFEE_HOME/AGENTZERO-CHAT-UI-2026-11-05.md): Trade's tap and receipt in the
// thread. Source and CSS pins, each with a control, so a later edit that drops one of the six is seen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const css = read("./chat.css");
const chat = read("./AgentZeroChat.tsx");
const md = read("./MdText.tsx");
const money = read("./MoneyCard.tsx");
const receipt = read("../../../../packages/design/src/Receipt.tsx");
/** The last rule for a selector: the chat flow's section comes after the first look's and wins. */
const rule = (sel: string) => css.split("\n").filter((l) => l.startsWith(`${sel} {`)).at(-1) ?? "";

test("1. Send is a 44 pt circle with an arrow, lit only with words; quiet while the box is empty; Stop is the circle with a square", () => {
  assert.match(rule(".azc-send"), /width: 44px; min-width: 44px; height: 44px; padding: 0; border-radius: 50%/);
  assert.match(rule(".azc-send:disabled"), /background: var\(--fill, var\(--raise\)\); color: var\(--mute\); box-shadow: none/);
  assert.match(chat, /className="zf-btn azc-send" disabled=\{!words\.trim\(\)\} aria-label="Send"><svg/, "the arrow, and the label a screen reader hears");
  assert.match(chat, /className="zf-btn azc-send azc-stop" onClick=\{chat\.stop\} aria-label="Stop"><i aria-hidden="true" \/>/);
  assert.doesNotMatch(chat, /aria-label="Send">Send</, "control: no word in the circle");
  // one lit verb per screen: an act waiting in the last reply puts Send out
  assert.match(css, /\.azc:has\(\.azc-assistant:last-of-type \.azc-acts > \.azc-act:first-child:not\(\.azc-act--quiet\)\) \.azc-send:not\(:disabled\):not\(\.azc-stop\) \{ background: var\(--fill, var\(--raise\)\)/);
});

test("2. the wait: one still dot where the first word will start, with the screen reader's line kept", () => {
  assert.match(chat, /<span className="azc-wait" aria-hidden="true" \/><p className="azc-sr" role="status">AgentZero is thinking…<\/p>/);
  assert.match(rule(".azc-wait"), /width: 8px; height: 8px; .*border-radius: 50%; background: var\(--mute\); animation: none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.azc-wait \{ animation: none;/);
});

test("3. a reply's list: five lines, then \"and N more\"; a list of six shows all six", () => {
  assert.match(md, /export const LIST_CAP = 5;/);
  assert.match(md, /const capped = over > 1 && !all;/, "one hidden line is not worth a tap");
  assert.match(md, /<li className="azc-more"><button type="button" onClick=\{\(\) => setAll\(true\)\}>and \{over\} more<\/button><\/li>/);
  assert.match(css, /\.azc-list\.is-capped > li:nth-child\(n\+6\):not\(\.azc-more\) \{ display: none; \}/);
  assert.match(css, /\.azc-more button::after \{ content: ""; position: absolute; inset: -10px -8px; \}/, "a 44 pt tap all the same");
  assert.doesNotMatch(md, /dangerouslySetInnerHTML/, "control: still elements only");
});

test("4. the acts: the first is the lit command (44 pt rect, never full width); the rest quiet", () => {
  const lit = css.split("\n").find((l) => l.startsWith(".azc-acts > .azc-act:first-child:not(.azc-act--quiet) {")) ?? "";
  assert.match(lit, /height: 44px; padding: 0 20px; border-radius: 14px; background: var\(--lit, var\(--mint\)\); color: var\(--on-mint\)/);
  assert.doesNotMatch(lit, /width: 100%/);
  assert.match(css, /\.azc-acts > \.azc-act--quiet, \.azc-acts > \.azc-act:not\(:first-child\) \{ height: 44px; .*background: var\(--fill, var\(--raise\)\); color: var\(--ink\)/);
  assert.match(rule(".azc-act"), /height: 32px/, "control: the base pill rule in-chat-actions.test pins is untouched");
});

test("5. a money card that follows its move wears the design's receipt mark: away, then landed only when Activity says so, refused when it stopped, checking when it went but can't be followed", () => {
  assert.match(receipt, /export function ReceiptMark\(\{ state, icon, size = 48 \}/);
  assert.match(money, /import \{ ReceiptMark \} from "@zerofee\/design\/Receipt\.tsx";/);
  assert.match(money, /setState\("following"\);\n    setMark\("away"\);/);
  assert.match(money, /setMark\(end\.kind === "landed" \? "landed" : end\.kind === "stopped" \? "refused" : "checking"\);/);
  assert.match(money, /setSaid\("It went\. Activity shows it when it lands\."\);\n      setMark\("checking"\);/);
  assert.match(money, /\{mark && <ReceiptMark state=\{mark\} icon=\{<CoinIcon symbol=\{coinOf\(ask\)\} icon=\{ICON_OF\[coinOf\(ask\)\]\} size=\{26\} \/>\} \/>\}/);
  assert.doesNotMatch(money, /setMark\("landed"\)(?!.*end\.kind)/s, "control: landed is never set outside the end's own kind");
  assert.match(css, /\.azc-money\[data-mark\] \{ display: grid; grid-template-columns: 48px minmax\(0, 1fr\)/);
});

test("6. one place, one sentence: the shell's bottom line is not shown over AgentZero while its last reply follows the move", () => {
  assert.match(css, /\.ah:has\(\.ah-page:not\(\[aria-hidden="true"\]\) \.azc-assistant:last-of-type \.azc-money\[data-mark\]\) > \.zf-notice \{ display: none; \}/);
  assert.doesNotMatch(css, /\.ah:has\(\.azc-money\[data-mark\]\) > \.zf-notice/, "control: never on a hidden page's card (the other apps keep their line)");
});

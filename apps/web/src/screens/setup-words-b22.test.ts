// Builder 22's item 1 (8 Nov): the shell's set-up screens (App.tsx) and the wallet's waits (WalletApp.tsx, Receive) said
// a bare wait with an ellipsis ("Opening your account…", "One moment…", "Still working…", "Reading the networks…"). Each
// line now says what is happening and who, with one clock; the person's own turn has no clock. Fails on main: there is
// no setup-words.ts and the ellipses are still in App.tsx and WalletApp.tsx.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SETUP_WORDS } from "./setup-words.ts";
import { WAIT_WORDS } from "../../../../packages/wallet/src/app/wait-words.ts";
import { WEB_START } from "./web-words-held.ts";

/** Flesch-Kincaid grade, as apps/web/src/shell/nothing-blocks.test.ts measures it (audit D7). */
function fkGrade(text: string): number {
  const sentences = Math.max(1, text.split(/[.?!]+/).filter((s) => s.trim()).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return 0;
  const syll = (w: string) => { const s = w.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, ""); return Math.max(1, (s.match(/[aeiouy]+/g) ?? []).length); };
  return 0.39 * (words.length / sentences) + 11.8 * (words.reduce((n, w) => n + syll(w), 0) / words.length) - 15.59;
}
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
/** The file's code without its comments: what can reach a screen. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

const ALL = { ...SETUP_WORDS, ...WAIT_WORDS, webMaking: WEB_START.making };
const OWN_TURN = new Set(["typeOnPhone", "backupOnPhone", "newOnPhone"]);

test("setup-words-b22: no ellipsis on the set-up screens or the wallet's waits", () => {
  for (const f of ["../App.tsx", "./Working.tsx", "./web-words-held.ts", "../../../../packages/wallet/src/app/WalletApp.tsx", "../../../../packages/wallet/src/app/ReceiveScreen.tsx"]) {
    const src = code(read(f));
    assert.doesNotMatch(src, /…/, `${f} keeps an ellipsis`);
    assert.doesNotMatch(src, /[a-z]\.\.\.["'`<]/i, `${f} keeps "..."`);
  }
  for (const [k, line] of Object.entries(ALL)) assert.doesNotMatch(line, /…|\.\.\./, k);
});

test("setup-words-b22: each line says who, one idea per sentence, one clock (none on the person's own turn)", () => {
  for (const [k, line] of Object.entries(ALL)) {
    assert.ok(fkGrade(line) <= 5, `${k} grades ${fkGrade(line).toFixed(1)}: ${line}`);
    assert.match(line, /\b(NEAR|ZeroFee|Your|Type|This screen)\b/, `${k} names no one: ${line}`);
    const clocks = line.match(/About \d+ s\./g) ?? [];
    assert.equal(clocks.length, OWN_TURN.has(k) ? 0 : 1, `${k}: ${line}`);
  }
  assert.equal(SETUP_WORDS.opening, "NEAR is making your account. About 5 s.");
});

test("setup-words-b22: App.tsx draws the lines from SETUP_WORDS, the wallet from WAIT_WORDS", () => {
  const app = read("../App.tsx");
  for (const k of ["opening", "reading", "retrying", "removePhone", "removeLost", "checking", "typeOnPhone", "finding", "bringing", "renewing", "movingOld", "stopping", "lookingForMoney", "addingWords", "loading", "backupOnPhone", "newOnPhone"])
    assert.ok(app.includes(`SETUP_WORDS.${k}`), k);
  const wallet = read("../../../../packages/wallet/src/app/WalletApp.tsx");
  for (const k of ["opening", "wallets", "networks"]) assert.ok(wallet.includes(`WAIT_WORDS.${k}`), k);
});

// the copy review's Sim re-walk (5 Nov): Details' Safe card said "Why it has no export" (a question for a row that states a fact) and
// its id line read the Sim's raw "zf-account". Now: "No export for this key", its reason under it; the Sim's account
// says Chat's own words for it, "Sample account" (chat account-words.ts), never machine text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const details = readFileSync(new URL("./Details.tsx", import.meta.url), "utf8");

test("Details' no-export row is a statement, its reason under it (control: the reason lines are as before)", () => {
  // the copy review's S4 (7 Nov), by platform (B11): the words come from key-place.ts's one table (key-place.test.ts); the web says
  // "never leaves" once (the row), so its reason line is the table's (none on the web)
  assert.match(details, /<More label=\{key\.neverLeaves\} className="wl-dt-more" lines=\{\[\.\.\.\(key\.neverLeavesWhy \? \[key\.neverLeavesWhy\] : \[\]\), "Your 24 backup words bring your Safe back on a new device, after its wait\."\]\} \/>/);
  assert.doesNotMatch(details, /Why it has no export/, "fails before: the row was a question");
});

test("Details says the Sim's account as Chat does, \"Sample account\", with no Copy (control: a real account keeps its short id and Copy)", async () => {
  const { SIM_ACCOUNT, accountWords } = await import("@zerofee/chat/account-words.ts");
  const names = await import("@zerofee/chat/names.ts");
  assert.equal(accountWords(SIM_ACCOUNT), "Sample account");
  assert.equal(names.accountWords, accountWords, "one source: Chat's names.ts says the same");
  assert.equal(accountWords("abc.near"), "abc.near", "control: a real account is itself");
  assert.match(details, /if \(id === SIM_ACCOUNT\) return <p className="zf-small" data-testid="details-account">\{accountWords\(id\)\}<\/p>;/, "fails before: the Sim showed shortKey(\"zf-account\")");
  assert.match(details, /<span className="wl-dt-addr__text">\{DETAILS_WORDS\.address\}<\/span>/, "the copy review's S4: a real account's row says \"Your Safe address\", never its id");
  assert.doesNotMatch(details, /shortKey\(id\)/, "fails before: \"zf-sam…tnet\" on the screen");
  assert.doesNotMatch(readFileSync(new URL("../../../../chat/src/account-words.ts", import.meta.url), "utf8"), /^import /m, "light: Details loads no Chat code");
});

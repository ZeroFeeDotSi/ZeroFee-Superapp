// QA 16's S7 + S8 (8 Nov): an opened "Didn't go" card said its sentence twice (the row's line, then the stopped step's
// note); the Kept card hedged ("It's most likely with Rhea's team"), showed the raw wallet id, hash and contract under Show
// details, and its Copy said nothing. Now: said once, no hedge, no raw id on screen, "Copied" when it copied.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keptWay } from "./job-cards.ts";

const card = readFileSync(new URL("./screens/JobCard.tsx", import.meta.url), "utf8");

test("S7: a step's note that is the row's own line is not said again under the step", () => {
  assert.match(card, /<span>\{s\.label\}\{s\.note && s\.note !== sub && <small>\{s\.note\}<\/small>\}<\/span>/);
  assert.doesNotMatch(card, /<span>\{s\.label\}\{s\.note && <small>/);
});

test("S8: the Kept card says what to do, no hedge; its details are names with Copy, never the raw id; Copy says Copied", () => {
  const k = { id: "t", wallet: "w.near", hash: "h1", token: "dragon.near", symbol: "BLACKDRAGON", decimals: 18 };
  const v = keptWay(k, "0");
  assert.equal(v.body, "Ask Rhea's team to send it back. Show them the details below.", "QA's SHOULD: what to show them");
  assert.doesNotMatch(JSON.stringify(v), /most likely|probably|maybe/i);
  // the values stay for Copy, the screen shows only the names
  assert.deepEqual(v.details!.rows.map((r) => r.value), ["w.near", "h1", "dragon.near"]);
  assert.doesNotMatch(card, /className="v">\{r\.value\}/, "no raw value on screen");
  assert.doesNotMatch(card, /navigator\.clipboard/);
  assert.match(card, /import \{ copyText \} from "@zerofee\/shell-api\/copy-text\.ts";/);
  assert.match(card, /copyText\(v\)\.then\(\(ok\) => \{\n    if \(!ok\) return;\n    setCopied\(label\);/, "Copied only when it copied");
  assert.match(card, /\{copied === r\.label \? "Copied" : "Copy"\}/);
  const css = readFileSync(new URL("./activity.css", import.meta.url), "utf8");
  assert.match(css, /\.tr-kept-row \{ display: grid; grid-template-columns: 1fr auto;/);
  assert.doesNotMatch(css, /\.tr-kept-row \.v \{/);
});

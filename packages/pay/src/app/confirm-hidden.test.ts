// V4 Send's confirm card (QA, 3 Nov): Hidden's word (D108), and the address once, tap-to-copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shortAddress } from "../chains.ts";

const view = readFileSync(new URL("./screens/Confirm.tsx", import.meta.url), "utf8");
const strings = [...view.matchAll(/"([^"\n]*)"/g)].map((m) => m[1]!);

test("the card says Private, never Hidden (product decision, 5 Nov) (control: the words are there to read)", () => {
  assert.deepEqual(strings.filter((x) => /\bHidden\b/.test(x)), []);
  assert.ok(strings.includes("From Private") && strings.includes("Pay from Private"));
});

test("the address is said once: a title that is already the short address gets only its network under it", () => {
  assert.match(view, /c\.payee !== c\.payeeFull && c\.payee !== shortAddress\(c\.payeeFull\) \? <div className="py-mono"/);
  const sol = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
  assert.equal(shortAddress(sol), "13Qkxh…gjRK", "the title a pasted Solana address gets");
});

test("the title copies the whole address on a tap, and says Copied", () => {
  assert.match(view, /data-testid="confirm-copy-to" onClick=\{\(\) => void navigator\.clipboard\?\.writeText\(c\.payeeFull\)/);
  assert.match(view, /\{copied && <p className="zf-small" role="status">Copied<\/p>\}/);
});

// the audit's R3 for separate steps on one sheet (C5, fix/safe-steps-one-faceid, 7 Nov). Source pins on the Swift side (no Swift
// unit runner here; the TS sides are behaviour tests in packages/core/src/dev-signer-apart.test.ts):
// (a) at most 4 txs, more refused, never split; (b) Swift decodes and checks EVERY tx itself and shows each one's own
// checked lines (not the page's words); (c) the one Face ID's context dies on the last signature.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const chip = read("apps/ios/ZeroFee/ChipKey.swift");
const sheet = read("apps/ios/ZeroFee/NativeSheet.swift");
const body = (src: string, start: string) => { const i = src.indexOf(start); assert.ok(i >= 0, start); const j = src.indexOf("\n  }\n", i); return src.slice(i, j); };
const signSet = body(sheet, "func signSetOnSheet(");
const signMany = body(chip, "static func signMany(");

test("R3 (a): four at most, refused by name above it, in the sheet and again in the chip; one sheet, never split", () => {
  assert.match(chip, /static let maxHashes = 4\n/);
  assert.match(signSet, /guard txs\.count <= ChipKey\.maxHashes else \{ return refused\("This has more steps than one Face ID covers, so ZeroFee stopped it\. Your money hasn't moved\."\) \}/);
  assert.match(signMany, /guard \(1\.\.\.maxHashes\)\.contains\(hashes\.count\) else \{ throw Refused/);
  assert.equal((signSet.match(/presentSheet\(/g) ?? []).length, 1, "one sheet for the whole set");
  assert.equal((signSet.match(/ChipKey\.signMany\(hashes: hashes\)/g) ?? []).length, 1, "one signMany, so one Face ID");
});

test("R3 (b): every tx decoded here against this phone's key, matched to its own summary, hashed here, its own lines shown", () => {
  const loop = signSet.slice(signSet.indexOf("for tx in txs {"), signSet.indexOf("hashes.append(NearTx.hash(bytes))"));
  assert.match(loop, /guard let decoded = NearTx\.decode\(bytes, publicKey: publicKey\) else/);
  assert.match(loop, /guard let summary = NearTx\.summary\(tx\["summary"\]\), NearTx\.matches\(decoded, summary\) else/);
  assert.match(signSet, /hashes\.append\(NearTx\.hash\(bytes\)\)\n\s+checked\.append\(contentsOf: decoded\.checked\)\n\s+\}/, "each tx's own checked lines, in order");
  assert.match(signSet, /presentSheet\(words, footer: "Approved inside this phone's secure chip", checked: checked,/, "the sheet shows Swift's own lines for every tx");
  assert.match(signSet, /guard signatures\.count == hashes\.count else/, "a signature per tx or none");
});

test("R3 (c): the context ends on the last signature (the function's end), on a refusal, or the background; never reused", () => {
  assert.match(signMany, /let context = LAContext\(\)\n\s+context\.touchIDAuthenticationAllowableReuseDuration = 0\n\s+let unlock = Unlock\(context: context\)\n\s+defer \{ unlock\.end\(\) \}/);
  assert.match(signMany, /for hash in hashes \{\n\s+guard unlock\.live\(\) else/);
  assert.match(chip, /func end\(\) \{\n\s+let first: Bool = lock\.withLock \{ defer \{ ended = true \}; return !ended \}\n\s+if first \{ context\.invalidate\(\) \}/);
  assert.match(signMany, /didEnterBackgroundNotification, object: nil, queue: nil\) \{ _ in unlock\.end\(\) \}/);
});

// the audit's MUST on the phone (8 Nov, ruling (c)): the Safe's sheet there is Swift's own (NativeSheet.swift), not the web's
// ApprovalSheet, so keptArm never runs on it. Pinned here: (a) the core's sheet lines, with "Costs more than the plan
// said." at their head, reach the native sheet verbatim (dev-signer hands its shown words to key.sign / key.signSet,
// the vault passes them on, ChipKey routes them to signOnSheet / signSetOnSheet, SheetWords reads every line or nothing,
// and the view draws each one); (b) Approve's arm runs from when those words appear: every sheet is a FRESH native view
// (presentSheet -> presentModal -> a new SheetHost, presented; one at a time), never words swapped into an open one, and
// that view starts off and arms 700 ms after it appears.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { moveSheet } from "@zerofee/core/move-plan";
import { COSTS_MORE_HEAD } from "@zerofee/core/float-floors";

const read = (f: string) => readFileSync(fileURLToPath(new URL(`../../${f}`, import.meta.url)), "utf8");
const native = read("apps/ios/ZeroFee/NativeSheet.swift");
const words = read("apps/ios/ZeroFee/SheetWords.swift");
const chip = read("apps/ios/ZeroFee/ChipKey.swift");
const signer = read("packages/core/src/dev-signer.ts");
const vault = read("apps/web/src/host/vault.ts");
const swift = readdirSync(fileURLToPath(new URL("../../apps/ios/ZeroFee/", import.meta.url))).filter((f) => f.endsWith(".swift")).map((f) => read(`apps/ios/ZeroFee/${f}`)).join("\n");

test("(a) the core's head line reaches the phone's native sheet verbatim, first, with the real rows", () => {
  const $c = (v: bigint) => `$${(Number(v) / 100).toFixed(2)}`;
  const past = moveSheet([{ wallet: "your SOL wallet", priv: 0n, pay: 5100n, got: 5000n, least: 4500n }], 6000n, $c);
  assert.equal(past.lines[0], COSTS_MORE_HEAD);
  assert.ok(![...COSTS_MORE_HEAD].some((ch) => ch.charCodeAt(0) < 0x20 || (ch.charCodeAt(0) >= 0x7f && ch.charCodeAt(0) <= 0x9f) || (ch.charCodeAt(0) >= 0x200b && ch.charCodeAt(0) <= 0x206f)), "no character SheetWords.unreadable drops");
  // the core hands the very words it shows to the phone's own sheet (one tx and a set)
  assert.match(signer, /await onSheet\(\{ id: shown\.id, words: shown\.words, bytes: txs\[0\]!\.bytes/);
  assert.match(signer, /await onSheetSet\(\{ id: shown\.id, words: shown\.words, txs:/);
  assert.match(vault, /\("key\.sign", \{ id, words, bytes: toB64\(bytes\), summary \}\)/);
  assert.match(vault, /\("key\.signSet", \{ id, words, txs:/);
  assert.match(chip, /case "key\.sign":[\s\S]{0,140}return await signOnSheet\(p\)/);
  assert.match(chip, /case "key\.signSet":[\s\S]{0,160}return await signSetOnSheet\(p\)/);
  // Swift reads every line or shows nothing (a line it can't read is never quietly dropped) and draws each, in order
  assert.equal((native.match(/guard let words = SheetWords\(p\["words"\]\) else \{ return refused\(/g) ?? []).length, 2);
  assert.match(words, /guard readLines\.count == lines\.count, readWarnings\.count == warnings\.count, readEffects\.count == effects\.count else \{ return nil \}/);
  assert.match(native, /ForEach\(Array\(words\.lines\.enumerated\(\)\), id: \\\.offset\) \{ _, line in/);
  assert.match(native, /\} else \{\n\s+Text\(line\)\.font\(\.system\(size: 15\)\)/, "a plain line (the head) is drawn as itself");
});

test("(b) Approve's arm runs from when the words appear: each sheet a fresh native view, never words swapped into an open one; off, then armed 700 ms after it appears", () => {
  // both sign paths present a sheet of their own words
  assert.match(native, /guard let signature = await presentSheet\(words, footer: "Approved inside this phone's secure chip", checked: decoded\.checked/);
  assert.match(native, /guard let signatures = await presentSheet\(words, footer: "Approved inside this phone's secure chip", checked: checked/);
  const present = native.slice(native.indexOf("func presentSheet<T>("), native.indexOf("func presentModal<T>("));
  assert.match(present, /return await presentModal\(approval: true\) \{[\s\S]*AnyView\(NativeSheetView\(\n\s+words: words,/);
  const modal = native.slice(native.indexOf("func presentModal<T>("), native.indexOf("private static func putAway("));
  assert.match(modal, /guard !Self\.sheetOpen else \{ return nil \}\n\s+Self\.sheetOpen = true/, "one at a time: a second sheet is never laid over or into an open one");
  assert.match(modal, /let sheet = SheetHost\(make\(finish\), awayInBackground: approval\)/, "a new host for every sheet");
  assert.match(modal, /top\.present\(sheet, animated: !approval\)/);
  // nothing ever puts new words into a shown sheet
  assert.doesNotMatch(swift, /\.rootView\s*=/, "no host's view is replaced in place");
  // the view's own arm: off at first, Approve disabled until it arms, armed 700 ms after the view (and its words) appear
  assert.match(native, /@State private var armed = false/);
  assert.match(native, /\.disabled\(!armed \|\| !reachedEnd \|\| busy\)/);
  assert.match(native, /\.task \{\n\s+try\? await Task\.sleep\(for: \.milliseconds\(700\)\)\n\s+armed = true\n\s+\}/);
});

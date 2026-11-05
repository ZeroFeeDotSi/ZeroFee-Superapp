// QA's MUST (5 Nov): on the phone's own approval sheet (NativeSheet.swift), as on the web's, a Send's payee
// address in full sits OPEN directly under its To row, never inside a fold: the core's `details[].open.after`
// (packages/core/src/signer.ts) is read by SheetWords.swift and drawn by the line it names, in the money face (monospaced),
// in groups of 4, one tap copies it. Every other detail stays one tap open, as before. Swift has no test target here, so
// this reads the Swift source; each rule has a control (a bad snippet fails it). The behaviour was also run once with
// swiftc against SheetWords.swift (grouped, open read, a line not on the sheet refused).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
const code = (src: string) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");

function openUnderItsLine(words: string, sheet: string): string[] {
  const p: string[] = [];
  if (!/var openAfter: String\? = nil/.test(words)) p.push("SheetWords' details carry no openAfter");
  // read only when its line is on the sheet; anything else fails the whole sheet (nothing shown, nothing signed)
  if (!/if let o = item\["open"\], !\(o is NSNull\) \{\s*guard let o = o as\? \[String: Any\], let after = text\(o\["after"\]\), readLines\.contains\(after\) else \{ return nil \}\s*openAfter = after/.test(words)) p.push("open isn't read strictly");
  // drawn inside the lines' loop, right under the line it names
  const lines = sheet.indexOf("ForEach(Array(words.lines.enumerated())");
  const folds = sheet.indexOf("DisclosureGroup");
  const open = sheet.indexOf("words.details.filter { $0.openAfter == line }");
  if (lines < 0 || open < lines || (folds >= 0 && open > folds)) p.push("the full address isn't drawn under its line, before any fold");
  if (!/words\.details\.filter \{ \$0\.openAfter == line \}[\s\S]{0,200}FullAddress\(address: address\)/.test(sheet)) p.push("not drawn as FullAddress");
  // the folds take only the details without `open`
  const foldLoop = sheet.slice(sheet.lastIndexOf("ForEach", folds), folds);
  if (!/words\.details\.filter \{ \$0\.openAfter == nil \}/.test(foldLoop)) p.push("an open detail can still end up in a fold");
  // the money face, groups of 4, tap to copy the address itself
  const view = sheet.slice(sheet.indexOf("struct FullAddress: View"));
  if (!/UIPasteboard\.general\.string = address/.test(view)) p.push("tap doesn't copy the address");
  if (!/Text\(SheetWords\.grouped\(address\)/.test(view) || !/design: \.monospaced/.test(view)) p.push("not the money face in groups");
  if (!/static func grouped\(_ address: String\) -> String/.test(words) || !/offsetBy: 4/.test(words)) p.push("no groups of 4");
  return p;
}

test("the audit's MUST: the phone's sheet shows the payee's full address open under its To row, never in a fold (controls: the old fold-all loop; open read loosely; no copy)", () => {
  const words = code(read("apps/ios/ZeroFee/SheetWords.swift"));
  const sheet = code(read("apps/ios/ZeroFee/NativeSheet.swift"));
  assert.deepEqual(openUnderItsLine(words, sheet), []);
  // controls
  const foldAll = sheet.replace("words.details.filter { $0.openAfter == nil }", "words.details");
  assert.ok(openUnderItsLine(words, foldAll).includes("an open detail can still end up in a fold"));
  const loose = words.replace(", readLines.contains(after) else", " else");
  assert.ok(openUnderItsLine(loose, sheet).includes("open isn't read strictly"));
  const noCopy = sheet.replace("UIPasteboard.general.string = address", "");
  assert.ok(openUnderItsLine(words, noCopy).includes("tap doesn't copy the address"));
  const gone = sheet.replace("words.details.filter { $0.openAfter == line }", "[SheetWords.Details]()");
  assert.ok(openUnderItsLine(words, gone).length > 0, "control: not drawn at all");
});

test("the core's sheet words carry `open` to the phone (readableWords keeps it), and the web sheet is the same rule", () => {
  const signer = read("packages/core/src/signer.ts");
  assert.match(signer, /open\?: \{ after: string \}/);
  assert.match(signer, /\.\.\.\(d\.open \? \{ open: \{ after: readable\(d\.open\.after\) \} \} : \{\}\)/);
});

// the copy review's rules (5 Nov) for every outside sheet's full address, on the phone as on the web (apps/web/src/shell/sheet-address.ts):
// "To" a 12 pt caption over the address, the address mono 15 pt in groups of 4 with THIN spaces, wrapping, never
// truncated, tap copies the address itself; the lands line ("Public on Solana." / "Private.") quiet. Run once with
// swiftc against SheetWords.swift (EVM and Solana groups, copy with no spaces, a short form and an own wallet refused).
function outsideRules(words: string, sheet: string): string[] {
  const p: string[] = [];
  if (!/groups\.joined\(separator: "\\u\{2009\}"\)/.test(words)) p.push("not thin spaces");
  if (!/static func toAddress\(_ line: String\) -> String\?/.test(words) || !/a\.contains\("…"\) \? nil/.test(words)) p.push("no strict To <address> read");
  if (!/static func isLands\(_ line: String\) -> Bool/.test(words)) p.push("no lands line");
  const loop = sheet.slice(sheet.indexOf("ForEach(Array(words.lines.enumerated())"), sheet.indexOf("DisclosureGroup"));
  if (!/if let to = SheetWords\.toAddress\(line\) \{\s*VStack\(alignment: \.leading, spacing: 2\) \{\s*Text\("To"\)\.font\(\.system\(size: 12\)\)\.foregroundStyle\(\.secondary\)\s*FullAddress\(address: to\)/.test(loop)) p.push("no To caption over the address");
  if (!/else if SheetWords\.isLands\(line\) \{\s*Text\(line\)\.font\(\.system\(size: 15\)\)\.foregroundStyle\(\.secondary\)/.test(loop)) p.push("the lands line isn't quiet");
  const view = sheet.slice(sheet.indexOf("struct FullAddress: View"));
  if (!/\.lineLimit\(nil\)/.test(view) || /truncationMode/.test(view)) p.push("may truncate");
  if (!/UIPasteboard\.general\.string = address/.test(view)) p.push("copy isn't the address itself");
  return p;
}

test("the copy review's rules on the phone: To caption, thin-space groups, the lands line quiet, never truncated, copy without spaces (controls: plain spaces; no caption; truncation)", () => {
  const words = code(read("apps/ios/ZeroFee/SheetWords.swift"));
  const sheet = code(read("apps/ios/ZeroFee/NativeSheet.swift"));
  assert.deepEqual(outsideRules(words, sheet), []);
  assert.ok(outsideRules(words.replace('"\\u{2009}"', '" "'), sheet).includes("not thin spaces"));
  assert.ok(outsideRules(words, sheet.replace('Text("To").font(.system(size: 12))', 'Text("").font(.system(size: 12))')).includes("no To caption over the address"));
  assert.ok(outsideRules(words, sheet.replace(".lineLimit(nil)", ".lineLimit(1).truncationMode(.middle)")).includes("may truncate"));
});

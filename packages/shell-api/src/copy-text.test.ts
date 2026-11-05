// QA's crawl (4 Nov): the web Add's Copy did nothing on a page without focus (navigator.clipboard.writeText
// refuses "Document is not focused"), yet the row could say "Copied". Now the write is asked in the tap itself, a refusal
// falls back to a selected field and execCommand("copy"), and "Copied" is said only when one of them copied.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyText } from "./copy-text.ts";

/** A page: execCommand("copy") copies what the field holds when `can`, and records each step. */
function page(can: boolean) {
  const log: string[] = [];
  const doc = {
    activeElement: null,
    body: { appendChild: () => log.push("append") },
    createElement: () => {
      const el = { value: "", style: {} as Record<string, string>, setAttribute() {}, focus: () => log.push("focus"), select: () => log.push("select"), setSelectionRange: (a: number, b: number) => log.push(`range ${a}-${b}`), remove: () => log.push("remove") };
      return el;
    },
    execCommand: (c: string) => (log.push(`exec ${c}`), can),
  };
  return { doc: doc as never, log };
}

test("the clipboard refuses (no focus): the selected field and execCommand copy it, and only then is it copied", async () => {
  const { doc, log } = page(true);
  const asked: string[] = [];
  const ok = await copyText("3R36R", { writeText: (t) => (asked.push(t), Promise.reject(new Error("Document is not focused."))) }, doc);
  assert.equal(ok, true);
  assert.deepEqual(asked, ["3R36R"], "the clipboard is asked first, in the tap");
  assert.deepEqual(log, ["append", "focus", "select", "range 0-5", "exec copy", "remove"]);
});

test("neither copies: false, so no \"Copied\" (control: the clipboard answers, no fallback)", async () => {
  const none = page(false);
  assert.equal(await copyText("3R36R", { writeText: () => Promise.reject(new Error("NotAllowedError")) }, none.doc), false);
  assert.equal(await copyText("3R36R", undefined, page(false).doc), false, "no clipboard at all, execCommand refused");
  const fine = page(true);
  assert.equal(await copyText("3R36R", { writeText: () => Promise.resolve() }, fine.doc), true);
  assert.deepEqual(fine.log, [], "control: no fallback when the clipboard took it");
  const thrown = page(true);
  assert.equal(await copyText("3R36R", { writeText: () => { throw new Error("NotAllowedError"); } }, thrown.doc), true, "a throw at once falls back too");
});

test("Add's rows and its QR page copy in the tap itself and say Copied only when it copied; Activity's proof line too", () => {
  const add = readFileSync(new URL("../../wallet/src/app/money/WebAddSheet.tsx", import.meta.url), "utf8");
  assert.match(add, /const copy = \(text: string, row\?: WebAddRow\) => void copyText\(text\)\.then\(\(ok\) => \{ if \(ok\) setCopied\(text\); else if \(row\) setQr\(row\); \}\);/);
  assert.match(add, /onClick=\{\(\) => copy\(x\.address, x\)\}/);
  assert.match(add, /onClick=\{\(\) => copy\(qr\.address\)\}/);
  assert.doesNotMatch(add, /setCopied\(x\.address\)|setCopied\(qr\.address\)|navigator\.clipboard/, "never Copied before the copy answered");
  const proof = readFileSync(new URL("./TxProofLine.tsx", import.meta.url), "utf8");
  assert.match(proof, /void copyText\(tx\.hash\)\.then\(\(ok\) => \{ if \(!ok\) return; setCopied\(true\);/);
});

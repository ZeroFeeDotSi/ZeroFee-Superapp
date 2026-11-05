// the copy review's rules (5 Nov) for the full address on every outside sheet (the fill sheet and the plain outside sheet, the
// phone's sheet and the Sim's): mono, groups of 4 with thin spaces, --ink 15 px, wrapping freely, never ellipsised; "To"
// a 12 px --mute caption above it; "Public on Solana." / "Private." quiet under it; copying gives no spaces. Never in a
// fold (the audit and the copy review's ruling).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readableWords as readable } from "@zerofee/core/signer";
import { THIN, groupAddress, isLandsLine, isLeadLine, toAddress, ungroup } from "./sheet-address.ts";

const view = readFileSync(new URL("./ApprovalSheetView.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./approval.css", import.meta.url), "utf8");
const EVM = "0x5290aBcDeF0123456789aBcDeF012345679EE7";
const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

test("groups of 4 with thin spaces: an EVM address keeps its 0x on the first group; a Solana one from its start; every character kept (controls: a name stays as it is; copying gives no spaces)", () => {
  assert.equal(groupAddress(EVM), ["0x5290", "aBcD", "eF01", "2345", "6789", "aBcD", "eF01", "2345", "679E", "E7"].join(THIN));
  assert.equal(groupAddress(SOL), ["7xKX", "tg2C", "W87d", "97TX", "JSDp", "bD5j", "Bkhe", "TqA8", "3TZR", "uJos", "gAsU"].join(THIN));
  assert.ok(!groupAddress(SOL).includes(" "), "thin spaces, never plain ones");
  assert.ok(!groupAddress(SOL).includes("…"), "never shortened");
  assert.equal(groupAddress("bob.near"), "bob.near", "control: a NEAR name as it is");
  // copying: the address alone
  for (const a of [EVM, SOL]) assert.equal(ungroup(groupAddress(a)), a, "control: copy has no spaces");
  assert.equal(ungroup(`To ${groupAddress(SOL)}`.slice(3)), SOL);
});

test("the sheet reads the core's lines: \"To <address>\" is the full address (never a short form), the lands line is quiet (controls)", () => {
  assert.equal(toAddress(`To ${SOL}`), SOL);
  assert.equal(toAddress("To bob.near"), "bob.near");
  assert.equal(toAddress("To 0x7D06…7e3D on Ethereum"), null, "control: a short form is not the address");
  assert.equal(toAddress("To your SOL wallet"), null, "control: an own wallet's words");
  assert.ok(isLandsLine("Public on Solana.") && isLandsLine("Private."));
  assert.ok(!isLandsLine("Anyone can see the Safe's part."), "control: another line");
});

test("the view: the To caption above the address, the address a copy button in groups, mono 15 px ink, wrapping and never ellipsised; the lands line --mute; nothing in a fold", () => {
  const lines = view.slice(view.indexOf("{words.lines.map("), view.indexOf("{words.warnings.map("));
  assert.match(lines, /const to = toAddress\(line\);\n\s+if \(to\) return <div key=\{i\} className="approval__to"><span className="approval__to-cap">To<\/span><FullAddress label="The address" address=\{to\} \/><\/div>;/);
  assert.match(lines, /if \(isLandsLine\(line\)\) return <p key=\{i\} className="approval__line approval__lands">\{line\}<\/p>;/);
  assert.match(lines, /words\.details\?\.filter\(\(d\) => !d\.open\)\.map\(\(d, i\) => <More /, "control: only the other details fold");
  const fn = view.slice(view.indexOf("function FullAddress"));
  assert.doesNotMatch(fn, /<More|<details/, "no fold inside it");
  assert.match(fn, /\{groupAddress\(address\)\}/, "groups of 4");
  assert.match(fn, /navigator\.clipboard\?\.writeText\(address\)/, "a tap copies the address itself");
  assert.match(fn, /onCopy=\{\(e\) => \{ e\.preventDefault\(\); e\.clipboardData\.setData\("text\/plain", ungroup\(/, "selecting and copying: no spaces");
  const rule = (sel: string) => css.match(new RegExp(`${sel.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";
  const addr = rule(".approval__addr");
  for (const want of [/font-family: var\(--zf-mono/, /font-size: 15px/, /color: var\(--ink\)/, /overflow-wrap: anywhere/, /text-overflow: clip/]) assert.match(addr, want);
  assert.doesNotMatch(addr, /ellipsis|nowrap/, "never ellipsised, wraps freely");
  assert.match(rule(".approval__to-cap"), /font-size: 12px;[^}]*color: var\(--mute\)/);
  assert.match(rule(".approval__lands"), /color: var\(--mute\)/);
});

test("an open detail survives the core's readable pass, still under its line (control: a plain detail stays plain)", () => {
  const w = readable({ title: "t", lines: ["To 0x7D06…7e3D on Ethereum"], warnings: [], effect: [], details: [{ label: "The address in full", lines: ["0x7D06AaAAaAaaa5aAAAaAaAaAAAAAaaaaaAaA7E3D"], open: { after: "To 0x7D06…7e3D on Ethereum" } }, { label: "Details", lines: ["x"] }] });
  assert.deepEqual(w.details?.map((d) => d.open?.after ?? null), ["To 0x7D06…7e3D on Ethereum", null]);
});

test("a Send fill sheet's first leg (the UI lead's rulings, 5 Nov): \"They get · 1.2345 SOL ($40.00)\" in --ink, the Safe's and Private's legs --mute (controls: \"They get about $2.71\" stays a plain line)", () => {
  assert.ok(isLeadLine("They get · 1.2345 SOL ($40.00)") && isLeadLine("They get · $40.00"));
  for (const l of ["Your Safe sends · $50.00", "Stays in Private · $10.00", "They get 0.2 SOL", "They get about $2.71", "From your Safe · $20.00", "Together · $30.00"]) assert.ok(!isLeadLine(l), `control: ${l}`);
  const lines = view.slice(view.indexOf("{words.lines.map("), view.indexOf("{words.warnings.map("));
  assert.match(lines, /if \(isLeadLine\(line\)\) return <p key=\{i\} className="approval__line approval__lead">\{line\}<\/p>;/);
  assert.match(css, /\.approval__line\.approval__lead \{ color: var\(--ink\); \}/);
  assert.match(css, /\.approval__line \{ font: 400 15px\/20px var\(--font\); color: var\(--mute\);/, "control: every other line stays --mute");
});

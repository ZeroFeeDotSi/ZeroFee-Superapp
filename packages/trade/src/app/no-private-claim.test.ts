// Audit P-1: 1Click can link the vault, Trading and the trading wallets, so "private" is not a true promise. Trade's
// words (every screen, the move cards, the problems it shows) make no "private" claim about its moves or wallets, on the
// public build or anywhere else (the same links exist on the phone and in ?demo's story).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

/** A file's code with its comments taken out (line comments, block comments, JSX comments). What's left is what can show. */
const shown = (src: string): string =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1")).join("\n");

const CLAIM = /\bprivate(ly)?\b|\bprivacy\b|\buntraceable\b|\bunlinkable\b|\banonymous(ly)?\b|can'?t be (traced|linked)/i;

test("P-1: no Trade text claims a move or a wallet is private", () => {
  const app = new URL("./", import.meta.url), screens = new URL("./screens/", import.meta.url), root = new URL("../", import.meta.url);
  const files = [
    ...readdirSync(screens).filter((f) => f.endsWith(".tsx")).map((f) => new URL(f, screens)),
    ...readdirSync(app).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts")).map((f) => new URL(f, app)),
    ...["trade-problems.ts", "float-view.ts", "move-words.ts", "float-jobs.ts", "errors.ts", "near/problems.ts", "near/engine.ts"].map((f) => new URL(f, root)),
  ];
  assert.ok(files.length > 30, `files read: ${files.length}`);
  for (const f of files) {
    const lines = shown(readFileSync(f, "utf8")).split("\n");
    lines.forEach((l, n) => assert.doesNotMatch(l, CLAIM, `${String(f).split("/src/")[1]}:${n + 1}: ${l.trim()}`));
  }
});

test("P-1: the words that replaced them say what's true", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  assert.match(read("./screens/ShortChain.tsx"), /It goes right away\./);
  assert.match(read("./job-cards.ts"), /"Waiting"/);
});

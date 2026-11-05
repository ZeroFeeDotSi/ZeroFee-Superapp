// Secrets by their shape, in what is about to be committed (audit NF-11): the staged lines being added, or a commit
// message (--file). It names the rule and where, never the matched text. A line holding a made-up example on purpose
// (a test vector) carries "zerofee-allow-secret-shape".
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const SHAPES = [
  ["an Anthropic API key", /sk-ant-[a-z0-9]+-[A-Za-z0-9_-]{80,}/],
  ["a URL with an api-key (Helius and the like)", /[?&](api[-_]?key|apikey)=[A-Za-z0-9-]{16,}/i],
  ["a CoinGecko key", /\bCG-[A-Za-z0-9]{20,}\b/],
  ["a JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["a private key (PEM)", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  // (A signature has the same shape, so only one named a private or secret key.)
  ["an ed25519 private key (NEAR)", /(private|secret)[A-Za-z_"' :=-]{0,24}ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/i],
  ["a 32-byte hex secret named as one", /(secret|private[_-]?key|seed)["'`\s:=]+(0x)?[0-9a-f]{64}\b/i],
];
const WORDS = new Set(wordlist);
/** Twelve or more backup words in a row (BIP-39's list), one space apart: the shape of a wallet's recovery words. */
function wordsRun(line) {
  for (const m of line.toLowerCase().matchAll(/[a-z]+(?: [a-z]+){11,}/g)) {
    let run = 0;
    for (const w of m[0].split(" ")) {
      run = WORDS.has(w) ? run + 1 : 0;
      if (run >= 12) return true;
    }
  }
  return false;
}

const at = process.argv.indexOf("--file");
const lines = at > 0
  ? readFileSync(process.argv[at + 1], "utf8").split("\n").filter((l) => !l.startsWith("#")).map((text, i) => ({ where: `the commit message, line ${i + 1}`, text }))
  : (() => {
      const out = [];
      let file = "";
      let n = 0;
      for (const l of execFileSync("git", ["diff", "--cached", "-U0", "--no-color"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n")) {
        if (l.startsWith("+++ ")) file = l.slice(6);
        else if (l.startsWith("@@")) n = Number(/\+(\d+)/.exec(l)?.[1] ?? 0);
        else if (l.startsWith("+")) out.push({ where: `${file}:${n++}`, text: l.slice(1) });
      }
      return out;
    })();

let found = 0;
for (const { where, text } of lines) {
  if (text.includes("zerofee-allow-secret-shape")) continue;
  for (const [what, re] of SHAPES) if (re.test(text)) (found++, console.log(`leak-guard: ${where} holds ${what}`));
  if (wordsRun(text)) (found++, console.log(`leak-guard: ${where} holds twelve or more backup words in a row`));
}
process.exit(found ? 1 : 0);

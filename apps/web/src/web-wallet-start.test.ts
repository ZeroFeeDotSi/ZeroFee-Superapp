// The web wallet (product decision, 4 Nov): the public site's real mode with NO Safe. Its start: words (made and checked, or
// typed), then a password, its one lock (no passkey, no iPhone), with the same 15-minute idle lock as any browser; the
// App then hands the words to the core, which makes the three wallets. Source checks, plus web-start.ts run for real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { wordsProblem } from "@zerofee/core/recovery-words";
import { keepWebWords, newWebWords, takeWebWords, typedWordsBack } from "./screens/web-start.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const fullApp = read("./full-app.tsx");
const gate = read("./unlock/UnlockGate.tsx");
const core = read("./core.ts");
const app = read("./App.tsx");

test("web wallet: the public site opens the real app (not the Sim) only for a browser that chose the web wallet", () => {
  assert.match(fullApp, /const SIM_SITE = import\.meta\.env\.VITE_ZEROFEE_PUBLIC === "1" && import\.meta\.env\.VITE_ZEROFEE_TARGET !== "extension" && !WEB_WALLET;/);
  assert.match(fullApp, /if \(WEB_WALLET\) \{[\s\S]*?return <UnlockGate web iphoneOnly=\{false\} intro=\{intro\}>\{app\}<\/UnlockGate>;/);
  assert.match(fullApp, /m\.keepWebWords\(words, made\), done\(false\)/, "the words wait in memory; the password comes next, never a passkey tap");
});

test("web wallet: a password is its one lock (never a passkey or the iPhone), and its words say password and wallet", () => {
  const begin = gate.slice(gate.indexOf("const begin = async"), gate.indexOf("useEffect(() => {\n    void begin();"));
  assert.ok(begin.indexOf('if (web) return setStep({ k: "new-code", legacy: s.legacy });') >= 0);
  assert.ok(begin.indexOf("if (web) return") < begin.indexOf("s.passkey ?"), "decided before any passkey path");
  const words = [...gate.slice(gate.indexOf("export const WEB_LOCK"), gate.indexOf("} as const;")).matchAll(/: "([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(words.length >= 10);
  for (const w of words) assert.doesNotMatch(w, /passcode|Safe|iPhone|chip/i, w);
});

test("web wallet: the idle lock (15 minutes, 5 out of sight, then reload) is the same for it as for any browser", () => {
  const idle = gate.slice(gate.indexOf("// Open: lock after 15 idle minutes"), gate.indexOf("const usePasskey"));
  assert.match(idle, /if \(step\.k !== "open"\) return;\n    const idle = new IdleLock\(Date\.now\(\)\);/);
  // the idle lock is Lock itself (lockNow: the vault forgets its key, a copied key is wiped, then the page reloads)
  assert.match(idle, /const timer = window\.setInterval\(\(\) => idle\.due\(Date\.now\(\)\) && lockNow\(\), 10_000\);/);
  assert.match(gate, /export function lockNow\(\): void \{\n  vaultSession\.lock\(\);\n(.*\n)*?    location\.reload\(\);\n  \}\);\n\}/);
  assert.doesNotMatch(idle, /\bweb\b/, "nothing in the idle lock depends on the web wallet");
});

test("web wallet: the core runs with the web door only in the web wallet; App makes the wallets from the words", () => {
  assert.match(core, /\.\.\.\(WEB_WALLET && !host \? \{ webWallet: \{ passwordOk: /);
  assert.match(app, /if \(WEB_WALLET && state\.stage === "none"\) \{\n      const kept = takeWebWords\(\);\n      return kept \? void webImport\(kept\.words, kept\.made\) : setView\(\{ k: "webStart" \}\);/);
  assert.match(app, /shellBridge\.call\("account\.web\.import", \{ words \}\)/);
  // no Safe reads and no Safe thread on its Home
  assert.match(app, /if \(!homeAccount \|\| WEB_WALLET\) return;\n    let live = true;\n    void shellBridge\.call<RecoveryStatus>\("recovery\.status"\)/);
  // its account rows instead (bug report, 5 Nov late; web-account-rows.test.ts), never the Safe's health or thread
  assert.match(app, /\.\.\.\(WEB_WALLET \? \{\n          webRows: \{[\s\S]*?\n        \} : \{\n        \/\/ S-2: the Safe's health check/);
});

test("web wallet: new words are 24 good ones, fresh each time; the waiting words are taken once", () => {
  const a = newWebWords();
  const b = newWebWords();
  assert.equal(a.length, 24);
  assert.equal(wordsProblem(a), null);
  assert.notDeepEqual(a, b);
  assert.equal(takeWebWords(), null);
  keepWebWords(a, true);
  assert.deepEqual(takeWebWords(), { words: a, made: true });
  assert.equal(takeWebWords(), null, "never handed out twice");
  keepWebWords(b);
  assert.deepEqual(takeWebWords(), { words: b, made: false }, "typed words: not a new wallet (it may hold money)");
});

// a web test, 4 Nov (item 6): "Your money, in one place … Set up now / Later" came after a Retry and again after the first
// unlock, never right after Agree.
test("web wallet: a wallet made here opens its first Home on set-up, right after Agree; typed words don't", () => {
  const start = app;
  assert.match(start, /if \(made\) setupStart = \{ id: "wallet", tab: "setup" \};\n      return route\(\);/);
  // Agree comes first (a new browser hasn't agreed), then reroute: the first Home takes the set-up start once
  const r = app.slice(app.indexOf("async function route("), app.indexOf("async function webImport("));
  assert.ok(r.indexOf('return setView({ k: "terms", next: { k: "reroute" } })') < r.indexOf("start: start ?? first"), "after Agree, not before");
  assert.match(r, /setView\(\{ k: "home", account: state\.account, start: start \?\? first \}\)/);
  assert.match(r, /const first = setupStart;\n      setupStart = undefined;/, "taken once");
  const ws = readFileSync(new URL("./screens/WebStart.tsx", import.meta.url), "utf8");
  assert.match(ws, /onDone=\{\(\) => onWords\(step\.words, true\)\}/, "Create my wallet: made here");
  assert.match(ws, /onWords\(words, false\);/, "I already have one: typed");
  // control: the old shape (no start after webImport) is gone
  assert.doesNotMatch(app, /if \("ok" in res\) return route\(\);\n  \}\n\n  \/\*\* New phone/);
});

test("web wallet: typed words say which word to fix, or that the set is wrong, before they go anywhere", () => {
  const good = newWebWords();
  assert.equal(typedWordsBack(good), null);
  assert.deepEqual(typedWordsBack(good.map((w, i) => (i === 6 ? "zzzz" : w))), { badWord: 7 });
  // a last word that breaks the words' own check (found, not guessed: one in 256 would still pass)
  const swaps = good.map((w) => [...good.slice(0, 23), w]).filter((ws) => wordsProblem(ws)?.kind === "checksum");
  assert.ok(swaps.length > 0);
  assert.deepEqual(typedWordsBack(swaps[0]!), { wrong: true });
  assert.deepEqual(typedWordsBack(good.slice(0, 12)), { wrong: true });
});

test("web wallet copy (Copywriter, 4 Nov): honest on the web path; the words can show again; it says wallet, never account", async () => {
  const onboarding = read("./screens/Onboarding.tsx");
  assert.match(read("./screens/WordCheck.tsx"), /\{!renew && <p className="zf-small">\{web \? WEB_SHOW_AGAIN : CANT_SHOW_AGAIN\}<\/p>\}/);
  assert.match(onboarding, /WEB_SHOW_AGAIN = "Your password can show them again later\."/);
  assert.match(read("./screens/Recovery.tsx"), /const bringBack = web \? "Bring back my wallet" : "Bring back my account";/);
  assert.match(read("./screens/WebStart.tsx"), /<RestoreWords\n        web\n/);
  assert.match(gate, /chooseBody: "It locks your wallet in this browser\. Don't use your 24 words\.",/);
  const { WEB_WORDS_COPY } = await import("./words-copy.ts");
  for (const line of [...WEB_WORDS_COPY.notes, ...WEB_WORDS_COPY.more]) assert.doesNotMatch(line, /never asks|nobody can|Safe/i, line);
});

test("web wallet in the public build: no passkey (WebAuthn) and no account contract ship; the words stay the same", async () => {
  const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(vite, /if \(publicBuild && target !== "extension" && \/\(\^\|\\\/\)passkey\(\\\.ts\)\?\$\/\.test\(source\)[^\n]*\) return noPasskey;/);
  assert.match(vite, /if \(publicBuild && target !== "extension" && \/account_policy\[\^\/\]\*\\\.wasm\\\?url\$\/\.test\(source\)\) return NO_POLICY;/);
  const none = read("./unlock/passkey-none.ts");
  assert.doesNotMatch(none.replace(/^\/\/.*$/gm, ""), /PublicKeyCredential|navigator\.credentials/);
  const real = await import("./unlock/passkey.ts");
  const stand = await import("./unlock/passkey-none.ts");
  for (const k of Object.keys(real)) assert.ok(k in stand, `passkey-none.ts lacks ${k}`);
  assert.equal(stand.IPHONE_KEY, real.IPHONE_KEY);
  assert.equal(await stand.passkeyAvailable(), false);
  assert.equal(await stand.createPasskey(), null);
});

test("web wallet's password (review): 12 at least, and no guess off the lists, padded or with look-alikes; the gate and the core both hold it", async () => {
  const { passwordRefusal, setUpPasscode, UnlockSession, WEB_PASSWORD_MIN } = await import("@zerofee/core/unlock");
  assert.equal(WEB_PASSWORD_MIN, 12);
  for (const bad of ["short1234ab", "123456789012", "abcdefghijkl", "aaaaaaaaaaaa", "password1234", "P@ssw0rd2024!", "qwerty123456", "Qwertyuiop12", "iloveyou!!!!", "dragondragon", "zerofee12345", "Bitcoin2024!!", "ab12ab12ab12"]) {
    assert.notEqual(passwordRefusal(bad), null, bad);
  }
  for (const good of ["correct horse battery", "plum tiger cloud seven", "mXq9-vR2t-Lz8w"]) assert.equal(passwordRefusal(good), null, good);
  for (const line of [passwordRefusal("short"), passwordRefusal("123456789012"), passwordRefusal("password1234")]) assert.doesNotMatch(line!, /passcode/i, line!);
  // Copy batch 3: each refusal says its own reason; "quick to guess" only where it is a guess
  assert.equal(passwordRefusal("123456789012"), "Add letters too. Numbers alone are quick to guess.");
  assert.equal(passwordRefusal("password1234"), "That one is quick to guess. Try four words.");
  assert.equal(passwordRefusal("92869268x#q2"), "Use at least 4 letters.", "fewer than 4 letters is not a guess");
  assert.match(gate, /const refusal = web \? passwordRefusal\(code\) : passcodeRefusal\(code\);/);
  assert.match(gate, /await lockWithPasscode\(device, vaultSession, code, web \? passwordRefusal : undefined\);/);
  await assert.rejects(setUpPasscode(new UnlockSession(), "password1234", passwordRefusal), /guess/, "the core refuses it too, not only the screen");
});

test("web wallet: words kept by the start (web-start.ts, loaded later) are the ones the App takes (web-words-held.ts, in Home's first load): one module, one memory (control: a second take is empty)", async () => {
  const held = await import("./screens/web-words-held.ts");
  assert.equal(held.keepWebWords, keepWebWords, "web-start.ts hands on the held module's own keep, never a copy");
  assert.equal(held.takeWebWords, takeWebWords);
  const words = newWebWords();
  keepWebWords(words, true);
  assert.deepEqual(held.takeWebWords(), { words, made: true }, "kept across the lazy boundary, taken where the App takes them");
  assert.equal(takeWebWords(), null, "control: once only, from either side");
  assert.match(app, /import \{ WEB_START, takeWebWords \} from "\.\/screens\/web-words-held\.ts";/);
  assert.match(read("./screens/web-start.ts"), /export \{ WEB_START, keepWebWords, takeWebWords \} from "\.\/web-words-held\.ts";/);
  assert.doesNotMatch(read("./screens/web-start.ts"), /let waiting/, "the held words live in one place");
});

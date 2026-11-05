// D29 §B: the only two scripts ZeroFee puts into a partner page are pinned by SHA-256 in Swift. These checks fail
// when a script changes without its pin (and the other way round), and when a script reaches for eval-like code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PROVIDER_SHA256 } from "../../../../packages/browser/src/provider/pin.ts";

const root = new URL("../../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const swift = read("apps/ios/ZeroFee/PartnerScripts.swift").toString("utf8");
const pin = (name: string) => swift.match(new RegExp(`static let ${name} = "([0-9a-f]{64})"`))?.[1];

test("provider.js: its bytes, pin.ts and the Swift pin agree", () => {
  const got = sha(read("packages/browser/src/provider/provider.js"));
  assert.equal(PROVIDER_SHA256, got);
  assert.equal(pin("providerPin"), got);
});

test("robot.js: its bytes and the Swift pin agree", () => {
  assert.equal(pin("robotPin"), sha(read("apps/ios/ZeroFee/PartnerScripts/zf-partner-robot.js")));
});

test("zf-site-signin.js: its bytes and the Swift pin agree; it taps only on its exact hosts, never a word on its never-list", () => {
  const src = read("apps/ios/ZeroFee/PartnerScripts/zf-site-signin.js").toString("utf8");
  assert.equal(pin("signInPin"), sha(read("apps/ios/ZeroFee/PartnerScripts/zf-site-signin.js")));
  const hosts = [...src.matchAll(/^\s*"([a-z0-9.-]+)": \[\[/gm)].map((m) => m[1]);
  assert.deepEqual(hosts, ["gmgn.ai", "pump.fun"]);
  const never = /\b(buy|sell|trade|swap|send|withdraw|deposit|confirm|approve|pay|bet|stake|transfer|export|delete|sign out|log ?out|disconnect)\b/i;
  for (const [, words] of src.matchAll(/\["([^"]+)", \d+/g)) assert.doesNotMatch(words!, never, words);
  // review B (M3): each step has its place (the tab bar, the header, the dialog or the page), and the clicked element is
  // checked again (its words, its label, a link on this site only) and must be on top
  for (const [, , where] of src.matchAll(/\["([^"]+)", \d+, "([a-z]+)"/g)) assert.ok(["bottom", "top", "banner", "dialog", "page"].includes(where!), where);
  // ST4: a step's `how` is only "prefix", "after" or both; and a site's terms (pump.fun's "Continue": agreeing to its
  // terms and to being 18 or over) are the person's own tap, never a step
  for (const [, how] of src.matchAll(/\["[^"]+", \d+, "[a-z]+", "([a-z ]+)"\]/g)) assert.ok(["prefix", "after", "prefix after", "retry"].includes(how!), how);
  for (const [, words] of src.matchAll(/\["([^"]+)", \d+/g)) assert.doesNotMatch(words!, /^(continue|i agree|agree|accept|accept all|i'm 18|got it)$/i, `${words}: the person's own yes`);
  assert.match(src, /"pump\.fun": \[\["Sign in", 60000, "top", "retry"\], \["ZeroFee", 6000, "dialog", "prefix after"\], \["Skip", 8000, "dialog", "after"\], \["Reject all", 4000, "banner", "after"\]\]/);
  assert.match(src, /"gmgn\.ai": \[\["Portfolio", 6000, "bottom"\], \["Log in", 2500, "page", "retry"\], \["Connect with extension wallet", 4000, "dialog", "retry"\], \["ZeroFee", 4000, "dialog", "prefix"\]\]/);
  // review ST4b (M3): an "after" step taps only a real control, never a box of words
  assert.match(src, /controlOnly && !t\.matches\(CONTROL\)/);
  assert.match(src, /const target = \(el, want, prefix\)/);
  assert.match(src, /elementFromPoint/);
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ""), /new URL\(/, "the page's own URL is never trusted");
  assert.match(src, /const NEVER = \/\\b\(buy\|sell\|trade/, "the never-list is in the script itself");
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ""), /fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie|\.value\b|postMessage|webkit/, "it reads nothing and sends nothing");
});

test("a sign-in tap that changed nothing: tapped once more, then the window's own line; never a loop (auditor, 2 Nov)", () => {
  const src = read("apps/ios/ZeroFee/PartnerScripts/zf-site-signin.js").toString("utf8");
  const rules = read("apps/ios/ZeroFee/HostRules.swift").toString("utf8");
  const view = read("apps/ios/ZeroFee/PartnerView.swift").toString("utf8");
  // every "retry" step (host, its place in the recipe) has a compiled line in WalletGate.stepStuckLine, and nothing else does
  const retry: string[] = [];
  for (const [, host, body] of src.matchAll(/^\s*"([a-z0-9.-]+)": (\[\[.*\]\]),$/gm)) {
    (JSON.parse(body!) as string[][]).forEach((step, i) => { if ((step[3] ?? "").includes("retry")) retry.push(`${host}#${i}`); });
  }
  const lines = [...rules.matchAll(/case \("([a-z0-9.-]+)", (\d+)\): return "([^"]+)"/g)].map((m) => `${m[1]}#${m[2]}`);
  assert.deepEqual(lines.sort(), retry.sort());
  assert.deepEqual(retry.sort(), ["gmgn.ai#1", "gmgn.ai#2", "pump.fun#0"]);
  for (const [, , , line] of rules.matchAll(/case \("([a-z0-9.-]+)", (\d+)\): return "([^"]+)"/g)) assert.match(line!, /^\S+ didn't open its .+\. Tap .+ yourself\.$/);
  // at most two taps on a retry step: one, a second only when the first changed nothing, then the mark and the end
  const loop = src.slice(src.indexOf("const run = async () => {"), src.indexOf("// Signed out later:"));
  assert.equal((loop.match(/tap\((el|again)\);/g) ?? []).length, 2);
  assert.match(loop, /window\.__zfSignInStuck = i;\s*return;/);
  // the mark is a number the host reads from the steps' own world; the world still has no handler
  // review retry L2: a number or -1 (a page element's id is a window property in every world); L1: only on the host the
  // window opened; L3: a second tap only on the same control or its redraw in the same place
  assert.match(view, /evaluateJavaScript\("typeof window\.__zfSignInStuck === \\"number\\" \? window\.__zfSignInStuck : -1", in: nil, in: PartnerScripts\.signInWorld\)/);
  assert.match(view, /let n = v as\? NSNumber, host == Self\.displayHost\(self\.startURL\), let line = WalletGate\.stepStuckLine\(host: host, step: n\.intValue\)/);
  assert.match(src, /if \(window\.__zfSignInRan === true\) return;/);
  assert.match(loop, /if \(again !== el && \(el\.isConnected \|\| /);
  assert.doesNotMatch(view + rules, /addScriptMessageHandler\([^)]*signInWorld/);
  // product decision, 3 Nov, never a dead end after a sign-out: the same steps again by themselves, only with no dialog open, at most
  // 3 times per page, 8 s apart; then one flag the host reads (reload once, then its line)
  assert.match(src, /const SIGNED_OUT = \{ "gmgn\.ai": \["Log in", "page"\], "pump\.fun": \["Sign in", "top"\] \};/);
  assert.match(src, /dialogsOpen\(\) === 0 && Boolean\(find\(out\[0\], out\[1\], false, true\)\)/);
  assert.match(src, /if \(again >= 3\) \{\s*window\.__zfSignedOut = true;\s*return;/);
  assert.match(src, /Date\.now\(\) - lastRun > 8000/);
  assert.match(view, /evaluateJavaScript\("window\.__zfSignedOut === true", in: nil, in: PartnerScripts\.signInWorld\)/);
  // L4: the window watches at least as long as the slowest retry step can take (its wait, two tries of 2.5 s, a second)
  const watch = Number(/static let stepWatchFor: TimeInterval = (\d+)/.exec(rules)![1]);
  for (const [, host, body] of src.matchAll(/^\s*"([a-z0-9.-]+)": (\[\[.*\]\]),$/gm)) {
    for (const step of JSON.parse(body!) as [string, number, string, string?][]) if ((step[3] ?? "").includes("retry")) assert.ok(watch * 1000 >= step[1] + 2 * 2620 + 1000, `${host} ${step[0]}`);
  }
});

test("a changed byte would not match its pin (the control)", () => {
  const b = Buffer.from(read("apps/ios/ZeroFee/PartnerScripts/zf-partner-robot.js"));
  b[b.length - 2] ^= 1;
  assert.notEqual(sha(b), pin("robotPin"));
});

test("neither script uses eval, new Function or a string timer, and robot.js never reads a field's value out", () => {
  for (const p of ["packages/browser/src/provider/provider.js", "apps/ios/ZeroFee/PartnerScripts/zf-partner-robot.js", "apps/ios/ZeroFee/PartnerScripts/zf-site-signin.js"]) {
    const code = read(p).toString("utf8").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\beval\s*\(|new\s+Function|Function\s*\(|setTimeout\s*\(\s*["'`]|setInterval\s*\(\s*["'`]|import\s*\(/, p);
  }
  const robot = read("apps/ios/ZeroFee/PartnerScripts/zf-partner-robot.js").toString("utf8");
  // .value appears only to test emptiness, to set a fill, and for a button's own caption.
  const uses = robot.split("\n").filter((l) => /\.value\b/.test(l) && !/^\s*\/\//.test(l)).map((l) => l.trim());
  for (const l of uses) assert.match(l, /String\(el\.value \|\| ""\)\.length > 0|\.value\.toLowerCase\(\) === want|clip\(el\.value \|\| el\.type, 60\)|a\.value = null|setValue\(el, String\(a\.value\)\)|getOwnPropertyDescriptor\(proto, "value"\)/, l);
});

test("robot.js runs in its own world: the Swift side adds it and its handler to 'zf-robot' only", () => {
  assert.match(swift, /WKContentWorld\.world\(name: "zf-robot"\)/);
  assert.match(swift, /forMainFrameOnly: true, in: robotWorld/);
  const robot = read("apps/ios/ZeroFee/PartnerRobot.swift").toString("utf8");
  assert.match(robot, /ucc\.addScriptMessageHandler\(self, contentWorld: PartnerScripts\.robotWorld, name: "zfRobot"\)/);
  assert.match(robot, /removeAllScriptMessageHandlers\(from: PartnerScripts\.robotWorld\)/);
});

test("robot.js acts only in the document the host checked (audit IOS-7): another host, or http, types nothing", async () => {
  const { runInNewContext } = await import("node:vm");
  const run = async (location: { protocol: string; host: string }, mustBeHost: unknown) => {
    const asked: unknown[] = [];
    const window = { webkit: { messageHandlers: { zfRobot: { postMessage: async (m: unknown) => (asked.push(m), "go") } } } };
    const sandbox: Record<string, unknown> = { window, location };
    sandbox.globalThis = sandbox;
    runInNewContext(read("apps/ios/ZeroFee/PartnerScripts/zf-partner-robot.js").toString("utf8"), sandbox);
    const a = { kind: "fill", target: "1", value: "the password", mustBeHost };
    const r = await (sandbox.__zfRobot as { act: (a: unknown) => Promise<unknown> }).act(a);
    // Objects from the script's own realm: compared as plain data.
    return JSON.parse(JSON.stringify({ r, asked: asked.filter((m) => (m as { kind: string }).kind === "may-act").length, value: a.value }));
  };
  for (const [loc, must] of [[{ protocol: "https:", host: "evil.example" }, "partner.example"], [{ protocol: "http:", host: "partner.example" }, "partner.example"], [{ protocol: "https:", host: "partner.example" }, undefined]] as const) {
    assert.deepEqual(await run(loc, must), { r: { error: "wrong-page" }, asked: 0, value: null }, JSON.stringify(loc));
  }
  // The page the host checked: past this check (no element known yet, so "unknown"), and the gate was asked.
  assert.deepEqual(await run({ protocol: "https:", host: "partner.example" }, "partner.example"), { r: { error: "unknown" }, asked: 1, value: "the password" });
});

test("zf-seed-guard.js (product decision, 3 Nov): its pin, its own world in every frame, one word out, and the same matcher as SeedGuard", async () => {
  const file = "apps/ios/ZeroFee/PartnerScripts/zf-seed-guard.js";
  const src = read(file).toString("utf8");
  assert.equal(pin("seedGuardPin"), sha(read(file)));
  assert.match(swift, /static let seedGuardWorld = WKContentWorld\.world\(name: "zf-seedguard"\)/);
  assert.match(swift, /WKUserScript\(source: \$0, injectionTime: \.atDocumentEnd, forMainFrameOnly: false, in: seedGuardWorld\)/, "every frame, its own world");
  const view = read("apps/ios/ZeroFee/PartnerView.swift").toString("utf8");
  const guard = read("apps/ios/ZeroFee/PartnerSeedGuard.swift").toString("utf8");
  // its handler is added for its own world only, and it is never a reply handler (the page gets nothing back)
  assert.match(view, /\.add\(SeedGuardHandler\(view: self\), contentWorld: PartnerScripts\.seedGuardWorld, name: SeedGuard\.handler\)/);
  assert.doesNotMatch(view, /addScriptMessageHandler\([^)]*seedGuardWorld|contentWorld: \.page, name: SeedGuard\.handler/);
  assert.match(guard, /static let handler = "zfSeedGuard"/);
  assert.match(src, /window\.webkit\.messageHandlers\.zfSeedGuard;/);
  // every window gets it (put back after the provider's remove-all)
  assert.match(view, /let seedGuard = PartnerScripts\.seedGuardScript\(\)\n\s*if let seedGuard \{ always\.append\(seedGuard\) \}/);
  assert.match(view, /func removeUserScripts\(\) \{\n\s*let ucc = web\.configuration\.userContentController\n\s*ucc\.removeAllUserScripts\(\)\n\s*alwaysScripts\.forEach\(ucc\.addUserScript\)/);
  // the only other remove-all is the window's end
  const robot = read("apps/ios/ZeroFee/PartnerRobot.swift").toString("utf8");
  assert.equal((view.match(/removeAllUserScripts\(\)/g) ?? []).length, 2);
  assert.doesNotMatch(robot, /removeAllUserScripts\(\)/);
  assert.match(view, /func endModes\(\) \{[\s\S]*?ucc\.removeAllUserScripts\(\)\n  \}/);
  // one word out: the only post is tell(kind), and tell is only ever called with "words" or "faceid"
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  assert.equal((code.match(/postMessage\(/g) ?? []).length, 1);
  assert.match(code, /gate\.postMessage\(kind\)/);
  const tells = [...code.matchAll(/tell\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tells)].sort(), ['"faceid"', '"words"']);
  // it reads no value, keeps nothing and sends nothing else
  assert.doesNotMatch(code, /\.value\b|fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|document\.cookie|sendBeacon|eval\(|new Function/);
  // at most one check per 500 ms, and it stops at its first find
  assert.match(code, /setTimeout\(check, Math\.max\(0, 500 - \(Date\.now\(\) - last\)\)\)/);
  assert.match(code, /done = true;\s*if \(watch\) watch\.disconnect\(\);/);
  // the same lists as the Swift rules
  const list = (s: string, re: RegExp) => JSON.parse(s.match(re)![1]!) as string[];
  const swiftPhrases = guard.match(/static let phrases = """\n([\s\S]*?)\n\s*"""/)![1]!.split("\n").map((l) => l.trim());
  assert.deepEqual(list(src, /const PHRASES = (\[.*\]);/), swiftPhrases);
  assert.deepEqual(list(src, /const FACE = (\[.*\]);/), list(guard, /static let faceID = (\[.*\])\n/));
  // the script's own matcher on the Mac check's cases (apps/ios/check/partner.swift)
  const { runInNewContext } = await import("node:vm");
  const matcher = src.slice(src.indexOf("// matcher:start"), src.indexOf("// matcher:end"));
  const m = runInNewContext(`${matcher}; ({ asks: (t) => ASKS.test(norm(t)), face: (t) => FACE_ID.test(norm(t)) })`) as { asks: (t: string) => boolean; face: (t: string) => boolean };
  for (const t of ["Enter your 12-word seed phrase to restore", "Secret Recovery Phrase", "Import with private key", "Type your 24 words below", "BACKUP WORDS", "Your mnemonic", "Enter your passcode", "Enter your words", "12 word phrase", "Recovery phrase", "seed-phrase", "Paste your private keys", "24–word"]) assert.ok(m.asks(t), t);
  for (const t of ["Read our privacy policy", "24 hours", "Word of the day", "112 words left", "Private keyboard shortcuts", "Seed phrasebook", "Recover your account by email", "Keyboard", "Wordle", "Back up your photos", ""]) assert.ok(!m.asks(t), `control: ${t}`);
  assert.ok(m.face("Confirm with Face ID to continue") && !m.face("Interface identification"));
});

// D122: the AgentZero chat is the phone build's tab (VITE_AGENTZERO_CHAT=1 in apps/ios/build-web.sh) and never in the
// public web demo. The public build drops its code only while the flags are read in the inline form Vite replaces at
// build time (an alias such as `const ENV = import.meta.env` kept 4 chat files in the public build, 3 Nov). Measured with
// real builds: VITE_ZEROFEE_PUBLIC=1, with and without VITE_AGENTZERO_CHAT=1: 0 files name the chat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the public build shows AgentZero (product decision, 3 Nov) as the sample-money demo's chat: the real chat, its relay turn and every key path are left out, read inline", () => {
  const src = readFileSync(new URL("../apps.ts", import.meta.url), "utf8");
  const line = src.split("\n").find((l) => l.startsWith("const AZ_CHAT ="));
  assert.ok(line, "AZ_CHAT is one line");
  assert.match(line!, /^const AZ_CHAT = import\.meta\.env\?\.VITE_ZEROFEE_PUBLIC === "1" \|\| /, "public: the chat is the tab");
  assert.match(line!, /import\.meta\.env\?\.VITE_AGENTZERO_CHAT === "1"/);
  assert.doesNotMatch(src, /const ENV = /, "no alias of import.meta.env (Vite can't replace it)");
  // the real account's chat is behind the inline public flag (the public site is the sample demo only, main.tsx)
  const app = readFileSync(new URL("./AgentZeroChatApp.tsx", import.meta.url), "utf8");
  // the public site leaves it out; D157: the Chrome extension (a real account's home, D152 in) keeps it
  // W7 (product decision, 5 Nov): the web wallet is a real account's home, so the public build keeps the live chat; the public
  // build's Real mode (no web wallet, not the extension) still says one plain line
  assert.match(app, /const LiveChat = lazy\(\(\) => import\("\.\/LiveChat\.tsx"\)/);
  assert.match(app, /const liveHere = \(\): boolean => import\.meta\.env\?\.VITE_ZEROFEE_PUBLIC !== "1" \|\| import\.meta\.env\?\.VITE_ZEROFEE_TARGET === "extension" \|\| webWallet\(\);/);
  assert.match(app, /\{SAMPLE \? <Suspense fallback=\{<p className="zf-small azc-note">Opening…<\/p>\}><SimChat shown=\{chatShown\} \{\.\.\.m\} \/><\/Suspense> : !liveHere\(\) \? <WebSoon \/> :/);
  assert.match(app, /AZ_WEB_SOON = "AgentZero opens on the web soon\. It works on the ZeroFee iPhone app today\."/);
  // the own-key reading path of Jobs and limits (rulebox readJob) is inline-gated too, so the SDK is never in the build
  const rule = readFileSync(new URL("../../../../packages/agent/src/zero/rulebox.ts", import.meta.url), "utf8");
  assert.match(rule, /const own = import\.meta\.env\?\.VITE_AGENTZERO_OWN_KEY === "1" && import\.meta\.env\?\.VITE_ZEROFEE_PUBLIC !== "1" \? o\.ownKey\?\.trim\(\) \|\| null : null;/);
  // deploy-app.sh keeps refusing the key path's marks in the public bundle, and now requires AgentZero's chat in it
  const sh = readFileSync(new URL("../../deploy-app.sh", import.meta.url), "utf8");
  assert.match(sh, /for gone in "x-api-key" [^;]*"api\.anthropic\.com"/);
  assert.match(sh, /grep -rqF -- "Ask me about your money, or give me a job\." "\$dist\/assets"/, "AgentZero's chat is in the public build");
});

test("the phone build turns the chat on, and only the phone build", () => {
  const sh = readFileSync(new URL("../../../ios/build-web.sh", import.meta.url), "utf8");
  assert.match(sh, /VITE_AGENTZERO_CHAT=1 VITE_ZEROFEE_RELAY="\$RELAY" npm run -w @zerofee\/web build/);
  for (const f of ["../../deploy-app.sh", "../../package.json"]) {
    try { assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /VITE_AGENTZERO_CHAT/, f); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
});

test("the chat's own-key code is behind inline public flags and the relay path reads its stream by hand: lifting the LiveChat gate adds no SDK, no key header, no Anthropic address to the public build", () => {
  const dir = "../../../../packages/agent/src/chat/";
  const turn = readFileSync(new URL(`${dir}turn.ts`, import.meta.url), "utf8");
  const key = readFileSync(new URL(`${dir}ai-key.ts`, import.meta.url), "utf8");
  const gate = /import\.meta\.env\?\.VITE_ZEROFEE_PUBLIC (?:!==|===) "1"/;
  // the only way into the SDK's code is a dynamic import written after the inline flag (never a static import)
  assert.doesNotMatch(turn, /^import (?!type)[^;]*(?:own-claude|anthropic-check|@anthropic-ai)/m, "turn.ts never statically imports the key path");
  assert.doesNotMatch(turn, /@anthropic-ai\/sdk\/lib\/MessageStream/, "the relay's stream is read by relay-stream.ts, not the SDK's MessageStream");
  // 7 Nov (audit): the own-key path is in a developer build only (VITE_AGENTZERO_OWN_KEY=1, never public), or a node test
  // (no import.meta.env, so no MODE); the phone's and the Sim's bundles no longer carry own-claude.ts (tools/bundle-grep.sh)
  const ownGate = 'import.meta.env?.MODE === undefined || (import.meta.env?.VITE_AGENTZERO_OWN_KEY === "1" && import.meta.env?.VITE_ZEROFEE_PUBLIC !== "1")';
  assert.ok(turn.includes(`if (${ownGate}) return (ownLoaded ??= await import("./own-claude.ts"));`), "ownClaude: the import behind the inline gate");
  assert.ok(turn.includes(`const own = ${ownGate} ? o.ownKey?.trim() || null : null;`), "chatTurn: a key is used only behind the same gate");
  assert.doesNotMatch(key, /^import (?!type)[^;]*(?:anthropic-check|claude\.ts)/m, "ai-key.ts never statically imports Anthropic's address or the key check");
  assert.match(key, /VITE_ZEROFEE_PUBLIC === "1"\) return \{ ok: false, line: KEY_LINE\.unavailable \};\n.*await import\("\.\/anthropic-check\.ts"\)/);
  assert.match(key, gate);
  // the strings themselves live only in the two files the flags load
  for (const f of ["turn.ts", "ai-key.ts", "relay-stream.ts", "use-chat-turn.ts"]) {
    const src = readFileSync(new URL(`${dir}${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""), /x-api-key|api\.anthropic\.com/, f);
  }
});

// A-4 Siri and Shortcuts: an intent only opens and fills in (never a ledger call, a signature or a send), and Siri's own
// words never carry an amount or an address. Each rule with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAYEE_UNKNOWN, payeeLink, readIntent, routeIntent, takeIntent } from "./intent.ts";

const SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const EVM = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const BTC = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("what Swift hands over is read again: words cleaned and capped, anything else nothing", () => {
  assert.deepEqual(readIntent({ kind: "ask", words: "  what did I spend\nthis week  " }), { kind: "ask", words: "what did I spend this week" });
  assert.equal((readIntent({ kind: "ask", words: "a".repeat(900) }) as { words: string }).words.length, 500);
  assert.deepEqual(readIntent({ kind: "send", to: "kim.near" }), { kind: "send", to: "kim.near" });
  assert.deepEqual(readIntent({ kind: "send", to: "two words" }), { kind: "send" }, "not one payee: Send opens empty");
  assert.deepEqual(readIntent({ kind: "send" }), { kind: "send" });
  // controls
  for (const bad of [null, {}, { kind: "ask" }, { kind: "ask", words: "   " }, { kind: "pay", to: "kim.near" }, "ask", { kind: "send", to: 5 }]) {
    const r = readIntent(bad);
    assert.ok(r === null || (r.kind === "send" && !("to" in r)), JSON.stringify(bad));
  }
});

test("D111: a payee on any chain fills Send in; an EVM address with no network lets Send ask which", () => {
  assert.equal(payeeLink("Kim.Near"), "zerofee:send?v=1&to=kim.near&chain=near");
  assert.equal(payeeLink(SOL), `zerofee:send?v=1&to=${SOL}&chain=sol`);
  assert.equal(payeeLink(BTC), `zerofee:send?v=1&to=${BTC}&chain=btc`, "Send itself says it can't send there yet");
  assert.equal(payeeLink(EVM), EVM, "Send asks the network (H-5)");
  // controls
  assert.equal(payeeLink("hello"), null);
  assert.equal(payeeLink(EVM.replace("a", "A")), null, "a mistyped capital");
  assert.deepEqual(routeIntent({ kind: "send", to: "hello" }), { problem: PAYEE_UNKNOWN });
  assert.equal(PAYEE_UNKNOWN.money.state, "not-involved");
});

test("an intent only ever opens AgentZero's field or Wallet's Send: never an amount, a ledger call or a send", () => {
  assert.deepEqual(routeIntent({ kind: "ask", words: "sell half my WIF" }), { open: { id: "agent", tab: "ask", link: "sell half my WIF" } });
  assert.deepEqual(routeIntent({ kind: "send", to: SOL }), { money: { kind: "send", link: `zerofee:send?v=1&to=${SOL}&chain=sol` } });
  assert.deepEqual(routeIntent({ kind: "send" }), { money: { kind: "send" } });
  const sol = routeIntent({ kind: "send", to: SOL });
  assert.doesNotMatch("money" in sol ? String(sol.money.kind === "send" ? sol.money.link : "") : "", /amount=/, "Siri never sets how much");
  const NEVER = /"(ledger|tx|subwallet|spending|approval|key|vault)\.[a-zA-Z.]+"|device\.confirm|\.sign\(/;
  assert.doesNotMatch(src("./intent.ts"), NEVER);
  const host = src("../shell/AppHost.tsx");
  const block = host.slice(host.indexOf("// A-4: Siri"), host.indexOf("const current = apps[index];"));
  assert.doesNotMatch(block, NEVER);
  const taker = src("./intent.ts").slice(src("./intent.ts").indexOf("export async function takeIntent"));
  assert.deepEqual([...taker.matchAll(/api\.current\.(\w+)\(/g)].map((m) => m[1]).sort(), ["openApp", "openMoney", "showProblem"]);
  assert.match(block, /m\.takeIntent\(host, api, indexRef\)/);
  assert.match(block, /import\("\.\.\/host\/intent\.ts"\)/, "the reader loads after the paint, never in Home's first load");
  assert.doesNotMatch(host, /^import [^;]*host\/intent/m, "control: never a static import");
  // AgentZero puts the words in its field and nothing more: the person taps Send
  const chat = src("../agentzero/AgentZeroChat.tsx");
  const fill = chat.slice(chat.indexOf("// A-4:"), chat.indexOf("}, [requestSeq]);"));
  assert.match(fill, /setWords\(/);
  assert.doesNotMatch(fill, /send\(|chat\.send/);
  // control: the patterns catch what they guard against
  assert.match('void bridge.call("ledger.transfer", x)', NEVER);
  assert.match("chat.send(words)", /send\(|chat\.send/);
});

/** What Siri may say or show for ZeroFee: every quoted string in Intents.swift. */
const swift = readFileSync(new URL("../../../ios/ZeroFee/Intents.swift", import.meta.url), "utf8");
const said = [...swift.matchAll(/(?:IntentDialog|LocalizedStringResource|IntentDescription|title:|phrases: \[|shortTitle:)\s*\(?"([^"]*)"/g)].map((m) => m[1]!)
  .concat([...swift.matchAll(/"([^"]*\\\(\.applicationName\)[^"]*)"/g)].map((m) => m[1]!));
const MONEY = /\$\s?\d|\d+(\.\d+)?\s?(USD[CT]?|SOL|ETH|NEAR|BNB|BTC|dollars?)\b|0x[0-9a-fA-F]{6,}|[1-9A-HJ-NP-Za-km-z]{32,44}|\b[a-z0-9_-]+\.(near|testnet)\b/i;

test("Siri never speaks an amount or an address: every dialog, title and phrase is plain words", () => {
  assert.ok(said.length >= 8, `read ${said.length} strings`);
  for (const s of said) assert.doesNotMatch(s, MONEY, s);
  assert.match(swift, /static let openAppWhenRun = true[\s\S]*static let openAppWhenRun = true/, "both open the app: nothing runs unseen");
  const code = swift.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("/**")).join("\n");
  assert.doesNotMatch(code, /ledger|subwallet|tx\.request|sign\(|Keychain|vault/i, "the intents touch no money and no key");
  assert.match("host.call(\"ledger.transfer\")", /ledger/, "control");
  // controls: a planted amount or address fails the check
  for (const planted of ["Sent $10 to Kim", "Pay 12.50 USDC?", `Paying ${EVM}`, "Pay kim.near", `To ${SOL}`]) assert.match(planted, MONEY, planted);
});

test("takeIntent: one take, then only the shell's three doors; nothing when the phone holds nothing", async () => {
  const seen: string[] = [];
  const doors = { current: { openApp: (id: string) => void seen.push(`open ${id}`), openMoney: (_at: number, a: { kind: string }) => void seen.push(`money ${a.kind}`), showProblem: () => void seen.push("problem") } };
  const phone = (held: unknown) => ({ calls: [] as string[], async call<T>(m: string) { this.calls.push(m); return { ok: held as T }; } });
  const a = phone({ kind: "ask", words: "hi" });
  await takeIntent(a, doors, { current: 0 });
  const s = phone({ kind: "send", to: SOL });
  await takeIntent(s, doors, { current: 0 });
  const u = phone({ kind: "send", to: "hello" });
  await takeIntent(u, doors, { current: 0 });
  const none = phone({});
  await takeIntent(none, doors, { current: 0 });
  assert.deepEqual(seen, ["open agent", "money send", "problem"]);
  for (const p of [a, s, u, none]) assert.deepEqual(p.calls, ["shell.intent.take"], "the phone is asked once and only that");
});

test("review M: an intent never replaces a money sheet, a Problem or a Waiting screen already up; it waits on the phone", () => {
  const host = src("../shell/AppHost.tsx");
  const block = host.slice(host.indexOf("// A-4: Siri"), host.indexOf("const current = apps[index];"));
  assert.match(block, /blocked\.current \|\| moneyUp\.current \|\| import\(/, "taken only when nothing is up");
  assert.match(host, /moneyUp\.current = money !== null;\s*useEffect\(\(\) => intentTake\.current\(\), \[blocked\.current, moneyUp\.current\]\);/, "taken when they close");
  // Swift drops an ask not taken within 2 minutes, and both intents need an unlocked phone (review L1, L2)
  assert.match(swift, /keepSeconds: TimeInterval = 120/);
  assert.equal(swift.match(/authenticationPolicy: IntentAuthenticationPolicy = \.requiresAuthentication/g)?.length, 2);
  // control
  assert.doesNotMatch("const take = () => void import(x)", /blocked\.current \|\| moneyUp\.current \|\| import\(/);
});

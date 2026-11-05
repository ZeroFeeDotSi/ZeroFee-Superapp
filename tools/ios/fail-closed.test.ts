// The phone's isolated core fails CLOSED (Security, 28 Oct, the outside study's item 1): a core that didn't start never
// hands the chip key, the core's vault or a core of its own to the page. And every core method that takes a `site` gets
// it from WebKit on the Swift side, never from the page (M1: subwallet.sign was missing). Swift has no test target here,
// so these read the Swift source; the debug probe checks the same on a simulator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
const isolated = read("apps/ios/ZeroFee/IsolatedCore.swift");
const host = read("apps/ios/ZeroFee/Host.swift");
const core = read("packages/core/src/demo-core.ts");

/** The body of a Swift func, from its signature to the next line that closes it at that indent. */
function swiftFunc(src: string, signature: string): string {
  const at = src.indexOf(signature);
  assert.ok(at >= 0, `${signature} not found`);
  const indent = src.slice(src.lastIndexOf("\n", at) + 1, at);
  const end = src.indexOf(`\n${indent}}`, at);
  return src.slice(at, end);
}

test("the page is told \"isolated\" whenever the switch is on, never only when the core started", () => {
  assert.match(host, /coreModeScript\(isolated: Self\.isolatedCoreWanted\)/);
  assert.doesNotMatch(host, /coreModeScript\(isolated: isolatedCore != nil\)/);
});

test("pageMayUse closes key.* and every vault on the switch, not on whether the core started", () => {
  const body = swiftFunc(isolated, "func pageMayUse(");
  assert.match(body, /guard Self\.isolatedCoreWanted else \{ return true \}/);
  assert.doesNotMatch(body, /isolatedCore != nil/);
  assert.match(body, /if method\.hasPrefix\("key\."\) \{ return false \}/);
  // No vault for the page at all: the guardian's and the Kids parent's second devices run in the core (audit IOS-4).
  assert.match(body, /if method\.hasPrefix\("vault\."\) \{ return false \}/);
});

test("a core that didn't start answers one Problem, and no log says the page's core runs", () => {
  // D134: the core starts off the main thread, so a call waits for it; a core that didn't start is nil there, the same Problem
  assert.match(swiftFunc(isolated, "func callIsolatedCore("), /guard let core = await coreWhenStarted\(\) else \{ return problem\("security\.core\.not-ready", Self\.coreNotRunning\) \}/);
  assert.doesNotMatch(isolated, /the page's core runs"/);
});

test("every core method that takes a site is in Swift's siteMethods, so the site is always WebKit's", () => {
  const taking = new Set<string>();
  for (const m of core.matchAll(/case "(subwallet\.[A-Za-z.]+)":([\s\S]*?)(?=\n\s*(?:\/\/[^\n]*\n\s*)*case "|\n\s*default:)/g)) if (/\bp\.site\b/.test(m[2])) taking.add(m[1]);
  assert.ok(taking.has("subwallet.sign") && taking.has("subwallet.signTx"), `found ${[...taking].join(", ")}`);
  const swift = isolated.match(/static let siteMethods: Set<String> = \[([^\]]*)\]/);
  assert.ok(swift, "siteMethods not found");
  const listed = new Set([...swift[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  for (const method of taking) assert.ok(listed.has(method), `${method} takes a site but Swift doesn't set it from WebKit`);
});

test("the site goes only to the app whose wallet the waiting partner window is (browser, or pay in the card's window)", () => {
  const body = swiftFunc(isolated, "static func site(");
  assert.match(body, /app == walletKind, \["browser", "pay"\]\.contains\(app\)/);
  assert.match(body, /return \["origin": "https:\/\/\\\(askingHost\)"\]/);
});

test("the page can't check guesses against the words: recovery.confirm and renewConfirm never pass from it (audit CORE-01)", () => {
  assert.match(isolated, /static let pageNeverCalls: Set<String> = \["recovery\.confirm", "recovery\.renewConfirm"\]/);
  assert.match(swiftFunc(isolated, "func callIsolatedCore("), /!Self\.pageNeverCalls\.contains\(method\)/);
  // And the core refuses them itself whenever ZeroFee's own words screen is there.
  assert.match(core, /case "recovery\.confirm":\n\s+\/\/[^\n]*\n\s+if \(this\.nativeWords\) throw/);
  assert.match(core, /case "recovery\.renewConfirm":\n\s+if \(this\.nativeWords\) throw/);
});

test("the page reaches the core's secondDevice.* (the guardian and Kids parent run there, IOS-4), never alerts.*", () => {
  const families = /coreFamilies: Set<String> = \[([^\]]*)\]/.exec(isolated)?.[1] ?? "";
  assert.match(families, /"secondDevice"/);
  assert.doesNotMatch(families, /"alerts"/);
});

test("the Keychain never deletes an item before writing its new value (audit, Low: a stop between lost it)", () => {
  const keychain = read("apps/ios/ZeroFee/Keychain.swift");
  const set = keychain.slice(keychain.indexOf("static func set("), keychain.indexOf("static func delete("));
  assert.ok(set.indexOf("SecItemUpdate") >= 0 && set.indexOf("SecItemUpdate") < set.indexOf("SecItemAdd"), "update in place first, add only a new one");
  assert.doesNotMatch(set, /delete\(service, account\)|SecItemDelete/);
});

test("the chip signs two NEP-413 messages only, each built natively: the email-alerts proof (this build's own relay) and ZeroFee Chat's name note (J3 part 2)", () => {
  const sheet = read("apps/ios/ZeroFee/NativeSheet.swift");
  const fn = sheet.slice(sheet.indexOf("func signAlertsProof("), sheet.indexOf("func signChatName("));
  const chat = sheet.slice(sheet.indexOf("func signChatName("), sheet.indexOf("func presentSheet<"));
  assert.match(chat, /ChatName\.bytes\(accountId: accountId, chatKey: chatKey, until: until, nonce: nonce, now:/, "the note is rebuilt here from its parts");
  assert.doesNotMatch(chat, /p\["recipient"\]|p\["message"\]|p\["bytes"\]/, "never a recipient, message or bytes from the caller");
  const name = read("apps/ios/ZeroFee/NearTx.swift");
  assert.match(name, /static let recipient = "chat\.zerofee\.si"/, "the Chat note's recipient is a constant");
  assert.match(name, /end <= now \+ 90 \* 86_400/, "a Chat note lasts at most 90 days");
  assert.equal((sheet.match(/NearTx\.hash\(bytes\)/g) ?? []).length, 3, "a transaction, the alerts proof, the Chat note: nothing else is hashed for the chip");
  assert.match(fn, /RelaySetting\.parse\(Bundle\.main/, "the recipient is the build's own relay");
  assert.match(fn, /recipient: relay\.host/);
  assert.doesNotMatch(fn, /p\["recipient"\]|p\["message"\]|p\["bytes"\]/, "never a recipient, message or bytes from the caller");
  const tx = read("apps/ios/ZeroFee/NearTx.swift");
  assert.match(tx, /until <= now \+ 11 \* 60/, "a deadline at most ten minutes ahead (a minute's grace)");
  assert.match(read("apps/ios/ZeroFee/IsolatedCore.swift"), /\["info", "create", "sign", "signAlertsProof", "signChatName", "proof"\]\.contains\(op\)/, "the core may ask the chip for its key proof (L6), which signs nothing");
});

test("D134: the web view is made and loading before the core starts, and the core starts off the main thread", () => {
  const init = swiftFunc(host, "override init(");
  const load = init.indexOf("web.load(URLRequest(url: Self.startURL))");
  const start = init.indexOf("startCore()");
  assert.ok(load > 0 && start > load, "init loads the page, then starts the core");
  assert.ok(init.indexOf("WKWebView(frame:") < load);
  // control: the old order (the core evaluated on the main thread before the web view existed) is gone
  assert.doesNotMatch(init, /isolatedCore = startIsolatedCore\(\)/);
  const starting = swiftFunc(host, "private func startCore(");
  assert.match(starting, /Task\.detached\(priority: \.userInitiated\) \{ \[weak self\] in Host\.makeIsolatedCore\(network: network, delegate: self\) \}/);
  assert.match(isolated, /nonisolated static func makeIsolatedCore\(network: String, delegate: CoreHostDelegate\?\) -> CoreContext\?/);
  // every caller of the core waits for it (none reads the property directly, which is nil while it starts)
  for (const f of ["Host.swift", "IsolatedCore.swift", "PartnerWallet.swift", "PartnerBridge.swift", "ZeroFeeApp.swift"]) {
    const src = read(`apps/ios/ZeroFee/${f}`);
    assert.doesNotMatch(src, /(=|await|host\??\.|\bself\??\.) ?isolatedCore\b(?! = )(?!: CoreContext)/, `${f} reads isolatedCore directly: use coreWhenStarted()`);
  }
});

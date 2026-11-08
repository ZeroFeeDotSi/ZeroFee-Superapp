// QA's sd-errors crawl (4 Nov, 024/025): pasting the person's own Safe or SOL address (copied from Add) said
// "That isn't an account or an address." Send now says it's theirs and points to Move; a stranger's real address on
// every chain still goes through Send's own checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findRecipient } from "@zerofee/pay/send";
import type { Bridge } from "@zerofee/core/bridge";
import { sampleAddAddress } from "@zerofee/shell-api/MockBridge.ts";
import { keptAddEnds, ownLine, OWN_ADD, OWN_SAFE, OWN_WALLET } from "./send-own.ts";
import { keepCardKey } from "./add-coins.ts";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const SOL_WALLET = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const EVM_WALLET = "0xAb5e688E42cE07Fc83e0AD8ca0486b96a5D53e39";
const wallets = new Map([[SOL_WALLET.toLowerCase(), "SOL wallet"], [EVM_WALLET.toLowerCase(), "Robinhood wallet"]]);
const bridge = { call: async (m: string, p: { accountId?: string }) => (m === "ledger.recipientInfo" ? { ok: { exists: true, hasLedgerBalance: false, accountId: p.accountId } } : { problem: { code: "x" } }) } as unknown as Bridge;

test("the person's own wallet, Safe, and Add addresses (the Sim's made-up ones too) are said to be theirs", () => {
  const store = mem();
  const safeAdd = sampleAddAddress("sol", "add-sol-safe-key-0000001"), solAdd = sampleAddAddress("sol", "add-sol-wallet-key-000001"), rhAdd = sampleAddAddress("hood", "add-hood-wallet-key-00001");
  keepCardKey(store, "safe-sol", "add-sol-safe-key-0000001", Date.now() + 60_000, safeAdd);
  keepCardKey(store, "sol", "add-sol-wallet-key-000001", Date.now() + 60_000, solAdd);
  keepCardKey(store, "hood", "add-hood-wallet-key-00001", Date.now() + 60_000, rhAdd);
  const own = { wallets, addEnds: keptAddEnds(store), self: "zf-0123456789.near" };
  assert.equal(ownLine(safeAdd, own), OWN_ADD("Safe"));
  assert.equal(ownLine(` ${solAdd} `, own), OWN_ADD("SOL wallet"));
  assert.equal(ownLine(rhAdd, own), OWN_ADD("Robinhood wallet"));
  assert.equal(ownLine(SOL_WALLET, own), OWN_WALLET("SOL wallet"));
  assert.equal(ownLine(EVM_WALLET.toLowerCase(), own), OWN_WALLET("Robinhood wallet"), "an EVM address in any case");
  assert.equal(ownLine("ZF-0123456789.NEAR", own), OWN_SAFE);
  assert.equal(OWN_WALLET("SOL wallet"), "That's your own SOL wallet. Use Move.");
  assert.equal(OWN_ADD("Safe"), "That's where you add money to your Safe. Use Move.");
});

test("control: a stranger's real address on every chain is no one's own, and Send's checks still find it", async () => {
  const store = mem();
  keepCardKey(store, "sol", "add-sol-wallet-key-000001", Date.now() + 60_000, sampleAddAddress("sol", "add-sol-wallet-key-000001"));
  const own = { wallets, addEnds: keptAddEnds(store), self: "zf-0123456789.near" };
  const strangers = ["So11111111111111111111111111111111111111112", "0x7D06e272b5305a4b9D40e872C7950D3437547e3D", "0x8617e340b3d01fa5f11f306f4090fd50e238070d", "alice.near", "bob.tg", "37764c26a5ac3d2b02fdbcbc3f3fd57feb7e0b4fefcf9e2f0f0d5c7b0e1a5822"];
  for (const a of strangers) {
    assert.equal(ownLine(a, own), null, a);
    assert.ok("ok" in (await findRecipient(bridge, a)), `${a} still validates`);
  }
  assert.equal(ownLine("", own), null);
  assert.equal(ownLine(sampleAddAddress("sol", "another-key-0000000001"), own), null, "an Add address that isn't kept here");
});

test("SendForm reads it before the address's own checks, and SendSheet hands it the wallets", () => {
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.ok(form.indexOf("const mine = checks?.ownLine(") > 0 && form.indexOf("const mine = checks?.ownLine(") < form.indexOf("void findRecipient("));
  assert.match(sheet, /ownWallets=\{ownChain\}/);
});

test("Send's amount: a paste is read by readAmount (never stripped to digits), and a long one can't push the keypad or Hold", () => {
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./send.css", import.meta.url), "utf8");
  assert.match(form, /onChange=\{\(e\) => paste\(e\.target\.value\)\}/);
  assert.match(form, /const paste = \(v: string\) => withChecks\(\(\{ readAmount, refusedLine \}\) => \{ const r = readAmount\(v, 9,/);
  assert.match(form, /: amountNo \? amountNo\n/, "a refusal keeps Hold off and says why");
  assert.match(css, /\.wl-send2__amount \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.wl-send2__money input \{ max-width: 100%; overflow: hidden; text-overflow: ellipsis; \}/);
  assert.match(css, /\.wl-send2 \.wl-hold > span \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/);
});

test("Home's first load stays as it was: the paste checks load with Send and Swap's amounts, never statically", () => {
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  const sheet = readFileSync(new URL("../../../../design/src/MoneySheet.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(form, /^import .*(read-amount|send-own)/m);
  assert.doesNotMatch(sheet, /^import .*read-amount/m);
  assert.match(form, /import\("@zerofee\/design\/read-amount\.ts"\), import\("\.\/send-own\.ts"\)/);
  assert.match(sheet, /import\("\.\/read-amount\.ts"\)/);
  assert.match(form, /if \(checks\) |checks \? f\(checks\)/, "once loaded, a paste is read in its own event");
});

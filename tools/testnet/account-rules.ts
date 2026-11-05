// S1.6c on testnet (free): protection by amount, enforced by the account contract.
//
//   node tools/testnet/account-rules.ts
//
// A new account gets the account contract and NO full-access key: the phone's key can only ask the contract. With
// demo bands (up to 0.5 NEAR on Face ID, anything bigger waits 60 s):
//   - a small payment goes at once; a bigger one waits, can be cancelled, can't go early, and goes after the wait;
//   - a second device ("the laptop") is paired, then made necessary above the first band;
//   - a payment above it waits for the laptop; the phone alone is refused; the laptop says yes and it goes;
//   - the phone's key tries to send money directly, bypassing the contract, and NEAR itself refuses.
// Secrets stay in private files under $ZEROFEE_HOME/testnet/ and are never printed.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Bridge, BridgeResult } from "../../packages/core/src/bridge.ts";
import { RpcChain, txHashOf } from "../../packages/core/src/chain.ts";
import { DemoCore } from "../../packages/core/src/demo-core.ts";
import { SoftwareKey } from "../../packages/core/src/device-key.ts";
import { DevSigner } from "../../packages/core/src/dev-signer.ts";
import { FileVault } from "../../packages/core/src/file-vault.ts";
import type { AccountInfo, PlainWords, TxOutcome } from "../../packages/core/src/signer.ts";
import { serialize, signedBase64 } from "../../packages/core/src/tx-build.ts";
import { registrarCreator } from "./funder.ts";

const chain = new RpcChain("testnet");
const wasm = new Uint8Array(readFileSync(new URL("../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const runId = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const vaultPath = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "testnet", `account-rules-${runId}-phone.json`);
const core = new DemoCore({
  chain,
  vault: new FileVault(vaultPath),
  policyWasm: async () => wasm,
  createAccount: registrarCreator(chain, 45n, 10n),
  protection: [
    { up_to: [["near", "500000000000000000000000"]], level: "FaceId" },
    { up_to: null, level: { Wait: { seconds: "60" } } },
  ],
});

const t0 = Date.now();
const step = (n: number, text: string) => console.log(`\n${n}. ${text}  (+${((Date.now() - t0) / 1000).toFixed(0)} s)`);
const ok = <T>(r: BridgeResult<T>, what: string): T => {
  if ("problem" in r) throw new Error(`${what}: ${r.problem.code} — ${r.problem.whatHappened}`);
  return r.ok;
};
const show = (o: TxOutcome) => {
  console.log(`   → ${o.status}${o.status === "waiting" ? ` (id ${o.id}, until ${o.readyAtIso}${o.needsSecondDevice ? ", needs the second device" : ""})` : ""}${"explorerUrl" in o ? `  ${o.explorerUrl}` : ""}`);
  if (o.status === "problem") throw new Error(`${o.problem.code}: ${o.problem.whatHappened} ${o.problem.more ?? ""}`);
};
const pay = (yocto: string, why: string) => ({ request: { receiverId: "zf-5a09dbd737.testnet", actions: [{ kind: "transfer", yocto }], why, from: "wallet" } });
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

core.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => {
  console.log(`   ┌ ${words.title}`);
  for (const line of words.lines) console.log(`   │ ${line}`);
  for (const w of words.warnings) console.log(`   │ ⚠ ${w.text}`);
  console.log("   └ approved");
  void (core as Bridge).call("approval.answer", { id, approve: true });
});

step(1, "Create an account with the account contract (a funded testnet account pays the registrar; the faucet is rate-limited)");
const created = ok(await core.call<AccountInfo>("account.create"), "create");
const accountId = created.accountId;
console.log(`   account ${accountId}`);
const { words } = ok(await core.call<{ words: string[] }>("recovery.words"), "words");
ok(await core.call("recovery.confirm", { positions: [2, 9, 17], words: [words[1], words[8], words[16]] }), "confirm");
const keyList = async () => {
  const block = await chain.commonBlock();
  for (const k of await chain.accessKeys(accountId, block)) console.log(`   key ${k.handle.slice(0, 28)}…  ${k.permission.kind === "full" ? "FULL ACCESS" : `only: ${k.permission.methods.join(", ")}`}`);
};
await keyList();

step(2, "Pay 0.1 NEAR: inside the Face ID band, so it goes at once");
show(ok(await core.call<TxOutcome>("tx.request", pay("100000000000000000000000", "Coffee")), "small"));

step(3, "Pay 0.6 NEAR: above the band, so it waits 60 s; then cancel it");
const held = ok(await core.call<TxOutcome & { id: string }>("tx.request", pay("600000000000000000000000", "Rent share")), "big");
show(held);
console.log(`   waiting: ${JSON.stringify(ok(await core.call<{ title: string; ready: boolean }[]>("account.waiting"), "list").map((w) => `${w.title} (ready: ${w.ready})`))}`);
ok(await core.call("account.waiting.cancel", { id: held.id }), "cancel");
console.log(`   after cancel: ${ok(await core.call<unknown[]>("account.waiting"), "list").length} waiting`);

step(4, "Pay 0.6 NEAR again; it can't go early; after 60 s it goes");
const again = ok(await core.call<TxOutcome & { id: string }>("tx.request", pay("600000000000000000000000", "Rent share")), "again");
show(again);
const early = await core.call("account.waiting.run", { id: again.id });
console.log(`   send now: ${"problem" in early ? early.problem.whatHappened : "NOT REFUSED"}`);
if (!("problem" in early)) throw new Error("an early run was not refused");
await sleep(65);
show(ok(await core.call<TxOutcome>("account.waiting.run", { id: again.id }), "run"));

step(5, "Pair a second device (the laptop). Adding a key takes the strictest level: it waits 60 s too");
const laptop = SoftwareKey.generate();
const paired = ok(await core.call<TxOutcome & { id: string }>("account.secondDevice.pair", { publicKey: laptop.publicKey }), "pair");
show(paired);
await sleep(65);
show(ok(await core.call<TxOutcome>("account.waiting.run", { id: paired.id }), "pair run"));

step(6, "Make anything above the first band need the laptop (a protection change: also waits 60 s)");
const changed = ok(
  await core.call<TxOutcome & { id: string }>("account.protection.set", { bands: [{ upToUsd: 1, level: "faceid" }, { upToUsd: null, level: "device" }] }),
  "protection",
);
show(changed);
await sleep(65);
show(ok(await core.call<TxOutcome>("account.waiting.run", { id: changed.id }), "protection run"));
console.log(`   protection now: ${JSON.stringify(ok(await core.call<{ bands: unknown }>("account.protection.get"), "get").bands)}`);

step(7, "Pay 0.6 NEAR: it needs the laptop. The phone alone is refused; the laptop says yes and it goes");
const big = ok(await core.call<TxOutcome & { id: string }>("tx.request", pay("600000000000000000000000", "Big payment")), "big");
show(big);
const alone = await core.call("account.waiting.run", { id: big.id });
console.log(`   phone alone: ${"problem" in alone ? alone.problem.whatHappened : "NOT REFUSED"}`);
if (!("problem" in alone)) throw new Error("the phone ran it alone");
const second = new DevSigner({ accountId, chain, key: laptop, approve: async () => true });
show(await second.run(accountId, [{ kind: "call", method: "approve", args: new TextEncoder().encode(JSON.stringify({ id: big.id })), gas: 300_000_000_000_000n, depositYocto: 0n }]));

step(8, "Attack: the phone's key tries to send money directly, around the contract. NEAR itself refuses it");
const device = SoftwareKey.fromSeed(new Uint8Array(Buffer.from(JSON.parse(readFileSync(vaultPath, "utf8"))["device-seed"], "base64")), "development");
const block = await chain.commonBlock();
const ak = await chain.accessKey(accountId, device.publicKey, block);
const raw = { signerId: accountId, publicKey: device.publicKey, nonce: ak!.nonce + 1n, receiverId: "zf-5a09dbd737.testnet", blockHash: block.hash, actions: [{ kind: "transfer" as const, yocto: 1_000_000_000_000_000_000_000_000n }] };
const bytes = serialize(raw);
try {
  await chain.send(signedBase64(raw, await device.signHash(sha256(bytes))), txHashOf(bytes), accountId);
  throw new Error("NOT REFUSED: a direct transfer with the phone's key");
} catch (e: any) {
  if (String(e?.message).startsWith("NOT REFUSED")) throw e;
  console.log(`   refused ✓  ${e?.problem?.more ?? e?.message}`);
}
device.destroy();
await keyList();

core.close();
console.log(`\nDONE in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${accountId}`);
console.log(`   account page: https://testnet.nearblocks.io/address/${accountId}`);

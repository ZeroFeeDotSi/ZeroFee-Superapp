// S1.4 on testnet (free): the demo core every app builds against, run end to end against live nodes.
//
//   node tools/testnet/demo-core.ts
//
// Phone A creates an account (one post-quantum key + the official recovery rules), backs up its words, and sends a
// transfer through the full pipeline (decode, two nodes, approval, sign, confirm). Phone B then recovers from the 24
// words alone; phone A sees it and cancels; B starts again, waits out the 60 s demo delay, takes over, sends, and
// removes phone A's key.
//
// The approval sheet here prints the decoded words and says yes. Secrets (device seeds, the words) go only to private
// files under $ZEROFEE_HOME/testnet/ (mode 600) and are never printed.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Bridge, BridgeResult } from "../../packages/core/src/bridge.ts";
import { RpcChain } from "../../packages/core/src/chain.ts";
import { DemoCore } from "../../packages/core/src/demo-core.ts";
import { FileVault } from "../../packages/core/src/file-vault.ts";
import type { AccountInfo, PlainWords, TxOutcome, TxRequest } from "../../packages/core/src/signer.ts";
import { registrarCreator } from "./funder.ts";

const chain = new RpcChain("testnet");
const wasm = new Uint8Array(readFileSync(new URL("../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const dir = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "testnet");
const runId = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const phone = (name: string) =>
  new DemoCore({ chain, vault: new FileVault(join(dir, `demo-core-${runId}-${name}.json`)), policyWasm: async () => wasm, createAccount: registrarCreator(chain, 20n, 10n), watchIntervalMs: 3000 });

const t0 = Date.now();
const step = (n: number, text: string) => console.log(`\n${n}. ${text}  (+${((Date.now() - t0) / 1000).toFixed(1)} s)`);
const ok = <T>(r: BridgeResult<T>, what: string): T => {
  if ("problem" in r) throw new Error(`${what}: ${r.problem.code} — ${r.problem.whatHappened}`);
  return r.ok;
};
const done = (o: TxOutcome, what: string) => {
  if (o.status !== "done") throw new Error(`${what}: ${JSON.stringify(o)}`);
  console.log(`   ${o.explorerUrl}`);
};

/** The demo sheet: print exactly what the person would see, then approve. */
function sheet(core: Bridge, label: string) {
  core.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => {
    console.log(`   ┌ ${label} approval: ${words.title}`);
    for (const line of words.lines) console.log(`   │ ${line}`);
    for (const w of words.warnings) console.log(`   │ ⚠ ${w.text}`);
    for (const e of words.effect) console.log(`   │ ${e.token}: ${e.before} → at least ${e.after}`);
    if (words.hint) console.log(`   │ (${words.hint})`);
    console.log("   └ approved");
    void core.call("approval.answer", { id, approve: true });
  });
}

const a = phone("phone-a");
sheet(a, "A");

step(1, "Phone A creates an account: a throwaway classical key adds the post-quantum key, installs the rules, deletes itself");
const created = ok(await a.call<AccountInfo>("account.create"), "create");
const accountId = created.accountId;
console.log(`   account ${accountId}`);
for (const k of created.keys) console.log(`   key ${k.handle}  ${k.role}${k.current ? " (this phone)" : ""}`);
console.log(`   recovery rules: wait ${created.recovery?.delaySeconds} s`);
if (created.keys.length !== 1 || !created.keys[0].handle.startsWith("ml-dsa-65")) throw new Error("expected exactly one post-quantum key");

step(2, "Phone A shows the 24 words (kept in memory, saved privately here), the person confirms three");
const { words } = ok(await a.call<{ words: string[] }>("recovery.words"), "words");
writeFileSync(join(dir, `demo-core-${runId}-words.json`), JSON.stringify({ accountId, recoveryWords: words.join(" ") }), { mode: 0o600 });
ok(await a.call("recovery.confirm", { positions: [4, 13, 22], words: [words[3], words[12], words[21]] }), "confirm");
console.log(`   stage: ${ok(await a.call<{ stage: string }>("account.state"), "state").stage}`);

step(3, "An app (Wallet) asks to send 0.01 NEAR: decoded, checked on two nodes, approved, signed post-quantum, confirmed");
const pay: TxRequest = { receiverId: "zf-5a09dbd737.testnet", actions: [{ kind: "transfer", yocto: "10000000000000000000000" }], why: "Pay back lunch", from: "wallet" };
done(ok(await a.call<TxOutcome>("tx.request", { request: pay }), "send"), "send");

step(4, "Phone B recovers from the 24 words alone (the account is found from the words, then checked on two nodes)");
const b = phone("phone-b");
sheet(b, "B");
const started: string[] = [];
a.on<{ readyAtIso: string }>("recovery.started", ({ readyAtIso }) => {
  started.push(readyAtIso);
  console.log(`   phone A sees it: "Was this you?" (ready at ${readyAtIso})`);
});
console.log(`   ready at ${ok(await b.call<{ readyAtIso: string }>("recovery.start", { words }), "recovery.start").readyAtIso}`);

step(5, "Phone A cancels; phone B is told the move was stopped");
for (let i = 0; i < 10 && started.length === 0; i++) await new Promise((r) => setTimeout(r, 1000));
if (started.length === 0) throw new Error("phone A never saw the recovery start");
done(ok(await a.call<TxOutcome>("recovery.cancel"), "cancel"), "cancel");
const stopped = await b.call("recovery.finish");
console.log(`   phone B: ${"problem" in stopped ? stopped.problem.whatHappened : "NOT STOPPED"}`);
if (!("problem" in stopped) || stopped.problem.code !== "security.recovery.stopped") throw new Error("finish after cancel was not refused");

step(6, "Phone B starts again and tries to finish early");
const again = ok(await b.call<{ readyAtIso: string }>("recovery.start", { words, accountId }), "start again");
const early = await b.call("recovery.finish");
console.log(`   phone B: ${"problem" in early ? early.problem.whatHappened : "NOT REFUSED"}`);
if (!("problem" in early) || early.problem.code !== "security.recovery.waiting") throw new Error("early finish was not refused");

step(7, "After the wait, phone B finishes: the contract adds B's post-quantum key, and B sends");
await new Promise((r) => setTimeout(r, Math.max(0, Date.parse(again.readyAtIso) - Date.now()) + 5000));
const recovered = ok(await b.call<AccountInfo>("recovery.finish"), "finish");
for (const k of recovered.keys) console.log(`   key ${k.handle}  ${k.role}${k.current ? " (this phone)" : ""}`);
done(ok(await b.call<TxOutcome>("tx.request", { request: { ...pay, actions: [{ kind: "transfer", yocto: "1" }], why: "First payment from the new phone" } }), "send from B"), "send from B");
if (recovered.keys.some((k) => !k.handle.startsWith("ml-dsa-65"))) throw new Error("a classical key appeared on the account");

step(8, "Phone B removes phone A's key (found in the account's history, checked by its hash on two nodes)");
const oldKey = recovered.keys.find((k) => k.role === "device" && !k.current);
if (!oldKey) throw new Error("no older phone key to remove");
done(ok(await b.call<TxOutcome>("account.removeKey", { handle: oldKey.handle }), "remove old key"), "remove old key");
const afterRemoval = ok(await b.call<{ account: AccountInfo }>("account.state"), "state").account;
for (const k of afterRemoval.keys) console.log(`   key ${k.handle}  ${k.role}${k.current ? " (this phone)" : ""}`);
const oldPhone = await a.call("account.state");
console.log(`   phone A: ${"problem" in oldPhone ? oldPhone.problem.whatHappened : "STILL SIGNS"}`);
if (!("problem" in oldPhone) || oldPhone.problem.code !== "security.key.missing") throw new Error("phone A can still sign");

a.close();
b.close();
console.log(`\nDONE in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${accountId}`);
console.log(`   account page: https://testnet.nearblocks.io/address/${accountId}`);
console.log("   secrets: saved to private files under $ZEROFEE_HOME/testnet/ (not printed)");

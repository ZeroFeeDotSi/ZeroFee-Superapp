// S1.8 on testnet (free): the laptop as second signer, end to end against live nodes, on the e2e account.
//
//   node tools/testnet/second-device.ts [accountId]
//
// 1. A fresh "phone" takes over the e2e account from its 24 words (the demo's 60 s wait), as "I already have an account".
// 2. A fresh "laptop" (SecondDeviceCore) shows its code; the phone pairs it (held behind the strictest level, then run).
// 3. The phone sets "ask my laptop above $1" (held, then run).
// 4. The phone sends 0.05 NEAR back to our funder: held for the laptop. The laptop reads it from the account contract,
//    shows it on its own sheet and says yes: it goes.
// 5. The phone puts the account's protection back to the demo's (held for the laptop's yes and the wait, then run), so
//    other e2e tests find the account as it was. The laptop's key stays: it can only approve or decline.
//
// Prices are fixed here ($100 a NEAR), so the bands land in the same place every run. The sheets print every line and
// say yes. The words are read from $ZEROFEE_HOME/testnet/e2e-<account>.json and never printed; the new
// phone and laptop keys go to private files next to it (mode 600).
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Bridge, BridgeResult } from "../../packages/core/src/bridge.ts";
import { RpcChain } from "../../packages/core/src/chain.ts";
import { DemoCore } from "../../packages/core/src/demo-core.ts";
import { FileVault } from "../../packages/core/src/file-vault.ts";
import type { HeldRequest } from "../../packages/core/src/held.ts";
import { SecondDeviceCore } from "../../packages/core/src/second-device.ts";
import type { PlainWords, TxOutcome } from "../../packages/core/src/signer.ts";

const dir = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "testnet");
const file = process.argv[2] ? `e2e-${process.argv[2]}.json` : readdirSync(dir).filter((f) => f.startsWith("e2e-")).sort().at(-1);
if (!file) throw new Error("no e2e account: run tools/testnet/make-account.ts first");
const { accountId, recoveryWords } = JSON.parse(readFileSync(join(dir, file), "utf8")) as { accountId: string; recoveryWords: string };
const FUNDER = "zf-49915cee18.testnet";
const runId = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);

const chain = new RpcChain("testnet");
const phone = new DemoCore({ chain, vault: new FileVault(join(dir, `laptop-e2e-${runId}-phone.json`)), policyWasm: async () => new Uint8Array(), prices: async () => ({ near: 100 }), watchIntervalMs: 3000 });
const laptop = new SecondDeviceCore({ chain, vault: new FileVault(join(dir, `laptop-e2e-${runId}-laptop.json`)) });

const t0 = Date.now();
const step = (n: number, text: string) => console.log(`\n${n}. ${text}  (+${((Date.now() - t0) / 1000).toFixed(0)} s)`);
const ok = <T>(r: BridgeResult<T>, what: string): T => {
  if ("problem" in r) throw new Error(`${what}: ${r.problem.code} — ${r.problem.whatHappened}`);
  return r.ok;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function sheet(core: Bridge, who: string) {
  core.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => {
    console.log(`   [${who}'s sheet] ${words.title}`);
    for (const line of words.lines) console.log(`      ${line}`);
    for (const w of words.warnings) console.log(`      ! ${w.text}`);
    void core.call("approval.answer", { id, approve: true });
  });
}
sheet(phone, "phone");
sheet(laptop, "laptop");

/** Wait out a held request's time, then run it from the phone. */
async function runWhenReady(held: TxOutcome, what: string): Promise<void> {
  if (held.status === "done") return console.log(`   done: ${held.explorerUrl}`);
  if (held.status !== "waiting") throw new Error(`${what}: ${JSON.stringify(held)}`);
  console.log(`   held as #${held.id} until ${held.readyAtIso}${held.needsSecondDevice ? ", for the laptop" : ""}`);
  await sleep(Math.max(0, Date.parse(held.readyAtIso) - Date.now()) + 3000);
  const out = ok(await phone.call<TxOutcome>("account.waiting.run", { id: held.id }), `${what}: run`);
  if (out.status !== "done") throw new Error(`${what}: run: ${JSON.stringify(out)}`);
  console.log(`   ran: ${out.explorerUrl}`);
}

/** The laptop finds the request in the account contract (polling, like the ?laptop page) and says yes. */
async function laptopSaysYes(id: string): Promise<TxOutcome> {
  for (let i = 0; i < 20; i++) {
    const lists = ok(await laptop.call<{ accountId: string; requests: HeldRequest[] }[]>("secondDevice.requests"), "requests");
    const found = lists.find((l) => l.accountId === accountId)?.requests.find((r) => r.id === id);
    if (found) {
      console.log(`   the laptop sees #${id}: ${found.title}`);
      return ok(await laptop.call<TxOutcome>("secondDevice.answer", { accountId, id, approve: true }), "answer");
    }
    await sleep(3000);
  }
  throw new Error(`the laptop never saw #${id}`);
}

step(1, `a fresh phone takes over ${accountId} from its words`);
const { readyAtIso } = ok(await phone.call<{ readyAtIso: string }>("recovery.start", { words: recoveryWords.split(" "), accountId }), "recovery.start");
console.log(`   waiting until ${readyAtIso}`);
await sleep(Math.max(0, Date.parse(readyAtIso) - Date.now()) + 3000);
ok(await phone.call("recovery.finish"), "recovery.finish");

step(2, "the laptop shows its code; the phone pairs it");
const { code, fingerprint } = ok(await laptop.call<{ code: string; fingerprint: string }>("secondDevice.state"), "state");
console.log(`   laptop code: ${code.slice(0, 16)}… (${code.length} letters), fingerprint ${fingerprint}`);
await runWhenReady(ok(await phone.call<TxOutcome>("account.secondDevice.pair", { qr: code }), "pair"), "pair");
for (let i = 0; i < 20 && !ok(await laptop.call<{ accounts: string[] }>("secondDevice.state"), "state").accounts.includes(accountId); i++) await sleep(3000);
console.log(`   the laptop guards: ${ok(await laptop.call<{ accounts: string[] }>("secondDevice.state"), "state").accounts.join(", ")}`);

step(3, `the phone asks the laptop for anything above $1`);
await runWhenReady(ok(await phone.call<TxOutcome>("account.secondDevice.setLimit", { usd: 1 }), "setLimit"), "setLimit");

step(4, `the phone sends 0.05 NEAR to ${FUNDER}: held for the laptop, which says yes`);
const pay = ok(await phone.call<TxOutcome>("tx.request", { request: { receiverId: FUNDER, actions: [{ kind: "transfer", yocto: "50000000000000000000000" }], why: "Laptop e2e", from: "wallet" } }), "pay");
if (pay.status !== "waiting" || !pay.needsSecondDevice) throw new Error(`expected a hold for the laptop: ${JSON.stringify(pay)}`);
const yes = await laptopSaysYes(pay.id);
console.log(`   laptop's yes: ${yes.status}${yes.status === "done" ? ` ${yes.explorerUrl}` : ""}`);
if (yes.status === "waiting") await runWhenReady(yes, "pay");

step(5, "the phone puts the demo protection back (the laptop says yes to that too)");
const back = ok(await phone.call<TxOutcome>("account.protection.set", { bands: [{ upToUsd: 500, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 120 }] }), "restore");
// The laptop's yes runs it at once if the wait is already over; otherwise the phone runs it after the wait.
await runWhenReady(back.status === "waiting" && back.needsSecondDevice ? await laptopSaysYes(back.id) : back, "restore");

phone.close();
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(0)} s.`);

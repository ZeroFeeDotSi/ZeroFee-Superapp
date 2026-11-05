// The NEAR mainnet copy, proven with the app's own code: the trusted core (DemoCore) and Wallet's ledger, composed as
// apps/web/src/core.ts composes them, against the copy (127.0.0.1 only; NEAR's dollar price is read from mainnet,
// read only, as the rehearsals do: the copy has no Ref pool). The core holds its own software key, in memory only.
//   1. a new account by the app's own self-funded set-up: words first, one set-up address funded from the copy's faucet,
//      the registrar's create_account, then release 9 by its published hash (the code hash the core pins);
//   2. it receives fake NEAR and fake USDC (on the account and inside intents.near: the Safe), and Wallet's ledger reads them;
//   3. the account contract's rules: a Send under the Face ID limit runs (the money arrives); one over it is refused now
//      and waits the day (nothing moves), as does one that takes the day's total over it; the phone cancels them; the recovery window (48 hours) and the words' key
//      (start_recovery and finish_recovery only).
//   bash tools/fork/near/start.sh && node tools/fork/near/prove.ts && bash tools/fork/near/stop.sh
import { readFileSync } from "node:fs";
import { privateKeyFromRandom, publicKeyFromPrivate } from "@fastnear/utils";
import { forApps, routeBridge, type Bridge, type BridgeResult } from "../../../packages/core/src/bridge.ts";
import { RpcChain, codeOf } from "../../../packages/core/src/chain.ts";
import { DemoCore, bandPrices, type Funding } from "../../../packages/core/src/demo-core.ts";
import { ACCOUNT_POLICY } from "../../../packages/core/src/known-contracts.ts";
import { MemoryVault } from "../../../packages/core/src/vault.ts";
import { createLedgerService } from "../../../packages/wallet/src/ledger.ts";
import { NEAR, RPC, TGAS, USDC, account, asRoot, fnCall, root, view } from "./lib.ts";

const chain = new RpcChain("mainnet", [RPC, RPC.replace("127.0.0.1", "localhost")]);
const mainnet = new RpcChain("mainnet");
const wasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy.wasm", import.meta.url)));
let failed = 0;
const check = (ok: unknown, what: string, detail?: unknown) => {
  console.log(`   ${ok ? "✓" : "✗"} ${what}${detail === undefined ? "" : `  ${JSON.stringify(detail, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 300)}`}`);
  if (!ok) failed++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nearOf = async (id: string) => BigInt((await account(id))?.amount ?? "0");

const sheets: string[] = [];
const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => wasm, sheet: async (w) => (sheets.push(String(w.title ?? "")), true), prices: () => bandPrices(mainnet), intentsSalt: null });
const store = new Map<string, unknown>();
const device: Bridge = {
  async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
    const k = `${p.app}:${p.key}`;
    if (method === "device.store.get") return { ok: { value: store.get(k) ?? null } as T };
    if (method === "device.store.set") return (store.set(k, p.value), { ok: { ok: true } as T });
    return { problem: { code: "shell.device.refused", whatHappened: method, money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } };
  },
  on: () => () => {},
};
const base = routeBridge(core, { device });
const ledger = createLedgerService({ bridgeFor: (caller) => forApps(base, caller), chain });
const shellB = routeBridge(core, { device, ledger });
const wallet = forApps(shellB, "wallet");
async function shell<T>(method: string, p: Record<string, unknown> = {}, b: Bridge = shellB): Promise<T> {
  const r = await b.call<T>(method, p);
  if ("problem" in r) throw new Error(`${method}: ${r.problem.whatHappened}${r.problem.more ? ` [${r.problem.more}]` : ""} (${r.problem.code})`);
  return r.ok;
}
async function words() {
  const { words: w } = await shell<{ words: string[] }>("recovery.words");
  await shell("recovery.confirm", { positions: [1, 2, 3], words: w.slice(0, 3) });
}

console.log("1. a new account, by the app's own self-funded set-up");
let first = await shell<Funding | { accountId: string }>("account.create", { fund: "self" });
if ((await shell<{ wordsDue?: boolean }>("account.state")).wordsDue) {
  await words();
  check(true, "the backup words come first, checked before any money is asked (J2)");
  first = await shell<Funding | { accountId: string }>("account.create", { fund: "self" });
}
if (!("stage" in first)) throw new Error("account.create made an account without asking for NEAR: stop");
check(/^zf-[0-9a-f]{10}\.near$/.test(first.accountId) && /^[0-9a-f]{64}$/.test(first.fundAddress), `it asks ${Number(BigInt(first.needYocto) / (NEAR / 1000n)) / 1000} NEAR at one set-up address for ${first.accountId}`);
await asRoot(first.fundAddress, [{ kind: "transfer", yocto: BigInt(first.needYocto) + NEAR }], "fund the set-up address");
let accountId = "";
for (let i = 0; i < 30 && !accountId; i++) {
  const s = await shell<{ stage: string }>("account.state");
  if (s.stage === "needs-backup") await words();
  if (s.stage === "ready") break;
  const r = await core.call<Funding | { accountId: string }>("account.create", { fund: "self" });
  if ("ok" in r && !("stage" in r.ok)) accountId = r.ok.accountId;
  else await sleep(3000);
}
const state = await shell<{ stage: string; account?: { accountId: string } }>("account.state");
if (state.stage === "needs-backup") await words();
accountId ||= state.account?.accountId ?? "";
check(accountId === first.accountId && (await shell<{ stage: string }>("account.state")).stage === "ready", `${accountId} is made and ready`);
const block = await chain.commonBlock();
const acct = await chain.account(accountId, block);
check(codeOf(acct) === ACCOUNT_POLICY.codeHashBase58 && !!acct?.globalContractHash, "it runs release 9 by its published hash, the code hash the core pins", codeOf(acct));
check((await chain.view(accountId, "release_version", {}, block)) === 9, "release_version 9");
check(!(await account(first.fundAddress)), "the set-up address is gone (emptied into the account)");

console.log("\n2. fake NEAR and fake USDC come in");
const before = await nearOf(accountId);
await asRoot(accountId, [{ kind: "transfer", yocto: 20n * NEAR }], "20 NEAR");
check((await nearOf(accountId)) - before === 20n * NEAR, "20 NEAR arrived on the account");
const storage = async (contract: string, who: string) => {
  if (await view(contract, "storage_balance_of", { account_id: who })) return;
  await asRoot(contract, [fnCall("storage_deposit", { account_id: who, registration_only: true }, BigInt((await view<{ min: string }>(contract, "storage_balance_bounds")).min), 30n * TGAS)], "storage");
};
for (const who of [accountId, root.account_id, "intents.near"]) await storage(USDC, who);
await asRoot(USDC, [fnCall("mint", { to: accountId, amount: "50000000" }, 0n, 30n * TGAS)], "mint 50 USDC");
await asRoot(USDC, [fnCall("mint", { to: root.account_id, amount: "100000000" }, 0n, 30n * TGAS)], "mint 100 USDC");
await asRoot(USDC, [fnCall("ft_transfer_call", { receiver_id: "intents.near", amount: "100000000", msg: accountId }, 1n, 100n * TGAS)], "100 USDC into the Safe");
check((await view(USDC, "ft_balance_of", { account_id: accountId })) === "50000000", "50 USDC on the account (mainnet's USDC code)");
check((await view("intents.near", "mt_balance_of", { account_id: accountId, token_id: `nep141:${USDC}` })) === "100000000", "100 USDC inside intents.near for it (the Safe; mainnet's intents code)");
const bal = await wallet.call<{ coins?: { tokenId?: string; symbol?: string; amount?: string }[] }>("ledger.balances", {});
check("ok" in bal && JSON.stringify(bal.ok).includes(USDC), "Wallet's ledger reads the Safe's USDC", "ok" in bal ? JSON.stringify(bal.ok).slice(0, 200) : bal.problem.code);

console.log("\n3. the account contract's rules");
const prot = await chain.view(accountId, "protection", {}, await chain.commonBlock());
check(/"level":"FaceId"/.test(JSON.stringify(prot)) && /"Wait":\{"seconds":"86400"\}/.test(JSON.stringify(prot)), "the app's protection: Face ID up to $500 of NEAR, more waits a day", prot);
// The dollars are the band's own: its NEAR limit is $500 at the price set-up wrote it at.
const bandNear = BigInt((prot as { up_to: [string, string][] | null }[])[0]!.up_to!.find(([c]) => c === "near")![1]);
const usd = Number((500n * NEAR * 1000n) / bandNear) / 1000;
const yoctoFor = (dollars: number) => (bandNear * BigInt(dollars)) / 500n;
const bobKey = privateKeyFromRandom();
if (!(await account("bob.near"))) await asRoot("near", [fnCall("create_account", { new_account_id: "bob.near", new_public_key: publicKeyFromPrivate(bobKey) }, NEAR)], "bob.near");
const pay = (yocto: bigint) => wallet.call<{ status: string; id?: string; readyAtIso?: string }>("tx.request", { request: { receiverId: "bob.near", actions: [{ kind: "transfer", yocto: yocto.toString() }], why: "", from: "wallet" } });
await asRoot(accountId, [{ kind: "transfer", yocto: yoctoFor(700) }], "NEAR for the payments");
const b0 = await nearOf("bob.near");
const small = await pay(yoctoFor(50));
check("ok" in small && small.ok.status === "done" && (await nearOf("bob.near")) - b0 === yoctoFor(50), `Send $50 of NEAR (NEAR at $${usd}): under the limit, it runs and arrives`, "ok" in small ? small.ok.status : small.problem.code);
const b1 = await nearOf("bob.near");
const big = await pay(yoctoFor(600));
const waitS = "ok" in big && big.ok.readyAtIso ? Math.round((Date.parse(big.ok.readyAtIso) - Date.now()) / 1000) : -1;
check("ok" in big && big.ok.status === "waiting" && Math.abs(waitS - 86_400) < 300 && (await nearOf("bob.near")) === b1, "Send $600: over the limit, the contract won't run it now: it waits a day, nothing moved", "ok" in big ? { status: big.ok.status, waitS } : big.problem.code);
const b2 = await nearOf("bob.near");
const second = await pay(yoctoFor(460));
check("ok" in second && second.ok.status === "waiting" && (await nearOf("bob.near")) === b2, "Send $460 after the $50: the limit is a day's total ($510 over $500 in 24 hours): it waits too, nothing moved", "ok" in second ? second.ok.status : second.problem.code);
const waiting = await shell<{ id: string }[]>("account.waiting");
for (const w of waiting) await shell("account.waiting.cancel", { id: w.id });
await sleep(2000);
check((await shell<unknown[]>("account.waiting")).length === 0, `the phone cancels what waits (${waiting.length}): nothing is left waiting`);
const end = await chain.commonBlock();
check((await chain.view(accountId, "delay_seconds", {}, end)) === "172800", "the recovery window: 48 hours (the app's default)");
const keys = await chain.accessKeys(accountId, end);
check(keys.length === 2 && keys.some((k) => k.permission.kind === "function-call" && k.permission.methods.join() === ACCOUNT_POLICY.recoveryKeyMethods.join()), "two keys, neither full access: the phone's, and the words' (start_recovery and finish_recovery only)", keys.map((k) => (k.permission.kind === "function-call" ? k.permission.methods.length : "full")));
console.log(`\n   ${sheets.length} approval sheets answered yes: ${[...new Set(sheets)].slice(0, 6).join(" | ")}`);
console.log(failed ? `\nNOT GREEN: ${failed} failed` : "\nGREEN: the copy makes an app account on the pinned release, takes fake money, and holds its rules.");
process.exit(failed ? 1 : 0);

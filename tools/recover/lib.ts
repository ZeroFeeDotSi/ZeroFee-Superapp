// The open-source recovery tool (S1.9): get your account back with only your 24 words and a computer, even if ZeroFee
// itself is gone. It talks to public NEAR nodes only (two must agree), never to a ZeroFee server.
//
// 1. start   the words rebuild the recovery key; the account is found by that key; a NEW key is made on this
//            computer and the account contract is asked to move to it. That has to wait (7 days on a real account),
//            and the old phone can stop it, so a thief with the words alone gets nothing if the phone is still yours.
// 2. finish  after the wait, the words again: the new key becomes a key of the account, with the same limits as a
//            phone: it can only ask the account's own rules, so the protection by amount still applies.
// 3. send / call / waiting / run: move the money, with every step described in plain words before you say yes.
//
// The words are never stored: they are asked for again at finish. The new key is kept in a private file (mode 600).
import { decodePublicKey } from "@fastnear/ml-dsa-65";
import { bytesToBase64 } from "@fastnear/utils";
import { codeOf } from "../../packages/core/src/chain.ts";
import type { Chain } from "../../packages/core/src/chain.ts";
import { SoftwareKey } from "../../packages/core/src/device-key.ts";
import { DevSigner, recoveryState } from "../../packages/core/src/dev-signer.ts";
import type { Approve } from "../../packages/core/src/dev-signer.ts";
import { heldRequests } from "../../packages/core/src/held.ts";
import type { HeldRequest } from "../../packages/core/src/held.ts";
import { isAccountPolicy } from "../../packages/core/src/known-contracts.ts";
import { wordsProblem, wordsToSeed } from "../../packages/core/src/recovery-words.ts";
import type { TxOutcome } from "../../packages/core/src/signer.ts";
import type { CoreAction } from "../../packages/core/src/tx-build.ts";
import type { Vault } from "../../packages/core/src/vault.ts";

const NEW_KEY = "new-key-seed";
const ACCOUNT = "account";
const CALL_GAS = 30_000_000_000_000n;
const RUN_GAS = 300_000_000_000_000n;
/** Release 9: the finish reserves 30 Tgas for its callback (on_recovery_key), so it carries 100 Tgas, as the app does. */
const FINISH_GAS = 100_000_000_000_000n;
/** NEAR left behind by "send all", for the fees of the steps that may follow (running a held send). */
const KEEP = 50_000_000_000_000_000_000_000n;
const STORAGE_PRICE = 10_000_000_000_000_000_000n;

export class RecoveryError extends Error {}

const utf8 = (s: string) => new TextEncoder().encode(s);
const call = (method: string, args: Record<string, unknown> = {}, gas = CALL_GAS, depositYocto = 0n): CoreAction => ({ kind: "call", method, args: utf8(JSON.stringify(args)), gas, depositYocto });

export interface RecoveryOptions {
  chain: Chain;
  vault: Vault;
  /** Show the plain words of what is about to be signed; resolve true only if the person says yes. */
  confirm: Approve;
}

export class Recovery {
  private readonly o: RecoveryOptions;
  constructor(options: RecoveryOptions) {
    this.o = options;
  }

  private static key(words: string[]): SoftwareKey {
    const problem = wordsProblem(words);
    if (problem?.kind === "count") throw new RecoveryError(`That's ${problem.got} words; the backup has 24.`);
    if (problem?.kind === "unknown-word") throw new RecoveryError(`Word ${problem.position} isn't one of the backup words. Check its spelling.`);
    if (problem?.kind === "checksum") throw new RecoveryError("These words don't fit together. One of them is wrong, or two are swapped.");
    return SoftwareKey.fromSeed(wordsToSeed(words), "recovery-words");
  }

  async accountId(): Promise<string | null> {
    const raw = await this.o.vault.get(ACCOUNT);
    return raw ? new TextDecoder().decode(raw) : null;
  }

  /** The account this recovery key belongs to: the key index suggests, two nodes must confirm. */
  private async find(recovery: SoftwareKey, accountId?: string): Promise<string> {
    const candidates = accountId ? [accountId] : await this.o.chain.accountsForKey(recovery.publicKeyHandle);
    const block = await this.o.chain.commonBlock();
    for (const candidate of candidates) {
      const p = (await this.o.chain.accessKey(candidate, recovery.publicKey, block))?.permission;
      if (p?.kind === "function-call" && p.receiverId === candidate && p.methods.includes("start_recovery")) return candidate;
    }
    throw new RecoveryError("No account has these words as its backup key. If you know the account's name, give it with --account.");
  }

  /** Make the new key here, then ask the account to move to it. */
  async start(words: string[], accountId?: string): Promise<{ accountId: string; readyAtIso: string }> {
    const recovery = Recovery.key(words);
    const found = await this.find(recovery, accountId);
    const block = await this.o.chain.commonBlock();
    const before = await recoveryState(this.o.chain, found, codeOf(await this.o.chain.account(found, block))!, block);
    if (before.pending) throw new RecoveryError(`A move is already waiting; it can finish after ${before.pending.readyAtIso}.`);
    // The new key is saved before anything is asked on-chain, so the account can never point at a key nobody has.
    const fresh = SoftwareKey.generate();
    await this.o.vault.put(NEW_KEY, fresh.exportSeed());
    await this.o.vault.put(ACCOUNT, utf8(found));
    const newKey = bytesToBase64(new Uint8Array([2, ...decodePublicKey(fresh.publicKey)]));
    const outcome = await new DevSigner({ accountId: found, chain: this.o.chain, key: recovery, approve: this.o.confirm }).run(found, [call("start_recovery", { new_key: newKey })]);
    if (outcome.status !== "done") throw new RecoveryError(outcome.status === "declined" ? "Nothing was signed." : outcome.status === "problem" ? outcome.problem.whatHappened : "It didn't go through.");
    const after = await this.status();
    if (!after.readyAtIso) throw new RecoveryError("The move didn't start: the account's phone may have stopped it.");
    return { accountId: found, readyAtIso: after.readyAtIso };
  }

  /** Where the move stands: waiting until a time, done (this computer's key is on the account), or none. */
  async status(): Promise<{ accountId: string | null; stage: "none" | "waiting" | "done" | "stopped"; readyAtIso: string | null }> {
    const accountId = await this.accountId();
    const seed = await this.o.vault.get(NEW_KEY);
    if (!accountId || !seed) return { accountId, stage: "none", readyAtIso: null };
    const mine = SoftwareKey.fromSeed(seed, "development");
    const block = await this.o.chain.commonBlock();
    if (await this.o.chain.accessKey(accountId, mine.publicKey, block)) return { accountId, stage: "done", readyAtIso: null };
    const s = await recoveryState(this.o.chain, accountId, codeOf(await this.o.chain.account(accountId, block))!, block);
    return s.pending ? { accountId, stage: "waiting", readyAtIso: s.pending.readyAtIso } : { accountId, stage: "stopped", readyAtIso: null };
  }

  /** After the wait: the words again, and this computer's key joins the account. */
  async finish(words: string[]): Promise<{ accountId: string }> {
    const st = await this.status();
    if (st.stage === "none") throw new RecoveryError("Start first: nothing is waiting from this computer.");
    if (st.stage === "done") return { accountId: st.accountId! };
    if (st.stage === "stopped") throw new RecoveryError("The account's phone stopped the move. If that wasn't you, start again.");
    if (Date.now() < Date.parse(st.readyAtIso!)) throw new RecoveryError(`Not yet: it can finish after ${st.readyAtIso}.`);
    const recovery = Recovery.key(words);
    const outcome = await new DevSigner({ accountId: st.accountId!, chain: this.o.chain, key: recovery, approve: this.o.confirm }).run(st.accountId!, [call("finish_recovery", {}, FINISH_GAS)]);
    if (outcome.status !== "done") throw new RecoveryError(outcome.status === "declined" ? "Nothing was signed." : outcome.status === "problem" ? outcome.problem.whatHappened : "It didn't go through.");
    return { accountId: st.accountId! };
  }

  /** The account's key on this computer, once the move is done. */
  private async signer(): Promise<DevSigner> {
    const st = await this.status();
    if (st.stage !== "done") throw new RecoveryError("Finish the move first.");
    const mine = SoftwareKey.fromSeed((await this.o.vault.get(NEW_KEY))!, "development");
    return new DevSigner({ accountId: st.accountId!, chain: this.o.chain, key: mine, approve: this.o.confirm });
  }

  async balance(): Promise<{ accountId: string; nearYocto: bigint; spendableYocto: bigint }> {
    const signer = await this.signer();
    const acct = await this.o.chain.account(signer.accountId, await this.o.chain.commonBlock());
    const storage = (acct?.storageBytes ?? 0n) * STORAGE_PRICE;
    const total = acct?.balanceYocto ?? 0n;
    return { accountId: signer.accountId, nearYocto: total, spendableYocto: total > storage + KEEP ? total - storage - KEEP : 0n };
  }

  /** Send NEAR (in yocto, or everything that can go). The account's protection still applies: it may wait. */
  async send(to: string, amount: bigint | "all"): Promise<TxOutcome> {
    const signer = await this.signer();
    const yocto = amount === "all" ? (await this.balance()).spendableYocto : amount;
    if (yocto <= 0n) throw new RecoveryError("There's no NEAR here to send.");
    return signer.request({ receiverId: to, actions: [{ kind: "transfer", yocto: yocto.toString() }], why: "", from: "security" });
  }

  /** Any call on another contract (e.g. moving coins out of NEAR Intents), described in plain words before you say yes. */
  async call(receiverId: string, method: string, args: Record<string, unknown>, depositYocto = 0n, gas = 100_000_000_000_000n): Promise<TxOutcome> {
    const signer = await this.signer();
    return signer.request({ receiverId, actions: [{ kind: "call", method, args, depositYocto: depositYocto.toString(), gas: gas.toString() }], why: "", from: "security" });
  }

  /** What the account's rules are holding. */
  async waiting(): Promise<HeldRequest[]> {
    const signer = await this.signer();
    const block = await this.o.chain.commonBlock();
    if (!isAccountPolicy(codeOf(await this.o.chain.account(signer.accountId, block)), this.o.chain.network)) return [];
    return heldRequests(this.o.chain, signer.accountId);
  }

  /** Send a held request whose wait is over. */
  async run(id: string): Promise<TxOutcome> {
    const signer = await this.signer();
    const held = (await this.waiting()).find((w) => w.id === id);
    if (!held) throw new RecoveryError(`Nothing is waiting with number ${id}.`);
    if (held.needsSecondDevice) throw new RecoveryError("This one also needs your second device's yes.");
    if (!held.ready) throw new RecoveryError(`Not yet: it can go after ${held.readyAtIso}.`);
    return signer.run(signer.accountId, [call("run", { id }, RUN_GAS)]);
  }
}

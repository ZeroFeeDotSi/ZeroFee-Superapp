// DevSigner: the Signer pipeline with a software post-quantum key, for testnet, the web demo and tests.
//
// It runs the same steps the phone will: build the bytes → decode them independently → refuse on any mismatch → read the
// balance and gas price on two nodes → show the words and wait for approval → sign → check the signature → send →
// confirm on a second node. Only the key differs: here it is a SoftwareKey (or any TxKey); on the phone, the chip.
//
// Apps reach `describe` and `request`, which accept only transfers and calls to other accounts. Key changes, contract
// installs and calls on the user's own account go through `run`, which only the security layer itself uses.
import type { PrivateLegRecord } from "./private-route.ts";
import { keyHandle } from "./key-handle.ts";
import { base64ToBytes, bytesToBase64 } from "@fastnear/utils";
import { sha256 } from "@noble/hashes/sha2.js";
import { signatureIsValid, type SheetRequest } from "./device-key.ts";
import { ProblemError } from "./problem.ts";
import { readableWords, type AccountInfo, type AccountKeyInfo, type BoundIntent, type PlainWords, type Signer, type TxOutcome, type TxRequest } from "./signer.ts";
import type { Block, Chain, ChainKey, SendResult } from "./chain.ts";
import { codeOf, explorerUrl, txHashOf } from "./chain.ts";
import { STRICTEST_METHODS, gatherModuleFacts } from "./account-modules.ts";
import { checkCoins, gatherCoinFacts } from "./coins.ts";
import { checkBoundIntent, checkIntents, gatherIntentsFacts, oneClickStatus, paidAddresses, type IntentKind } from "./intents.ts";
import type { OneClickLookup, SendPayout } from "./intents.ts";
import { ACCOUNT_POLICY, RECOVERY_POLICY, RELEASE_10, isAccountPolicy, isRecoveryPolicy, isSecondDeviceMethods, levelWords, policyVersion } from "./known-contracts.ts";
import type { PolicyLevel } from "./known-contracts.ts";
import { securityProblems } from "./security-problems.ts";
import { sheetSummary } from "./sheet-summary.ts";
import { MAX_GAS, RequestError, actionsFromRequest, sameTransaction, serialize, signedBase64 } from "./tx-build.ts";
import type { CoreAction, UnsignedTx } from "./tx-build.ts";
import { DecodeError, decodeTransaction } from "./tx-decode.ts";
import type { DecodedAction, DecodedTx } from "./tx-decode.ts";
import { availableYocto } from "./near-available.ts";
import { bandsCountFewCoins, savedEveryCoinRules } from "./every-coin.ts";
import { plainWords, plainWordsMany, sentToOf } from "./words.ts";

/** Anything that can sign a NEAR transaction hash: the chip key, a SoftwareKey, or a throwaway setup key. */
export interface TxKey {
  readonly publicKey: string;
  /** Where the private key lives, when the key knows it ("secure-chip" for the phone's chip key; an AccountKey does). */
  readonly kind?: "secure-chip" | "recovery-words" | "development";
  signHash(hash: Uint8Array): Promise<Uint8Array>;
  /** A key with its own sheet (AccountKey.signOnSheet): it is handed the bytes and the words shown, and signs itself. */
  signOnSheet?(request: SheetRequest): Promise<Uint8Array | null>;
}

/**
 * For a key with its own sheet (the phone's chip): that sheet is the approval. The shell shows no sheet of its own; it
 * names the words (after any wrapper changed them) and an id through `shown`, so the key's sheet shows exactly those, and
 * holds the next approval until `finished` (the key's sheet closed), so two sheets never overlap. A wrapper that changes
 * the words passes this on.
 */
export interface SheetNext {
  native: true;
  shown(words: PlainWords, id: string): void;
  finished: Promise<void>;
}

/** Shows the words to the person and resolves true only if they approved. */
export type Approve = (words: PlainWords, next?: SheetNext) => Promise<boolean>;

export interface DevSignerOptions {
  accountId: string;
  chain: Chain;
  key: TxKey;
  approve: Approve;
  /** Accounts this device has sent to before (for the first-time warning). Updated after each landed transfer. */
  knownRecipients?: Set<string>;
  /** Called when a new recipient is added, so the caller can store the list. */
  onNewRecipient?: (accountId: string) => void;
  /** Who the account has sent NEAR to, from its own record on chain (an index; words only, never for signing): read once,
   *  the first time a send's receiver isn't known here, so a send from another device or before a restore is never
   *  "first time" (grade 02f, item 4). */
  pastRecipients?: () => Promise<Iterable<string>>;
  /** Looks up 1Click quotes by deposit address (mainnet payments). Default: 1Click's public status endpoint. */
  oneClick?: OneClickLookup;
  /** Quotes this core asked for itself, by deposit address: read for a plain coin transfer to a 1Click address. */
  ownQuote?: OneClickLookup;
  /** A Move's Private leg joined to a move into Private, by its deposit address, from the core's own record (subwallets
   *  privateLeg): the fill's sheet says it beside the Safe's leg. */
  privateLeg?: (depositAddress: string) => Promise<PrivateLegRecord | null>;
  /** The core's own record of what its quote doors asked a deposit address for (a Safe swap, a move into an own wallet):
   *  a request paying one is under that tag (BoundIntent), whatever the app sent. Null: an address it never asked. */
  intentOf?: (depositAddress: string) => Promise<IntentKind | null>;
  /** A Send's payout joined to a move into Private, by that move in's deposit address, as the core read it from 1Click's
   *  signed quote (subwallets sendPayout): a Send's fill sheet says it. */
  sendPayout?: (depositAddress: string) => Promise<SendPayout | null>;
  /** Release 5 on: the level the contract really gives a change to the rules or keys (its floor, its set-up steps). */
  changeLevel?: (method: string, band: PolicyLevel, block: Block) => Promise<PolicyLevel>;
  /** The key a 1Click quote must be signed with. Default: 1Click's own; tests sign their quotes with a test key. */
  quoteKey?: string;
  /** The account's own separate wallets, address → name ("your Solana trading wallet"), read when a request is shown. */
  ownWallets?: () => Promise<Map<string, string>>;
  /** NEAR in dollars for the sheet's words (fee and limits in $, D8); null or failing: NEAR alone. Never for signing. */
  nearUsd?: () => Promise<number | null>;
}

const REQUESTERS: readonly string[] = ["wallet", "pay", "trade", "extension", "browser", "social", "agent", "earn", "chat", "security"];

/**
 * Methods ZeroFee never calls, on any contract. On intents.near: registering a key could let that key move the money,
 * and a classical one would reopen the quantum hole; disabling predecessor auth would lock a post-quantum account (which
 * has no intents keys) out of its own balance.
 */
const NEVER_CALLED = new Set(["add_public_key", "remove_public_key", "disable_auth_by_predecessor_id"]);

/** One receiver and its steps. A request has one; a chain (TxRequest.then) has several. */
interface Group {
  receiverId: string;
  actions: CoreAction[];
  /** The asking app's words for where the money goes on after this (TxRequest.onward), on the request's last group. */
  onward?: string;
  /** Whom the person entered to pay (TxRequest.payee), on every group of the request: 1Click quotes are pinned to it. */
  payee?: { recipient: string; recipientType: string };
  /** A Move's fill (TxRequest.moveFill), on every group of the request: its sheet says the legs (the core's own figures). */
  moveFill?: true;
  /** The core's own tag (BoundIntent), on every group: set only by request()/describe()'s second argument, never by
   *  fromApp (an app's request can't carry one). */
  intent?: BoundIntent;
  /** A Send's fill (TxRequest.sendFill), on every group of the request: its sheet says the payout (the core's own record). */
  sendFill?: true;
}

interface Prepared {
  tx: UnsignedTx;
  bytes: Uint8Array;
  words: PlainWords;
  /** Whom it sends to (NEAR or any coin, words.ts sentToOf), read from the bytes: kept in the past-sends list once it lands. */
  sentTo: string[];
}

/** How long a sheet waits for the account's record of sends after its own reads are in (grade 02g, G18). */
const PAST_GRACE_MS = 400;

export class DevSigner implements Signer {
  readonly accountId: string;
  private readonly chain: Chain;
  private readonly key: TxKey;
  private readonly approve: Approve;
  private readonly known: Set<string>;
  private readonly pastRecipients?: () => Promise<Iterable<string>>;
  /** The chain's record was read into `known` (the warning then says "before", not "from this device before"). */
  private pastRead = false;
  /** The one read of the account's record of sends, shared by every sheet while it's under way (grade 02g, G18: each
   *  sheet waited up to 3 s for its own read, 4.97 s for the first Send sheet at 4x CPU). */
  private past: Promise<string[] | null> | null = null;
  private readonly onNewRecipient?: (accountId: string) => void;
  private readonly oneClick: OneClickLookup;
  private readonly quoteKey: string | undefined;
  private readonly ownQuote: OneClickLookup | undefined;
  private readonly privateLeg: DevSignerOptions["privateLeg"];
  private readonly intentOf: DevSignerOptions["intentOf"];
  private readonly sendPayout: DevSignerOptions["sendPayout"];
  private readonly changeLevel: DevSignerOptions["changeLevel"];
  private readonly ownWallets?: () => Promise<Map<string, string>>;
  private readonly nearUsd?: () => Promise<number | null>;
  /** One signature at a time, so two requests never pick the same nonce. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: DevSignerOptions) {
    this.accountId = options.accountId;
    this.chain = options.chain;
    this.key = options.key;
    this.approve = options.approve;
    this.known = options.knownRecipients ?? new Set();
    this.pastRecipients = options.pastRecipients;
    this.onNewRecipient = options.onNewRecipient;
    this.oneClick = options.oneClick ?? oneClickStatus;
    this.quoteKey = options.quoteKey;
    this.ownQuote = options.ownQuote;
    this.privateLeg = options.privateLeg;
    this.intentOf = options.intentOf;
    this.sendPayout = options.sendPayout;
    this.changeLevel = options.changeLevel;
    this.ownWallets = options.ownWallets;
    this.nearUsd = options.nearUsd;
  }

  /**
   * Reads the account's record of sends once, in the background (the core starts it soon after unlock), so the first
   * sheet to a new name doesn't wait for it. A failed read is dropped, and the next sheet asks again.
   */
  warmPast(): void {
    if (this.past || this.pastRead || !this.pastRecipients) return;
    const read = this.pastRecipients().then((r) => [...r]).catch(() => null);
    this.past = read;
    void read.then((r) => {
      if (r) {
        for (const x of r) this.known.add(x);
        this.pastRead = true;
      } else if (this.past === read) this.past = null;
    });
  }

  /** The account read under way, by block: callers asking at once (Wallet, Earn, the hub) share one read (N1). */
  private reading: { hash: string; info: Promise<AccountInfo> } | null = null;

  async account(): Promise<AccountInfo> {
    const block = await this.chain.commonBlock();
    if (this.reading?.hash === block.hash) return this.reading.info;
    const info = this.accountAt(block);
    const mine = { hash: block.hash, info };
    this.reading = mine;
    void info.catch(() => undefined).finally(() => {
      if (this.reading === mine) this.reading = null;
    });
    return info;
  }

  private async accountAt(block: Block): Promise<AccountInfo> {
    // The account and its keys first (a node takes four reads at once), then the recovery reads behind them.
    const reads = Promise.all([this.chain.account(this.accountId, block), this.chain.accessKeys(this.accountId, block)]);
    warmRecovery(this.chain, this.accountId, block);
    const [acct, keys] = await reads;
    if (!acct) throw new ProblemError(securityProblems.keyMissing());
    const mine = handleOf(this.key.publicKey);
    return {
      accountId: this.accountId,
      network: this.chain.network,
      keys: keys.map((k) => keyInfo(k, this.accountId, mine, this.key.kind)),
      rules: isAccountPolicy(codeOf(acct), this.chain.network),
      recovery: await recoveryState(this.chain, this.accountId, codeOf(acct)!, block),
    };
  }

  async describe(request: TxRequest, intent?: BoundIntent): Promise<PlainWords> {
    return (await this.prepare(tagged(this.fromApp(request), intent), hintOf(request))).words;
  }

  async request(request: TxRequest, intent?: BoundIntent): Promise<TxOutcome> {
    let groups: Group[];
    try {
      groups = tagged(this.fromApp(request), intent);
    } catch (e) {
      return asOutcome(e);
    }
    // D146: the words say which app asked (forApps stamps `from`; never the app's own word), so the sheet shows only
    // while that app is on screen
    const asker = typeof request?.from === "string" && /^[a-z]{1,20}$/.test(request.from) && request.from !== "security" ? request.from : undefined;
    return this.queued(groups, hintOf(request), asker ? (w, next) => this.approve({ ...w, asker }, next) : this.approve);
  }

  /** The whole pipeline, for any steps. Security-layer use only (onboarding, recovery, key changes). */
  run(receiverId: string, actions: CoreAction[], hint?: string, approve: Approve = this.approve): Promise<TxOutcome> {
    return this.queued([{ receiverId, actions }], hint, approve);
  }

  private queued(groups: Group[], hint: string | undefined, approve: Approve): Promise<TxOutcome> {
    const next = this.queue.then(() => this.signAndSend(groups, hint, approve));
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Check an app's request (and any chained receivers) and turn it into steps. Throws ProblemError. */
  private fromApp(request: TxRequest): Group[] {
    const asked = [{ receiverId: request?.receiverId, actions: request?.actions }, ...(Array.isArray(request?.then) ? request.then : [])];
    if (asked.length > 4) throw new ProblemError(securityProblems.requestInvalid("A request can chain at most four receivers."));
    const groups = asked.map((g): Group => {
      let actions: CoreAction[];
      try {
        actions = actionsFromRequest({ ...request, receiverId: g?.receiverId, actions: g?.actions } as TxRequest);
      } catch (e) {
        if (e instanceof RequestError) throw new ProblemError(securityProblems.requestInvalid(e.message));
        throw e;
      }
      if (g.receiverId === this.accountId && (asked.length > 1 || actions.some((a) => a.kind === "call"))) {
        throw new ProblemError(securityProblems.requestNotAllowed("Apps can't change your account's own rules."));
      }
      if (actions.some((a) => a.kind === "call" && NEVER_CALLED.has(a.method))) {
        throw new ProblemError(securityProblems.requestNotAllowed("ZeroFee never changes how another app knows your account."));
      }
      return { receiverId: g.receiverId, actions };
    });
    const onward = onwardOf(request);
    if (onward) groups[groups.length - 1]!.onward = onward;
    const payee = payeeOf(request);
    if (payee) for (const g of groups) g.payee = payee;
    // a marker only: the figures the sheet says are the bytes' and the core's own (QA's MUST, 5 Nov)
    if (request?.moveFill === true) for (const g of groups) g.moveFill = true;
    if (request?.sendFill === true) for (const g of groups) g.sendFill = true;
    return groups;
  }

  /**
   * Ask now, at `block`, for the reads prepare() makes for these steps, so they go out together (speed, 2 Nov: they went
   * one after another, three round trips on two nodes before every sheet). The same reads at the same block on the same
   * two nodes: prepare() asks each again where it always did and gets this one (NodePace shares a read pinned to a block),
   * and decides from it exactly as before. A read nothing ends up needing (the account has no rules, say) is dropped.
   * Public for a caller that knows its steps' receiver before it has built them (Protection's Save reads prices first).
   */
  warm(groups: { receiverId: string; actions: CoreAction[] }[], block: Block): void {
    const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);
    quiet(this.chain.accessKey(this.accountId, this.key.publicKey, block));
    quiet(this.chain.account(this.accountId, block));
    quiet(this.chain.gasPrice(block));
    const many = groups.length > 1;
    if (many || groups[0].receiverId !== this.accountId) {
      // What the protection will do with it (asked only on an account with rules) and, for a coin, what the words read.
      try {
        quiet(many ? this.chain.view(this.accountId, "level_for_many", { groups: groups.map((g) => executeArgs(g.receiverId, g.actions)) }, block) : this.chain.view(this.accountId, "level_for", executeArgs(groups[0].receiverId, groups[0].actions), block));
      } catch {
        // Steps the rules can't carry: prepare() refuses them itself.
      }
      for (const g of groups) if (g.receiverId !== this.accountId) quiet(this.chain.account(g.receiverId, block));
    } else if (groups[0].actions.some((a) => a.kind === "call" && STRICTEST_METHODS.has(a.method))) {
      // A change to the rules: the rules as they stand, and the recovery delay its floor is counted from.
      quiet(this.chain.view(this.accountId, "protection", {}, block));
      if (this.changeLevel) quiet(this.chain.view(this.accountId, "delay_seconds", {}, block));
    }
  }

  private async prepare(groups: Group[], hint?: string): Promise<Prepared> {
    // The NEAR price for the words only (D8, kept a minute): asked at once, beside the reads, not after them.
    const nearUsdP = this.nearUsd ? this.nearUsd().catch(() => null) : Promise.resolve(null);
    // The account's record of sends, for the first-time warning (below): asked at once too, never a round trip of its own.
    // Any step to another account may send a coin (its recipient is inside the call), so any of them asks for the record.
    const unknown = !this.pastRead && groups.some((g) => g.receiverId !== this.accountId);
    if (unknown) this.warmPast();
    const block = await this.chain.commonBlock();
    this.warm(groups, block);
    const [key, acct, gasPrice] = await Promise.all([
      this.chain.accessKey(this.accountId, this.key.publicKey, block),
      this.chain.account(this.accountId, block),
      this.chain.gasPrice(block),
    ]);
    if (!key || !acct) throw new ProblemError(securityProblems.keyMissing());
    const many = groups.length > 1;
    if (many && policyVersion(codeOf(acct), this.chain.network) < 2) {
      throw new ProblemError(securityProblems.requestNotAllowed("More than one step in one approval needs your account's rules, version 2."));
    }
    // With the account contract, the phone's key can't send anything itself: everything to another account goes
    // through the contract's execute() (or execute_many() for a chain), so the person's protection applies on-chain.
    const wrapped = isAccountPolicy(codeOf(acct), this.chain.network) && (many || groups[0].receiverId !== this.accountId);
    const txActions = !wrapped ? groups[0].actions : many ? [executeManyCall(groups)] : [executeCall(groups[0].receiverId, groups[0].actions)];
    const tx: UnsignedTx = { signerId: this.accountId, publicKey: this.key.publicKey, nonce: key.nonce + 1n, receiverId: wrapped ? this.accountId : groups[0].receiverId, blockHash: block.hash, actions: txActions };
    const bytes = serialize(tx);
    let decoded;
    try {
      decoded = decodeTransaction(bytes);
    } catch (e) {
      if (e instanceof DecodeError) throw new ProblemError(securityProblems.decodeUnreadable());
      throw e;
    }
    if (!sameTransaction(decoded, tx)) throw new ProblemError(securityProblems.decodeMismatch());
    // What the person approves is read back out of the signed bytes: for execute(), the steps inside it.
    const shown = !wrapped ? [decoded] : many ? unwrapExecuteMany(decoded) : [unwrapExecute(decoded)];
    if (!shown || shown.length !== groups.length || shown.some((d, i) => !d || !sameTransaction(d, { ...tx, receiverId: groups[i].receiverId, actions: groups[i].actions }))) {
      throw new ProblemError(securityProblems.decodeMismatch());
    }
    // The core's own tag (audit, 5 Nov): a core caller's, or its quote doors' record of an address this pays; read beside
    // the facts below, never from the app's request
    const tagP = this.tagOf(groups, shown as DecodedTx[]);
    void tagP.catch(() => undefined);
    // Known contracts: read what their words need; refuse spending coins the account doesn't have, plain NEAR to a
    // staking pool, and a partner payment whose terms don't match the bytes.
    const parts = [];
    let boundPaid = 0;
    const sentTo = new Set<string>();
    let quoted = false;
    const nearUsd = await nearUsdP;
    // A receiver this device hasn't sent to: the account's own record (read once, shared, started with the reads above),
    // so the first-time warning is never shown for someone the chain lists a send to (grade 02f). Waited for only a
    // moment past the sheet's own reads (G18): not in by then, the warning says "from this device", which is true.
    // Words only: what is signed never depends on it.
    if (unknown && this.past && !this.pastRead) await Promise.race([this.past, new Promise<null>((r) => setTimeout(() => r(null), PAST_GRACE_MS))]);
    for (const g of shown as DecodedTx[]) {
      const [intents, coins, modules, own] = await Promise.all([
        gatherIntentsFacts(g, this.chain, block, this.oneClick, this.quoteKey, this.ownQuote),
        gatherCoinFacts(g, this.chain, block),
        gatherModuleFacts(g, this.chain, block),
        this.ownWallets ? this.ownWallets().catch(() => new Map<string, string>()) : Promise.resolve(new Map<string, string>()),
      ]);
      intents.ownWallets = own;
      const payee = groups[shown.indexOf(g)]?.payee;
      if (payee) intents.payee = payee;
      if (groups[shown.indexOf(g)]?.moveFill) {
        // the Safe's leg is the bytes' own (checkIntents ties them to the quote); Private's, the core's own record of the
        // pocket's share it signed, joined to this very move in; none: left out
        const deps = [...intents.quotes.keys()];
        const leg = deps.length === 1 && this.privateLeg ? await this.privateLeg(deps[0]!).catch(() => null) : null;
        // and what the payment out of Private pays and to whom (the ruling, the audit and the copy review, 5 Nov: the title is the Move's figure)
        const units = (u: string | undefined) => (typeof u === "string" && /^\d{1,40}$/.test(u) ? u : undefined);
        intents.moveFill = leg ? { privateTokenId: leg.tokenId, ...(units(leg.units) ? { privateUnits: leg.units } : {}), ...(units(leg.payUnits) ? { payUnits: leg.payUnits } : {}), ...(typeof leg.recipient === "string" ? { payee: leg.recipient, payeeOwn: leg.own === true } : {}) } : {};
      }
      if (groups[shown.indexOf(g)]?.sendFill) {
        // a Send's fill (product decision, 5 Nov; QA's MUST 1, bind before you sign): the payout is the one the core
        // read from 1Click's signed quote when the pocket's payment was joined to this very move in; none, or one that
        // doesn't fit it (another coin, or more than it promises to bring): refused here, before Face ID
        const deps = [...intents.quotes.keys()];
        const q = deps.length === 1 ? intents.quotes.get(deps[0]!) : undefined;
        const out = q && this.sendPayout ? await this.sendPayout(deps[0]!).catch(() => null) : null;
        // its words' code loads only here (send-fill.ts), never in Home's first load
        const fill = await import("./send-fill.ts");
        if (!q || !out || !fill.sendPayoutFits(out, q)) throw new ProblemError(securityProblems.sendUnbound());
        await fill.sendPayoutCoin(intents, out, this.chain, block);
        // the audit's ruling (5 Nov): a payout coin the core can't name with its decimals stops here, before the sheet and Face ID
        if (!fill.sendPayoutNamed(intents, out)) throw new ProblemError(securityProblems.sendCoinUnknown());
        const words = fill.sendFillWords(q, out, intents);
        if (!words) throw new ProblemError(securityProblems.sendUnbound());
        intents.sendFill = { ...out, ...words };
      }
      const tag = await tagP;
      // a Send's fill is a move into Private the core's own door asked (subwallet.private.quoteIn → intentOf "move"): no
      // other tag, and never none, so it always passes checkBoundIntent below as well as its payout binding above
      if (groups[shown.indexOf(g)]?.sendFill && tag?.kind !== "move") throw new ProblemError(securityProblems.intentChanged("move"));
      try {
        checkIntents(g, intents, this.accountId);
      } catch (e) {
        // under a Swap's or a Move's tag, a quote that doesn't match is that swap or move changed (rule 8's one line)
        if (tag && e instanceof ProblemError && e.problem.code === "security.quote.mismatch") throw new ProblemError(securityProblems.intentChanged(tag.kind));
        throw e;
      }
      if (tag) boundPaid += checkBoundIntent(g, intents, this.accountId, tag.kind, tag.targets);
      checkCoins(g, coins);
      quoted ||= intents.quotes.size > 0;
      for (const a of g.actions) { const to = sentToOf(a, g, intents); if (to) sentTo.add(to); }
      parts.push({ tx: g, ctx: { network: this.chain.network, balanceYocto: acct.balanceYocto, availableYocto: availableYocto(acct), gasPriceYocto: gasPrice, knownRecipients: this.known, ...(this.pastRead ? { recipientsFromChain: true } : {}), intents, coins, modules, hint, feeFrom: decoded, nearUsd, ...(groups.at(-1)?.onward ? { onward: groups.at(-1)!.onward } : {}) } });
    }
    const tag = await tagP;
    if (tag && boundPaid === 0) throw new ProblemError(securityProblems.intentChanged(tag.kind));
    const words = readableWords(many ? plainWordsMany(parts, decoded, parts[0].ctx) : plainWords(parts[0].tx, parts[0].ctx));
    if (wrapped) {
      // Say before Face ID what the protection will do with it: the contract's own answer, on two nodes.
      const level = (await (many
        ? this.chain.view(this.accountId, "level_for_many", { groups: groups.map((g) => executeArgs(g.receiverId, g.actions)) }, block)
        : this.chain.view(this.accountId, "level_for", executeArgs(groups[0].receiverId, groups[0].actions), block))) as PolicyLevel | null;
      if (!level) throw new ProblemError(securityProblems.nodesUnreachable());
      // A partner's price lasts about a minute: held any longer, the payment could never go through.
      // Rules saved before they counted every coin (H01: the first band names NEAR alone, or NEAR, USDC and USDT) hold
      // any wNEAR or other coin as a big payment: a Top up paid with NEAR always waits (mainnet 2 Nov, a test
      // release-4 account). Then the one next step is Protection's "Count every coin", the same limits saved again.
      if (quoted && level !== "FaceId") {
        // Rules that count every coin may already be saved and held (a test account had two): then finishing them is the
        // step, never a new save.
        const [bands, held] = await Promise.all([
          this.chain.view(this.accountId, "protection", {}, block).catch(() => null),
          this.chain.view(this.accountId, "waiting_requests", {}, block).catch(() => null),
        ]);
        const old = bandsCountFewCoins(bands);
        // a Send from the Safe (its fill): the day's limit and what is left today, from the contract's own band state
        if (!old && groups.some((g) => g.sendFill)) {
          const fill = await import("./send-fill.ts");
          const room = fill.sendRoom(bands, await this.chain.view(this.accountId, "spent_today", {}, block).catch(() => null));
          if (room) throw new ProblemError(securityProblems.sendOverLimit(room.limitUsd, room.leftUsd, fill.SEND_FLOOR_USD));
        }
        throw new ProblemError(securityProblems.quoteCantWait(old, old ? savedEveryCoinRules(held) : null));
      }
      words.protection = protectionOf(level, policyVersion(codeOf(acct), this.chain.network) >= 5);
      // before the closing "From …. Fee: …" line; a bare sheet (Home's Swap and Move, audit S1) has none: after its lines
      words.lines.splice(/Fee: at most/.test(words.lines.at(-1) ?? "") ? words.lines.length - 1 : words.lines.length, 0, words.protection.text);
    } else if (isAccountPolicy(codeOf(acct), this.chain.network) && groups[0].receiverId === this.accountId && groups[0].actions.some((a) => a.kind === "call" && STRICTEST_METHODS.has(a.method))) {
      // A change that loosens the rules goes through the strictest protection: say so before Face ID.
      const bands = (await this.chain.view(this.accountId, "protection", {}, block)) as { level: PolicyLevel }[] | null;
      const band = bands?.at(-1)?.level;
      if (!band) throw new ProblemError(securityProblems.nodesUnreachable());
      // Release 5 on: what the contract will really do with this change (its floor, 3 days on the default 48-hour account, set-up steps, audit F1).
      const v5 = policyVersion(codeOf(acct), this.chain.network) >= 5;
      const method = groups[0].actions.find((a) => a.kind === "call" && STRICTEST_METHODS.has(a.method));
      const level = v5 && method?.kind === "call" && this.changeLevel ? await this.changeLevel(method.method, band, block) : band;
      words.protection = protectionOf(level, v5);
      // before the closing "From …. Fee: …" line; a bare sheet (Home's Swap and Move, audit S1) has none: after its lines
      words.lines.splice(/Fee: at most/.test(words.lines.at(-1) ?? "") ? words.lines.length - 1 : words.lines.length, 0, words.protection.text);
    }
    return { tx, bytes, words, sentTo: [...sentTo] };
  }

  /**
   * The tag this request is under, and the addresses it is bound to: a core caller's (request()'s second argument), or
   * the core's own record (intentOf) of an address the request pays. Two kinds at once: refused (a swap is never a move).
   */
  private async tagOf(groups: Group[], shown: DecodedTx[]): Promise<{ kind: IntentKind; targets: Set<string> } | null> {
    const paid = new Set(shown.flatMap(paidAddresses));
    const given = groups[0]?.intent;
    if (given) return { kind: given.kind, targets: given.depositAddress ? new Set([given.depositAddress]) : paid };
    if (!this.intentOf || paid.size === 0) return null;
    const asked = (await Promise.all([...paid].map(async (d) => [d, await this.intentOf!(d)] as const))).filter((x): x is readonly [string, IntentKind] => x[1] === "swap" || x[1] === "move");
    if (asked.length === 0) return null;
    const kind = asked[0]![1];
    if (asked.some(([, k]) => k !== kind)) throw new ProblemError(securityProblems.intentChanged(kind));
    return { kind, targets: new Set(asked.map(([d]) => d)) };
  }

  private async signAndSend(groups: Group[], hint: string | undefined, approve: Approve): Promise<TxOutcome> {
    let prepared: Prepared;
    try {
      prepared = await this.prepare(groups, hint);
    } catch (e) {
      return asOutcome(e);
    }
    const { tx, bytes, words } = prepared;
    // A key with its own sheet (the phone's chip) is approved on that sheet: it shows the words and signs only these
    // bytes there. The shell's approve names the words and holds its next sheet until this one has closed.
    const onSheet = this.key.signOnSheet?.bind(this.key);
    let shown = { words, id: "" };
    let closed = () => {};
    const next: SheetNext | undefined = onSheet ? { native: true, shown: (w, id) => (shown = { words: w, id }), finished: new Promise<void>((r) => (closed = r)) } : undefined;
    const hash = sha256(bytes);
    let signature: Uint8Array;
    try {
      // a named refusal (the web's check that the person is there didn't pass: D143) says why; any other failure is a no
      const yes = await approve(words, next).catch((e: unknown) => (e instanceof ProblemError ? e : false));
      if (yes instanceof ProblemError) return { status: "problem", problem: yes.problem };
      if (!yes) return { status: "declined" };
      if (onSheet) {
        const signed = await onSheet({ id: shown.id, words: shown.words, bytes, summary: sheetSummary(tx) });
        if (!signed) return { status: "declined" };
        signature = signed;
      } else {
        signature = await this.key.signHash(hash);
      }
    } catch {
      // On the phone this is Face ID cancelled or failed: the person didn't sign, so nothing happened.
      return { status: "declined" };
    } finally {
      closed();
    }
    if (this.key.publicKey.startsWith("ml-dsa-65:") && !signatureIsValid(hash, signature, this.key.publicKey)) {
      return { status: "problem", problem: securityProblems.signatureInvalid() };
    }

    const txHash = txHashOf(bytes);
    const link = explorerUrl(this.chain.network, txHash);
    let result: SendResult;
    try {
      result = await this.chain.send(signedBase64(tx, signature), txHash, this.accountId);
    } catch (e) {
      if (e instanceof ProblemError) return { status: "problem", problem: e.problem };
      // Signed and possibly sent: never claim it didn't happen.
      return { status: "problem", problem: securityProblems.sendUnconfirmed(link) };
    }
    if (result.status === "failed") {
      // The contract's cap on payments counted in 24 hours: nothing was sent; every one counted now has aged out a day on.
      if (/too many payments in the last 24 hours/.test(result.failure ?? "")) {
        const until = new Date(Date.now() + 86_400_000);
        return { status: "problem", problem: securityProblems.paymentsMany(until.toISOString(), `${until.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} tomorrow`) };
      }
      return { status: "problem", problem: securityProblems.sendFailed(link) };
    }
    // Accepted at the top but a later step failed: never "done".
    if (result.partly) return { status: "problem", problem: securityProblems.sendPartly(link) };
    // The account contract answers whether it ran now or is held (waiting, or for the second device).
    const held = waitingOf(result.value);
    if (held) return { status: "waiting", txHash, explorerUrl: link, ...held };
    // Everyone it sent to, NEAR or a coin: the next sheet to them isn't "first time"
    for (const to of prepared.sentTo) {
      if (!this.known.has(to)) {
        this.known.add(to);
        this.onNewRecipient?.(to);
      }
    }
    return { status: "done", txHash, explorerUrl: link };
  }
}

/** Extra gas for execute() itself, on top of the gas its steps carry. */
const EXECUTE_GAS = 50_000_000_000_000n;
/** The most a single execute()'s steps may carry in all (the contract's MAX_CHAIN_GAS, release 8, RS-1). */
const MAX_REQUEST_GAS = 250_000_000_000_000n;
/** Gas for each link of a chain (the contract's CHAIN_LINK_GAS). */
const CHAIN_LINK_GAS = 15_000_000_000_000n;

/** The steps as the account contract's JSON expects them ({"Transfer":…} / {"FunctionCall":…}). */
export function executeArgs(receiverId: string, actions: CoreAction[]): Record<string, unknown> {
  const steps = actions.map((a) => {
    if (a.kind === "transfer") return { Transfer: { deposit: a.yocto.toString() } };
    if (a.kind === "call") return { FunctionCall: { method_name: a.method, args: bytesToBase64(a.args), deposit: a.depositYocto.toString(), gas: a.gas.toString() } };
    throw new ProblemError(securityProblems.requestNotAllowed("Only payments and calls go through the account's rules."));
  });
  return { receiver_id: receiverId, steps };
}

/** One call to the account's own execute_many(): several receivers, each run only if the one before succeeded. */
function executeManyCall(groups: Group[]): CoreAction {
  const inner = groups.reduce((sum, g) => sum + g.actions.reduce((s2, a) => s2 + (a.kind === "call" ? a.gas : 0n), 0n) + CHAIN_LINK_GAS, 0n);
  const gas = inner + EXECUTE_GAS > MAX_GAS ? MAX_GAS : inner + EXECUTE_GAS;
  const args = { groups: groups.map((g) => executeArgs(g.receiverId, g.actions)) };
  return { kind: "call", method: "execute_many", args: new TextEncoder().encode(JSON.stringify(args)), gas, depositYocto: 0n };
}

/** The groups inside an execute_many() call, decoded from the signed bytes. */
export function unwrapExecuteMany(outer: DecodedTx): DecodedTx[] | null {
  const call = outer.actions[0];
  if (outer.actions.length !== 1 || call.kind !== "call" || call.method !== "execute_many" || outer.receiverId !== outer.signerId) return null;
  try {
    const args = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(call.args));
    if (!Array.isArray(args?.groups) || args.groups.length === 0) return null;
    const out: DecodedTx[] = [];
    for (const g of args.groups) {
      const one = unwrapExecute({ ...outer, actions: [{ ...call, method: "execute", args: new TextEncoder().encode(JSON.stringify(g)) }] });
      if (!one) return null;
      out.push(one);
    }
    return out;
  } catch {
    return null;
  }
}

/** One call to the account's own execute(), carrying the steps for another account. */
function executeCall(receiverId: string, actions: CoreAction[]): CoreAction {
  const inner = actions.reduce((sum, a) => sum + (a.kind === "call" ? a.gas : 0n), 0n);
  // Release 8 (RS-1): the contract refuses a request whose steps carry more than 250 Tgas in all (it could never run).
  if (inner > MAX_REQUEST_GAS) throw new ProblemError(securityProblems.requestNotAllowed("This request is too big for one payment. Split it into smaller ones."));
  const gas = inner + EXECUTE_GAS > MAX_GAS ? MAX_GAS : inner + EXECUTE_GAS;
  return { kind: "call", method: "execute", args: new TextEncoder().encode(JSON.stringify(executeArgs(receiverId, actions))), gas, depositYocto: 0n };
}

/** The steps inside an execute() call, decoded from the signed bytes: what the person actually approves. */
export function unwrapExecute(outer: DecodedTx): DecodedTx | null {
  const call = outer.actions[0];
  if (outer.actions.length !== 1 || call.kind !== "call" || call.method !== "execute" || outer.receiverId !== outer.signerId) return null;
  try {
    const args = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(call.args));
    if (typeof args?.receiver_id !== "string" || !Array.isArray(args.steps)) return null;
    const units = (v: unknown) => (typeof v === "string" && /^\d{1,39}$/.test(v) ? BigInt(v) : null);
    const actions: DecodedAction[] = [];
    for (const step of args.steps) {
      if (step?.Transfer) {
        const yocto = units(step.Transfer.deposit);
        if (yocto === null) return null;
        actions.push({ kind: "transfer", yocto });
      } else if (step?.FunctionCall && typeof step.FunctionCall.method_name === "string") {
        const f = step.FunctionCall;
        const gas = units(f.gas);
        const depositYocto = units(f.deposit);
        if (gas === null || depositYocto === null || typeof f.args !== "string") return null;
        actions.push({ kind: "call", method: f.method_name, args: base64ToBytes(f.args), gas, depositYocto });
      } else return null;
    }
    return { ...outer, receiverId: args.receiver_id, actions };
  } catch {
    return null;
  }
}

function protectionOf(level: PolicyLevel, backupWordsStop = false): NonNullable<PlainWords["protection"]> {
  const text = levelWords(level, backupWordsStop);
  if (level === "FaceId") return { level: "faceid", waitSeconds: 0, text };
  if (level === "Device") return { level: "device", waitSeconds: 0, text };
  if ("Wait" in level) return { level: "wait", waitSeconds: Number(level.Wait.seconds), text };
  return { level: "both", waitSeconds: Number(level.Both.seconds), text };
}

/** The account contract's answer, when it held the request instead of running it. */
function waitingOf(value: string | null): { id: string; readyAtIso: string; needsSecondDevice: boolean } | null {
  if (!value) return null;
  try {
    const out = JSON.parse(new TextDecoder().decode(base64ToBytes(value)));
    if (out?.done !== false || out.id == null) return null;
    return { id: String(out.id), readyAtIso: new Date(Number(BigInt(out.ready_at_ns ?? 0) / 1_000_000n)).toISOString(), needsSecondDevice: out.needs_device === true };
  } catch {
    return null;
  }
}

/** TxRequest.onward as the asking app's words: "Wallet says: it goes on to your SOL wallet, privately." Plain words only
 *  (letters, digits, spaces, $ . , ' ( ) -), at most 120 characters; anything else is no line at all. */
function onwardOf(request: TxRequest): string | undefined {
  const o = typeof request?.onward === "string" ? request.onward.trim() : "";
  if (!o || o.length > 120 || !/^[A-Za-z0-9 $.,'()-]+$/.test(o)) return undefined;
  const app = REQUESTERS.includes(request.from) && request.from !== "security" ? request.from.charAt(0).toUpperCase() + request.from.slice(1) : "The app";
  return `${app} says: ${o}`;
}

/** TxRequest.payee, only in its one shape: an address of at most 128 plain characters and a known kind of payout. */
function payeeOf(request: TxRequest): { recipient: string; recipientType: string } | undefined {
  const p = request?.payee as { recipient?: unknown; recipientType?: unknown } | undefined;
  if (!p || typeof p.recipient !== "string" || !/^[A-Za-z0-9:._-]{2,128}$/.test(p.recipient)) return undefined;
  if (!["DESTINATION_CHAIN", "INTENTS", "CONFIDENTIAL_INTENTS"].includes(p.recipientType as string)) return undefined;
  return { recipient: p.recipient, recipientType: p.recipientType as string };
}

function hintOf(request: TxRequest): string | undefined {
  const why = typeof request.why === "string" ? request.why.trim().slice(0, 200) : "";
  if (!why) return undefined;
  const app = REQUESTERS.includes(request.from) && request.from !== "security" ? request.from.charAt(0).toUpperCase() + request.from.slice(1) : "The app";
  return `${app} says: ${why}`;
}

export function asOutcome(e: unknown): TxOutcome {
  if (e instanceof ProblemError) return { status: "problem", problem: e.problem };
  if (e instanceof RequestError) return { status: "problem", problem: securityProblems.requestInvalid(e.message) };
  return { status: "problem", problem: securityProblems.unexpected("sign", e) };
}

/** How NEAR lists a key: post-quantum keys by their "ml-dsa-65-hash:…" handle, classical keys as themselves. */
export function handleOf(publicKey: string): string {
  return keyHandle(publicKey);
}

function keyInfo(k: ChainKey, accountId: string, mine: string, mineKind: AccountKeyInfo["kind"] = "development"): AccountKeyInfo {
  return { ...keyRole(k, accountId, mine, mineKind), access: k.permission.kind === "full" ? "full" : "function-call" };
}

function keyRole(k: ChainKey, accountId: string, mine: string, mineKind: AccountKeyInfo["kind"]): AccountKeyInfo {
  const p = k.permission;
  const only = (methods: string[]) => p.kind === "function-call" && p.receiverId === accountId && p.methods.join() === methods.join();
  if (only(RECOVERY_POLICY.recoveryKeyMethods)) return { handle: k.handle, role: "recovery", kind: "recovery-words" };
  // A release-6 second device too (approve and decline only): it's the laptop, never another phone.
  if (p.kind === "function-call" && p.receiverId === accountId && isSecondDeviceMethods(p.methods)) return { handle: k.handle, role: "second-device", kind: "development" };
  // AgentZero's key (agent-door.ts's agentKeyOnChain reads it the same way): never another phone.
  if (p.kind === "function-call" && p.receiverId === accountId && [ACCOUNT_POLICY.agentMethods.join(), RELEASE_10.agentMethods.join()].includes(p.methods.join())) return { handle: k.handle, role: "agent", kind: "development" };
  // Any other function-call key (a session or trading key) is no phone: the contract's role gates refuse it every method.
  // (A device key on a contract account calls the account's own "execute": that one is a phone, as demo-core's isDeviceKey.)
  if (p.kind === "function-call" && k.handle !== mine && !(p.receiverId === accountId && p.methods.includes("execute"))) return { handle: k.handle, role: "session", kind: "development" };
  // Until the second-device policy exists (S1.8), every other full-access key is another phone, e.g. a lost one.
  // The key this device signs with says where it lives (the phone's chip key is "secure-chip"); any other is a phone we know no more about.
  return k.handle === mine ? { handle: k.handle, role: "device", kind: mineKind === "secure-chip" ? "secure-chip" : "development", current: true } : { handle: k.handle, role: "device", kind: "development" };
}

/**
 * Each account's recovery delay, by its contract's code (speed, 2 Nov: it was read on two nodes on every status tick).
 * The contract sets it once, in `new`, and has no method that changes it, so a value two nodes agreed on stays true for
 * that code; other code (an upgrade) is read again.
 */
const DELAYS = new WeakMap<Chain, Map<string, unknown>>();
const delayOf = async (chain: Chain, accountId: string, codeHash: string, block: Block): Promise<unknown> => {
  const kept = DELAYS.get(chain) ?? new Map<string, unknown>();
  DELAYS.set(chain, kept);
  const key = `${accountId} ${codeHash}`;
  if (kept.has(key)) return kept.get(key);
  const delay = await chain.view(accountId, "delay_seconds", {}, block);
  if (Number(delay) > 0) kept.set(key, delay);
  return delay;
};

/**
 * Ask now for the recovery reads an account with today's contract needs, at `block`, while its own state (which says
 * which contract it has) is still on its way (speed, 2 Nov: they waited for it, one round trip more on every open and
 * every watch). recoveryState then asks the same reads and gets these (NodePace shares a read pinned to a block): the
 * same two-node answers, never more requests. Nothing is decided here; a failure is dropped.
 */
export function warmRecovery(chain: Chain, accountId: string, block: Block): void {
  const kept = [...(DELAYS.get(chain)?.keys() ?? [])].some((k) => k.startsWith(`${accountId} `));
  if (!kept) void chain.view(accountId, "delay_seconds", {}, block).catch(() => undefined);
  // Today's contract answers `pending` inside recovery_status (recoveryState): only an older one, once seen, is asked it.
  const older = (VERSIONS.get(chain)?.get(accountId) ?? 7) < 7;
  for (const method of [...(older ? ["pending"] : []), "frozen_until", "recovery_status"]) void chain.view(accountId, method, {}, block).catch(() => undefined);
}

/** The contract version each account last had (its code hash, read on two nodes): which reads warmRecovery asks ahead. */
const VERSIONS = new WeakMap<Chain, Map<string, number>>();

/**
 * The account's recovery rules, if one of ZeroFee's contracts is installed (checked by its code hash, on two nodes).
 * From release 7 the contract's recovery_status is its `pending` and more (lib.rs: both are None without a recovery under
 * way, and it carries the same new_key and ready_at_ns), so `pending` is asked of older contracts only (the read
 * budget, 2 Nov: two node reads less on every account read). Both nodes still answer it, at the same block.
 */
export async function recoveryState(chain: Chain, accountId: string, codeHash: string, block: Block): Promise<AccountInfo["recovery"]> {
  if (!isRecoveryPolicy(codeHash) && !isAccountPolicy(codeHash, chain.network)) return null;
  const version = policyVersion(codeHash, chain.network);
  const versions = VERSIONS.get(chain) ?? new Map<string, number>();
  VERSIONS.set(chain, versions);
  versions.set(accountId, version);
  const [delay, older, frozen, status] = await Promise.all([
    delayOf(chain, accountId, codeHash, block),
    version >= 7 ? null : chain.view(accountId, "pending", {}, block),
    version >= 6 ? chain.view(accountId, "frozen_until", {}, block) : null,
    // Release 7: whether the finish needs a second device of age's yes, whether it has it, and the words-only fallback.
    version >= 7 ? chain.view(accountId, "recovery_status", {}, block) : null,
  ]);
  const pending = version >= 7 ? status : older;
  const readyAtNs = (pending as any)?.ready_at_ns;
  const iso = (ns: unknown) => new Date(Number(BigInt(String(ns)) / 1_000_000n)).toISOString();
  const r7 = status as { needs_device?: boolean; approved?: boolean; fallback_at_ns?: string; can_finish_at_ns?: string } | null;
  // Re-audit 7: the phone's one stop of the move, if it waits (the account's waiting list holds it as CancelRecovery).
  const waiting = readyAtNs && version >= 7 ? ((await chain.view(accountId, "waiting_requests", {}, block)) as { change?: unknown; ready_at_ns?: string }[] | null) : null;
  const stop = (waiting ?? []).find((w) => w.change === "CancelRecovery" || (typeof w.change === "object" && w.change !== null && "CancelRecovery" in w.change));
  return {
    delaySeconds: Number(delay),
    pending: readyAtNs
      ? { readyAtIso: iso(readyAtNs), ...(r7 ? { needsSecondDevice: r7.needs_device === true, approved: r7.approved === true, fallbackAtIso: iso(r7.fallback_at_ns), canFinishAtIso: iso(r7.can_finish_at_ns) } : {}), ...(stop?.ready_at_ns ? { stopAtIso: iso(stop.ready_at_ns) } : {}) }
      : null,
    ...(version >= 6 ? { frozenUntilIso: frozen ? iso(frozen) : null } : {}),
  };
}

/** The core's own tag on every group of a request (BoundIntent: only a core caller passes one; an app's request never
 *  carries it). A tag that isn't a swap or a move is refused, never ignored. */
function tagged(groups: Group[], intent: BoundIntent | undefined): Group[] {
  if (intent === undefined) return groups;
  if (!intent || (intent.kind !== "swap" && intent.kind !== "move") || (intent.depositAddress !== undefined && typeof intent.depositAddress !== "string")) throw new ProblemError(securityProblems.requestInvalid("intent is a swap or a move"));
  const bound: BoundIntent = { kind: intent.kind, ...(intent.depositAddress !== undefined ? { depositAddress: intent.depositAddress } : {}) };
  for (const g of groups) g.intent = bound;
  return groups;
}

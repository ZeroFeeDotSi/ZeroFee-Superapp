// Test doubles for the ledger: 1Click and the deposit bridge replayed from recorded answers (tools/wallet/record-fixtures.ts),
// a stand-in core that answers account.state and device.store, and core's FakeChain with intents.near's views.
import { readFileSync } from "node:fs";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import type { PlainWords, TxOutcome, TxRequest } from "@zerofee/core/signer";
import { FakeChain } from "@zerofee/core/testing/fake-chain";
import { DEPOSIT_BRIDGE, ONE_CLICK } from "../apis.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
export const RECORDED = {
  quotes: fixture("oneclick-dry-quotes.json"),
  tokens: fixture("oneclick-tokens.json"),
  supported: fixture("bridge-supported-tokens.json"),
  addresses: fixture("bridge-deposit-addresses.json"),
};

/** Sample addresses the bridge gave the public account intents.near, by its chain id. */
export const SAMPLE_ADDRESS = {
  sol: RECORDED.addresses.addresses["sol:mainnet SIMPLE"].result.address as string,
  evm: RECORDED.addresses.addresses["eth:8453 SIMPLE"].result.address as string,
  stellar: RECORDED.addresses.addresses["stellar:mainnet MEMO"].result as { address: string; memo: string },
};

export interface ReplayOptions {
  /** Make a service look down. */
  down?: ("1click" | "bridge")[];
  /**
   * B28 fault injection: a service fails as it does in the wild. 521 (its host is down: Cloudflare's page, not JSON),
   * 429 (busy), or "timeout" (no answer: the request's own timeout fires). `relay` is the quote relay (privateQuotes).
   */
  fault?: { service: "oneclick" | "bridge" | "relay"; failure: 521 | 429 | "timeout" };
  /** What the relay's service check answers (its `services`), when there is a relay. */
  health?: Record<string, string>;
  /** Answer deposit_address with this address instead (as if the bridge changed it). */
  addressOverride?: string;
  /** What recent_deposits answers. */
  deposits?: unknown[];
  /** What withdrawal_status answers, by NEAR transaction hash. */
  withdrawals?: Record<string, unknown[]>;
  /** 1Click's status answers, one per call, the last repeating. */
  statuses?: string[];
  /** A real (not dry) quote promises less than the dry one did. */
  worse?: boolean;
  /**
   * The quote relay for Private (D27; its /v0, as the ledger calls it), answering confidentiality "basic" quotes as 1Click does with the partner key:
   * the same coin into Confidential Intents at no fee, at least 99% (as recorded 25 Oct, fixtures/oneclick-private-quotes.json).
   * Built from the request, since 1Click refuses them without the key.
   */
  privateQuotes?: string;
  /** What the relay's /status answers for a confidential quote (bare, without the tag): default SUCCESS. */
  privateStatus?: "SUCCESS" | "REFUNDED" | "FAILED" | "PENDING_DEPOSIT";
}

/** 1Click's generate-intent for a Private payment, recorded 25 Oct (operator-run, nothing signed or submitted). */
/** 1Click's dry quotes for a new account's first NEAR, from USDC on Solana and Base and from Bitcoin (recorded 25 Oct). */
export const STARTS = JSON.parse(readFileSync(new URL("./fixtures/oneclick-start-quotes.json", import.meta.url), "utf8"));
export const GENERATED = JSON.parse(readFileSync(new URL("./fixtures/oneclick-generate-intent.json", import.meta.url), "utf8"));

/** The deposit address a replayed real quote gives. */
export const QUOTE_ADDRESS = "1c".repeat(32);

/** fetch() for 1Click and the deposit bridge, answered from the recordings. Any other URL fails the test. */
export function replayFetch(o: ReplayOptions = {}): typeof fetch & { calls: { url: string; body?: any }[] } {
  const calls: { url: string; body?: any }[] = [];
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    const service = url.startsWith(ONE_CLICK) ? "oneclick" : url === DEPOSIT_BRIDGE ? "bridge" : o.privateQuotes && url.startsWith(o.privateQuotes) ? "relay" : null;
    if (o.fault && service === o.fault.service) {
      if (o.fault.failure === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      if (o.fault.failure === 521) return new Response("<html><title>Web server is down</title></html>", { status: 521, headers: { "content-type": "text/html" } });
      return new Response(JSON.stringify({ message: "Too many requests" }), { status: 429, headers: { "content-type": "application/json" } });
    }
    if (o.privateQuotes && url === `${o.privateQuotes}/health`) return json({ at: new Date(0).toISOString(), services: o.health ?? {} });
    if (url === `${ONE_CLICK}/tokens`) return o.down?.includes("1click") ? json({}, 503) : json(RECORDED.tokens.tokens);
    if (url === `${ONE_CLICK}/quote` && body.destinationAsset === "nep141:wrap.near" && body.recipientType === "DESTINATION_CHAIN") {
      // A new account's first NEAR: as recorded, at the recorded rate for that coin; a coin not recorded is refused.
      const rec = STARTS.byOrigin[body.originAsset];
      if (!rec) return json({ message: "Failed to get quote" }, 400);
      const amountIn = ((BigInt(rec.quote.amountIn) * BigInt(body.amount)) / BigInt(rec.quote.amountOut)).toString();
      const quote = { ...rec.quote, amountIn, amountOut: body.amount, minAmountOut: body.amount, deadline: body.deadline, ...(body.dry ? {} : { depositAddress: QUOTE_ADDRESS, ...(body.depositMode === "MEMO" ? { depositMemo: "4242" } : {}) }) };
      return json({ quote, quoteRequest: body }, 201);
    }
    if (url === `${ONE_CLICK}/quote`) {
      // The recorded dry quotes: native USDC → USDT (INTENTS) and wNEAR → USDC (paid on NEAR).
      const recorded = body.originAsset === "nep141:wrap.near" ? RECORDED.quotes.nearOriginToIntents : body.originAsset.startsWith("nep141:17208628") ? RECORDED.quotes.intentsToIntents : RECORDED.quotes.unknownAsset;
      if (recorded.status !== 201) return json(recorded.body, recorded.status);
      const quote = { ...recorded.body.quote, ...(body.dry ? {} : { depositAddress: QUOTE_ADDRESS }) };
      if (!body.dry && o.worse) quote.minAmountOut = String(BigInt(quote.minAmountOut) - 1000n);
      return json({ ...recorded.body, quote, quoteRequest: body }, 201);
    }
    if (url.startsWith(`${ONE_CLICK}/status`)) {
      const all = o.statuses ?? ["PENDING_DEPOSIT"];
      const n = calls.filter((c) => c.url.startsWith(`${ONE_CLICK}/status`)).length - 1;
      return json({ status: all[Math.min(n, all.length - 1)] });
    }
    if (url === `${ONE_CLICK}/deposit/submit`) return json({ ok: true });
    if (o.privateQuotes && url === `${o.privateQuotes}/quote`) {
      if (body.confidentiality !== "basic") return json({ message: "the quote server relays confidential quotes only" }, 400);
      // Paying from Private is exact output, with the bridge's fee on top (paid from Confidential Intents); a move in has none.
      const exactOut = body.swapType === "EXACT_OUTPUT";
      const out = BigInt(body.amount);
      const into = exactOut ? (out * 1003n) / 1000n : out;
      const quote = { amountIn: into.toString(), amountOut: out.toString(), minAmountOut: exactOut ? out.toString() : ((out * 99n) / 100n).toString(), timeEstimate: 20, ...(body.dry ? {} : { depositAddress: exactOut ? GENERATED.quote.depositAddress : QUOTE_ADDRESS }) };
      // As ZeroFee's relay answers a real quote: with its deposit's status tag (apps/quotes).
      return json({ quote, quoteRequest: body, ...(body.dry ? {} : { zerofeeStatusTag: "tag-for-the-core" }) }, 201);
    }
    // 1Click's generate-intent, as recorded through the partner key (fixtures/oneclick-generate-intent.json), and its submit.
    if (o.privateQuotes && url === `${o.privateQuotes}/generate-intent`) return json(GENERATED.generateIntent.response);
    if (o.privateQuotes && url === `${o.privateQuotes}/submit-intent`) return json({ intentHash: "44XpLRAuZKoVGs9T4qbSNv33MDKMePPAibA52geVLWFw", correlationId: "c-1" });
    if (o.privateQuotes && url.startsWith(`${o.privateQuotes}/status`)) return json({ status: o.privateStatus ?? "SUCCESS" });
    if (o.privateQuotes && url === `${o.privateQuotes}/deposit/submit`) return json({ ok: true });
    if (url === DEPOSIT_BRIDGE) {
      if (o.down?.includes("bridge")) return json({}, 503);
      const [p] = body.params;
      if (body.method === "supported_tokens") return json(RECORDED.supported.response);
      if (body.method === "recent_deposits") return json({ jsonrpc: "2.0", id: "zf", result: { deposits: o.deposits ?? [], total: (o.deposits ?? []).length } });
      if (body.method === "withdrawal_status") return json({ jsonrpc: "2.0", id: "zf", result: { withdrawals: o.withdrawals?.[p.withdrawal_hash] ?? [] } });
      if (body.method === "deposit_address") {
        const recorded = RECORDED.addresses.addresses[`${p.chain} ${p.deposit_mode}`];
        if (!recorded) {
          // Same answers as the recordings: one address for every EVM chain, a refusal for unknown networks.
          if (String(p.chain).startsWith("eth:")) return json({ ...RECORDED.addresses.addresses["eth:8453 SIMPLE"], result: { address: o.addressOverride ?? SAMPLE_ADDRESS.evm, chain: p.chain } });
          return json(RECORDED.addresses.addresses["no-such-chain SIMPLE"]);
        }
        if (o.addressOverride && recorded.result) return json({ ...recorded, result: { ...recorded.result, address: o.addressOverride } });
        return json(recorded);
      }
    }
    throw new Error(`unexpected fetch in a test: ${url}`);
  };
  return Object.assign(fn as typeof fetch, { calls });
}

export interface CoreOptions {
  accountId?: string;
  network?: "mainnet" | "testnet";
  stage?: "none" | "needs-backup" | "ready" | "recovering";
  /** A child's account (account.state's `kid`, D30). */
  kid?: boolean;
  /** No device storage (the host refuses). */
  noStore?: boolean;
  /** How tx.request answers: signed (the default), held by the account's protection, the person says no, or a Problem. */
  sign?: "done" | "waiting" | "declined" | Problem;
  /** How subwallet.privatePay answers: the core signs the pocket's transfer, or the person says no. Default: signs. */
  privatePay?: "sign" | "decline";
  /** What subwallet.list answers (Security's separate wallets; Private's pocket is kind "private"). Default: refused. */
  subwallets?: { kind: string; address: string }[];
  /** What subwallet.balances answers (the card wallet's holdings), smallest units. */
  balances?: { token: string; symbol: string; decimals: number; amount: string }[];
  /** What account.waiting.status answers, by hold id (default: still waiting). */
  waitingStatus?: Record<string, { state: string; txHash?: string; explorerUrl?: string }>;
  /** What tx.describe answers: the sheet's protection words, or a Problem (default: the method is unknown). */
  describe?: PlainWords["protection"] | Problem;
  /**
   * How subwallet.float.quoteAdd answers (the Add's quote, core float-moves.ts): by default as the core does, exactly
   * the amount asked to QUOTE_ADDRESS with a 10-minute deadline, refused under $2 (security.request.not-allowed) and for
   * any app but Trade or Wallet. An object patches that answer (a mismatch, a past deadline); a Problem refuses.
   */
  quoteAdd?: Partial<{ depositAddress: string; amountIn: string; minAmountOut: string; deadlineIso: string }> | Problem;
  /** The clock the Add's quote deadline is set from (default: Date.now). */
  now?: () => number;
  /** What subwallet.private.balances answers: what 1Click holds in the pocket, smallest units (default: nothing). */
  pocket?: { tokenId: string; amount: string }[];
  /** What account.activity answers: the account's record on chain (default: the method is unknown). */
  activity?: unknown[];
  /** How subwallet.private.move answers for a move out of Private (default: still pending). */
  pocketMove?: "pending" | "done" | "failed" | "refunded";
  /** What subwallet.received answers (read live: a test may change it): the core's lasting record of money that came
   *  in, and the coins the float's own Safe moves touched (default: the method is unknown). */
  received?: { adds: unknown[]; opened: unknown; touched?: string[] };
}

/** A stand-in for forApps(core, "wallet"): account.state and device.store.*, nothing else. */
export function fakeCore(o: CoreOptions = {}): Bridge & { store: Map<string, string>; signed: TxRequest[]; requests: TxRequest[]; privatePays: Record<string, unknown>[]; privateIns: Record<string, unknown>[]; movePlans: Record<string, unknown>[]; privateHomes: Record<string, unknown>[]; asked: Record<string, unknown>[]; emit(event: string, payload: unknown): void } {
  const store = new Map<string, string>();
  const signed: TxRequest[] = [];
  /** Every tx.request as asked: one per sheet. A request of separate steps (TxRequest.apart) is one here and each of its
   *  steps one in `signed`, as the core signs them (one sheet, one Face ID, a tx per step). */
  const requests: TxRequest[] = [];
  /** What subwallet.float.quoteAdd was asked (the Add's quotes), in order. */
  const asked: Record<string, unknown>[] = [];
  /** What subwallet.privatePay was asked to sign (the pocket's transfers). */
  const privatePays: Record<string, unknown>[] = [];
  /** What subwallet.private.quoteIn was asked (the moves into Private), in order. */
  const privateIns: Record<string, unknown>[] = [];
  /** What subwallet.movePlan was asked (a Move's plan, the audit's one fill), in order. */
  const movePlans: Record<string, unknown>[] = [];
  /** What subwallet.private.home was asked (the moves out of Private), in order. */
  const privateHomes: Record<string, unknown>[] = [];
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const refuse = (code: string): BridgeResult<never> => ({ problem: { code, whatHappened: "No.", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } as Problem });
  return {
    store,
    signed,
    requests,
    privatePays,
    privateIns,
    movePlans,
    privateHomes,
    asked,
    emit: (event, payload) => handlers.get(event)?.forEach((h) => h(payload)),
    async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      const ok = (v: unknown) => ({ ok: v as T });
      if (method === "tx.request") {
        const answer = o.sign ?? "done";
        if (answer === "declined") return ok({ status: "declined" } satisfies TxOutcome);
        if (typeof answer === "object") return ok({ status: "problem", problem: answer } satisfies TxOutcome);
        const r = p.request as TxRequest;
        requests.push(r);
        // separate steps: the core signs a tx per step and sends them in order (dev-signer.ts); a hold on the first leaves
        // the rest unsent
        const { then, apart, ...first } = r;
        const parts: TxRequest[] = apart && then?.length ? [{ ...first, receiverId: r.receiverId, actions: r.actions }, ...then.map((t) => ({ ...first, receiverId: t.receiverId, actions: t.actions }))] : [r];
        const urls: string[] = [];
        for (const [i, part] of parts.entries()) {
          signed.push(part);
          const txHash = `tx${signed.length}`;
          urls.push(`https://nearblocks.io/txns/${txHash}`);
          if (answer === "waiting") return ok({ status: "waiting", txHash, explorerUrl: urls.at(-1)!, id: `held-${signed.length}`, readyAtIso: "2026-10-26T09:00:00.000Z", needsSecondDevice: false, ...(parts.length > 1 ? { explorerUrls: urls, unsent: parts.length - 1 - i } : {}) } satisfies TxOutcome);
        }
        const txHash = `tx${signed.length}`;
        return ok({ status: "done", txHash, explorerUrl: urls.at(-1)!, ...(parts.length > 1 ? { explorerUrls: urls } : {}) } satisfies TxOutcome);
      }
      if (method === "account.state") {
        const stage = o.stage ?? "ready";
        if (stage === "none") return ok({ stage });
        return ok({ stage, account: { accountId: o.accountId ?? "kid.near", network: o.network ?? "mainnet", keys: [], recovery: null }, ...(o.kid ? { kid: true } : {}) });
      }
      if (method === "tx.describe" && o.describe) {
        if ("code" in o.describe) return { problem: o.describe };
        return ok({ title: "", lines: [], warnings: [], effect: [], protection: o.describe } satisfies PlainWords);
      }
      if (method === "subwallet.movePlan") {
        // as the core does (subwallets.ts movePlan): its own split of the Move (private-route moveSplit)
        if (p.app !== undefined && p.app !== "wallet") return refuse("security.request.not-allowed");
        movePlans.push(p);
        const { fillStepUsd } = await import("@zerofee/core/private-route");
        const { moveSplit } = await import("@zerofee/core/move-plan");
        const scale = 10 ** Number(p.decimals), px = Number(p.price);
        const usd = (u: bigint) => (Number(u) / scale) * px;
        const step = (u: bigint) => { const v = BigInt(Math.ceil((fillStepUsd(usd(u)) / px) * scale)); return v > u ? v : u; };
        const r = moveSplit((p.parts as { units: string }[]).map((x) => BigInt(x.units)), BigInt(String(p.share)), { ...(p.whole === true ? { whole: true } : {}), ...(typeof p.safeHas === "string" ? { safeHas: BigInt(p.safeHas) } : {}), step, usd });
        return ok({ fill: r.fill.toString(), parts: r.parts.map((x) => ({ fromPrivate: x.fromPrivate.toString(), viaFill: x.viaFill.toString(), at: x.at })) });
      }
      if (method === "subwallet.privatePay") {
        privatePays.push(p);
        if (o.privatePay === "decline") return ok({ declined: true });
        const payload = (p.intent as { payload: unknown }).payload;
        return ok({ signedData: { standard: "nep413", payload, public_key: "ed25519:SamplePocketKey", signature: "ed25519:SampleSignature" } });
      }
      // The pocket, as the core reads and moves it (subwallets.ts): Wallet only.
      if (method === "subwallet.private.balances" || method === "subwallet.private.home" || method === "subwallet.private.move") {
        if (p.app !== undefined && p.app !== "wallet") return refuse("security.request.not-allowed");
        if (method === "subwallet.private.balances") return ok(o.pocket ?? []);
        if (method === "subwallet.private.move") return ok({ id: p.id, status: o.pocketMove ?? "pending" });
        privateHomes.push(p);
        return ok({ id: `pm-${String(p.key)}`, status: "pending", where: "in-flight" });
      }
      if (method === "subwallet.private.quoteIn") {
        // As the core does (subwallets.ts privateQuoteIn): Wallet only; the same coin to the pocket, at QUOTE_ADDRESS.
        privateIns.push(p);
        if (p.app !== undefined && p.app !== "wallet") return refuse("security.request.not-allowed");
        const amount = String(p.amount ?? "");
        if (!/^\d{1,30}$/.test(amount) || !/^nep141:/.test(String(p.tokenId ?? ""))) return refuse("security.request.invalid");
        return ok({ depositAddress: QUOTE_ADDRESS, amountIn: amount, minAmountOut: ((BigInt(amount) * 99n) / 100n).toString(), deadlineIso: new Date((o.now ?? Date.now)() + 10 * 60_000).toISOString(), statusTag: "fake-leg-one-status-tag" });
      }
      if (method === "subwallet.float.quoteAdd") {
        asked.push(p);
        if (o.quoteAdd && "code" in o.quoteAdd) return { problem: o.quoteAdd };
        if (p.app !== undefined && p.app !== "trade" && p.app !== "wallet") return refuse("security.request.not-allowed");
        const amount = String(p.amount ?? "");
        if (!/^\d{1,30}$/.test(amount)) return refuse("security.request.invalid");
        if (Number(amount) / 1e6 < 2) return { problem: { code: "security.request.not-allowed", whatHappened: "Adding under $2 would mostly go on fees.", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } as Problem };
        return ok({ depositAddress: QUOTE_ADDRESS, amountIn: amount, minAmountOut: amount, deadlineIso: new Date((o.now ?? Date.now)() + 10 * 60_000).toISOString(), ...(o.quoteAdd ?? {}) });
      }
      if (method === "subwallet.balances" && o.balances) return ok(o.balances);
      if (method === "subwallet.list" && o.subwallets) return ok(o.subwallets.filter((w) => (!p.kind || w.kind === p.kind) && (p.app !== "wallet" || w.kind === "private")).map((w) => ({ id: w.address, chain: "near", label: "", ...w })));
      if (method === "account.activity" && o.activity) return ok(o.activity);
      if (method === "subwallet.received" && o.received) return ok(o.received);
      if (method === "account.waiting.status") return ok(o.waitingStatus?.[String(p.id)] ?? { state: "waiting" });
      if (method.startsWith("device.store.") && o.noStore) return refuse("shell.device.refused");
      if (method === "device.store.get") return ok({ value: store.get(String(p.key)) ?? null });
      if (method === "device.store.set") {
        if (p.value === null) store.delete(String(p.key));
        else store.set(String(p.key), String(p.value));
        return ok({ ok: true });
      }
      return refuse("security.method.unknown");
    },
    on<T>(event: string, handler: (payload: T) => void) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler as (p: unknown) => void);
      handlers.set(event, set);
      return () => set.delete(handler as (p: unknown) => void);
    },
  };
}

/** Coins held, by place, for fakeNear(). Amounts in the smallest unit. */
export interface Holdings {
  ledger?: Record<string, string>;
  account?: Record<string, string>;
  nearYocto?: bigint;
  storageBytes?: bigint;
  /** The coin contracts this account has no storage on (storage_balance_of: null); every other one, set up. */
  unregistered?: string[];
  /** wrap.near's storage_balance_of fails for this account (a node that didn't answer). */
  storageReadFails?: boolean;
}

/** A mainnet FakeChain whose intents.near and coin contracts answer from `holdings`, for the account `accountId`.
 *  `on`: put them on this chain instead (an account a DemoCore made there; its own NEAR is left as it is). */
export function fakeNear(accountId: string, h: Holdings, others: Record<string, Holdings> = {}, on?: FakeChain): FakeChain {
  const chain = on ?? new FakeChain("mainnet");
  const all: Record<string, Holdings> = { ...others, [accountId]: h };
  const ledgerOf = (id: unknown) => all[String(id)]?.ledger ?? {};
  chain.contract("intents.near", "code", {
    mt_tokens_for_owner: (a) => {
      const ids = Object.keys(ledgerOf(a.account_id)).map((token_id) => ({ token_id }));
      const from = Number(a.from_index ?? 0);
      return ids.slice(from, from + Number(a.limit ?? ids.length));
    },
    mt_batch_balance_of: (a) => (a.token_ids as string[]).map((t) => ledgerOf(a.account_id)[t] ?? "0"),
    mt_balance_of: (a) => ledgerOf(a.account_id)[String(a.token_id)] ?? "0",
  });
  for (const contract of ["wrap.near", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "usdt.tether-token.near"]) {
    chain.contract(contract, "code", {
      ft_balance_of: (a) => all[String(a.account_id)]?.account?.[`nep141:${contract}`] ?? "0",
      storage_balance_of: (a) => {
        const h = all[String(a.account_id)];
        if (h?.storageReadFails) throw new Error("the node didn't answer");
        return h && !h.unregistered?.includes(contract) ? { total: "1250000000000000000000", available: "0" } : null;
      },
      storage_balance_bounds: () => ({ min: "1250000000000000000000", max: "1250000000000000000000" }),
    });
  }
  for (const [id, holdings] of Object.entries(all)) {
    if (holdings.nearYocto === undefined) continue;
    chain.fund(id, "ed25519:11111111111111111111111111111111", 0n);
    chain.accounts.get(id)!.balance = holdings.nearYocto;
  }
  // FakeChain stores no contract bytes; report the storage each account is said to use.
  const plain = chain.account.bind(chain);
  chain.account = async (id) => {
    const a = await plain(id);
    return a ? { ...a, storageBytes: all[id]?.storageBytes ?? 0n } : null;
  };
  return chain;
}

// The two outside services the ledger reads: 1Click (prices, quotes, the status of a movement) and the NEAR Intents
// deposit bridge (deposit addresses, minimums, withdraw fees). Neither holds money or keys; balances themselves are
// always read from NEAR on two nodes (core/chain.ts), never from these services.
//
// Both work without a key. A down service is a Problem (ledger.service.unreachable) naming it and how it failed (B28:
// "1Click didn't answer.", "NEAR Intents' bridge is down right now.", "1Click is busy right now."); a service's own
// refusal is a BridgeRefused, which the caller turns into the right Problem.
import { ProblemError } from "@zerofee/core/problem";
import { SERVICES, cleanNote, faultOf, relayLimitProblem, relayOldLimit, type Service, type ServiceStatus } from "@zerofee/core/services";
import { walletProblems } from "./wallet-problems.ts";
import { FORK, FORK_CROSS_CHAIN } from "@zerofee/core/fork";
// the relay's /health wait, from the one file the relay reads too (finding 3): the two can't drift apart
import { HEALTH_CLIENT_MS } from "../../../apps/quotes/read-limits.mjs";

/** A service that failed, said by name and by how (521 down, 429 busy, a timeout slow). */
class Failed extends Error {
  readonly status: number | null;
  constructor(status: number | null) {
    super(status === null ? "no answer" : `HTTP ${status}`);
    this.status = status;
  }
}
/** Through the relay, whose own failure is said as the relay's; 1Click's, passed on by it (quotes.upstream.*), as 1Click's. */
const whoFailed = (via: string | undefined, body: unknown): Service => (!via || /^quotes\.upstream\./.test(String((body as { code?: unknown } | null)?.code ?? "")) ? "oneclick" : "relay");
const unreachable = (s: Service, e?: unknown) => new ProblemError(walletProblems.serviceUnreachable(s, e instanceof Failed ? faultOf(e.status) : faultOf(null, e)));

export const ONE_CLICK = "https://1click.chaindefuser.com/v0";
export const DEPOSIT_BRIDGE = "https://bridge.chaindefuser.com/rpc";

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  priceUpdatedAt?: string;
  contractAddress?: string;
}

/** One row of the bridge's `supported_tokens`. Amounts are whole numbers of the coin's smallest unit. */
export interface BridgeToken {
  /** "<chain>:<network>:<address or native>", e.g. "eth:4663:native", "sol:mainnet:EPjF…". */
  defuse_asset_identifier: string;
  /** The coin's address on its own chain, or "native" for the chain's own coin. */
  origin_chain_address: string;
  near_token_id: string;
  decimals: number;
  asset_name: string;
  min_deposit_amount: string;
  min_withdrawal_amount: string;
  withdrawal_fee: string;
  intents_token_id: string;
}

export interface BridgeAddress {
  address: string;
  chain: string;
  memo?: string;
}

/** The bridge answered, and said no. `message` is its own text, e.g. "Network not supported". */
export class BridgeRefused extends Error {}

/** A 1Click quote request (OpenAPI v0). Amounts are whole units. */
export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "INTENTS" | "ORIGIN_CHAIN" | "CONFIDENTIAL_INTENTS";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "INTENTS" | "ORIGIN_CHAIN" | "CONFIDENTIAL_INTENTS";
  recipient: string;
  recipientType: "INTENTS" | "DESTINATION_CHAIN" | "CONFIDENTIAL_INTENTS";
  deadline: string;
  /** "basic": Confidential Intents (D27). Needs 1Click's partner key, so it goes through the quote server. */
  confidentiality?: "public" | "basic";
  /** Networks where one address serves everyone (Stellar) are told apart by a memo. */
  depositMode?: "SIMPLE" | "MEMO";
}

export interface QuoteResponse {
  /** From ZeroFee's quote relay (apps/quotes) on a real confidential quote: opens that deposit's full status, for the core. */
  zerofeeStatusTag?: string;
  quote: {
    depositAddress?: string;
    depositMemo?: string;
    amountIn: string;
    minAmountIn?: string;
    amountOut: string;
    minAmountOut: string;
    amountInUsd?: string;
    amountOutUsd?: string;
    timeEstimate?: number;
    deadline?: string;
  };
  quoteRequest: QuoteRequest;
}

/** 1Click's word on a quote: PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, INCOMPLETE_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, FAILED. */
export interface QuoteStatus {
  status: string;
  swapDetails?: Record<string, unknown>;
}

/** One deposit the bridge has seen: PENDING, COMPLETED, FAILED or CREDITED. */
export interface BridgeDeposit {
  tx_hash: string;
  chain: string;
  near_token_id: string;
  amount: string;
  address: string;
  status: string;
}

/** 1Click turned a quote down: `message` is its own text, e.g. "tokenIn is not valid", "Amount is too low". `code`: the
 *  quote relay's own code when it was the relay that said no (quotes.request.too-big: its limit on one quote). */
export class QuoteRefused extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export interface Apis {
  tokens(): Promise<OneClickToken[]>;
  supportedTokens(): Promise<BridgeToken[]>;
  depositAddress(accountId: string, bridgeChain: string, mode: "SIMPLE" | "MEMO"): Promise<BridgeAddress>;
  /**
   * `via`: the quote server (D27) for a confidential quote: it relays to 1Click with the partner key, which never lives in
   * the app. Its status and deposit notices go the same way. Without it, 1Click itself.
   */
  quote(request: QuoteRequest, via?: string): Promise<QuoteResponse>;
  /** Null when 1Click doesn't know the address. */
  /** `tag`: the quote's own status tag; through the relay, only with it is the full record (what arrived) answered. */
  status(depositAddress: string, via?: string, tag?: string): Promise<QuoteStatus | null>;
  /** Tell 1Click about a deposit's transaction, so it doesn't have to find it. */
  submitDeposit(txHash: string, depositAddress: string, nearSenderAccount?: string, via?: string): Promise<void>;
  /** 1Click builds the unsigned transfer that pays a Confidential Intents deposit; the pocket's key signs it in the core. */
  generateIntent(via: string, signerId: string, depositAddress: string): Promise<{ payload: { message: string; nonce: string; recipient: string } }>;
  /** The signed transfer, handed to 1Click to run. */
  submitIntent(via: string, signedData: unknown): Promise<{ intentHash: string }>;
  recentDeposits(accountId: string, bridgeChain?: string): Promise<BridgeDeposit[]>;
  withdrawalStatus(nearTxHash: string): Promise<{ status: string; data?: Record<string, unknown> }[]>;
  /** The relay's status table (B28 R6, B30): `<relay>/v0/health`, each service it pinged in the last minute, since when,
   *  and the service's own public words. Only names and states ZeroFee knows are kept; a time must be a time; the words
   *  are plain text only (cleanNote); anything else in the answer is dropped. */
  health(relay: string): Promise<ServiceStatus[]>;
}

export function createApis(fetchFn: typeof fetch = (...a) => fetch(...a)): Apis {
  /** A POST through the quote server; its refusal is a QuoteRefused with 1Click's own words. */
  const postVia = async (via: string, path: string, payload: unknown): Promise<any> => {
    let res: Response;
    let body: any;
    try {
      res = await fetchFn(`${via}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
      body = await res.json().catch(() => null);
    } catch (e) {
      throw unreachable("relay", e);
    }
    if (res.status >= 500 || res.status === 429) throw unreachable(whoFailed(via, body), new Failed(res.status));
    // D132: the server before its update refuses over $100: said as that, never as 1Click's "no price"
    if (via && relayOldLimit(body)) throw new ProblemError(relayLimitProblem());
    if (!res.ok) throw new QuoteRefused(String(body?.message ?? `HTTP ${res.status}`));
    return body;
  };
  const get = async (url: string, who: Service): Promise<any> => {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Failed(res.status);
      return await res.json();
    } catch (e) {
      throw unreachable(who, e);
    }
  };

  const bridge = async (method: string, params: Record<string, unknown>): Promise<any> => {
    let body: any;
    try {
      const res = await fetchFn(DEPOSIT_BRIDGE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "zf", method, params: [params] }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.status >= 500 || res.status === 429) throw new Failed(res.status);
      body = await res.json();
    } catch (e) {
      throw unreachable("bridge", e);
    }
    if (body?.error !== undefined) throw new BridgeRefused(typeof body.error === "string" ? body.error : String(body.error?.message ?? "refused"));
    if (body?.result === undefined) throw unreachable("bridge");
    return body.result;
  };

  return {
    async tokens() {
      const list = await get(`${ONE_CLICK}/tokens`, "oneclick");
      if (!Array.isArray(list)) throw unreachable("oneclick");
      return list as OneClickToken[];
    },
    async supportedTokens() {
      const result = await bridge("supported_tokens", {});
      if (!Array.isArray(result?.tokens)) throw unreachable("bridge");
      return result.tokens as BridgeToken[];
    },
    async depositAddress(accountId, bridgeChain, mode) {
    // the mainnet copy (VITE_FORK=1): 1Click can't be copied, so no cross-chain leg starts (fork.ts)
    if (FORK) throw new ProblemError(FORK_CROSS_CHAIN);
      const r = await bridge("deposit_address", { account_id: accountId, chain: bridgeChain, deposit_mode: mode });
      if (typeof r?.address !== "string" || !r.address) throw unreachable("bridge");
      return { address: r.address, chain: String(r.chain ?? bridgeChain), memo: typeof r.memo === "string" && r.memo ? r.memo : undefined };
    },
    async quote(request, via) {
    // the mainnet copy (VITE_FORK=1): 1Click can't be copied, so no cross-chain leg starts (fork.ts)
    if (FORK) throw new ProblemError(FORK_CROSS_CHAIN);
      let res: Response;
      let body: any;
      try {
        res = await fetchFn(`${via ?? ONE_CLICK}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(20000) });
        body = await res.json().catch(() => null);
      } catch (e) {
        throw unreachable(via ? "relay" : "oneclick", e);
      }
      if (res.status >= 500 || res.status === 429) throw unreachable(whoFailed(via, body), new Failed(res.status));
      if (via && relayOldLimit(body)) throw new ProblemError(relayLimitProblem());
      if (!res.ok || !body?.quote) throw new QuoteRefused(String(body?.message ?? body?.whatHappened ?? `HTTP ${res.status}`), typeof body?.code === "string" ? body.code : undefined);
      return body as QuoteResponse;
    },
    async status(depositAddress, via, tag) {
      try {
        // the quote's own tag (security review M2): the relay answers the full record (what arrived) only with it
        const res = await fetchFn(`${via ?? ONE_CLICK}/status?depositAddress=${encodeURIComponent(depositAddress)}`, { signal: AbortSignal.timeout(15000), ...(via && tag ? { headers: { "x-zerofee-status-tag": tag } } : {}) });
        if (res.status === 404) return null;
        if (!res.ok) throw new Failed(res.status);
        const body = await res.json();
        return { status: String(body?.status ?? ""), swapDetails: body?.swapDetails };
      } catch (e) {
        throw unreachable(via && !(e instanceof Failed) ? "relay" : "oneclick", e);
      }
    },
    async submitDeposit(txHash, depositAddress, nearSenderAccount, via) {
      try {
        await fetchFn(`${via ?? ONE_CLICK}/deposit/submit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ txHash, depositAddress, ...(nearSenderAccount ? { nearSenderAccount } : {}) }),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        // Only a hint to speed things up: 1Click finds the deposit by itself.
      }
    },
    async generateIntent(via, signerId, depositAddress) {
    // the mainnet copy (VITE_FORK=1): 1Click can't be copied, so no cross-chain leg starts (fork.ts)
    if (FORK) throw new ProblemError(FORK_CROSS_CHAIN);
      const body = await postVia(via, "generate-intent", { type: "swap_transfer", standard: "nep413", signerId, depositAddress });
      const payload = body?.intent?.payload;
      if (body?.intent?.standard !== "nep413" || typeof payload?.message !== "string" || typeof payload?.nonce !== "string" || typeof payload?.recipient !== "string") throw new QuoteRefused("NEAR Intents gave nothing to approve");
      return { payload: { message: payload.message, nonce: payload.nonce, recipient: payload.recipient } };
    },
    async submitIntent(via, signedData) {
    // the mainnet copy (VITE_FORK=1): 1Click can't be copied, so no cross-chain leg starts (fork.ts)
    if (FORK) throw new ProblemError(FORK_CROSS_CHAIN);
      const body = await postVia(via, "submit-intent", { type: "swap_transfer", signedData });
      if (typeof body?.intentHash !== "string") throw new QuoteRefused(String(body?.message ?? "NEAR Intents didn't take it"));
      return { intentHash: body.intentHash };
    },
    async recentDeposits(accountId, bridgeChain) {
      const r = await bridge("recent_deposits", { account_id: accountId, ...(bridgeChain ? { chain: bridgeChain } : {}) });
      return Array.isArray(r?.deposits) ? (r.deposits as BridgeDeposit[]) : [];
    },
    async health(relay) {
      let body: any;
      try {
        const res = await fetchFn(`${relay}/health`, { signal: AbortSignal.timeout(HEALTH_CLIENT_MS) });
        // a 4xx (the live relay before its redeploy answers 404 here) is "no status table yet", never the relay down
        // (oversight review 2 Nov, HIGH 1: a 404 held every money sheet's button)
        if (res.status >= 400 && res.status < 500) return [];
        if (!res.ok) throw new Failed(res.status);
        body = await res.json();
      } catch (e) {
        throw unreachable("relay", e);
      }
      const out: ServiceStatus[] = [];
      for (const s of SERVICES) {
        const state = body?.services?.[s];
        if (!["up", "down", "busy", "slow"].includes(state)) continue;
        const d = body?.details?.[s];
        const since = typeof d?.since === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(d.since) ? d.since : undefined;
        const note = cleanNote(d?.note);
        out.push({ service: s, state, ...(since ? { since } : {}), ...(note ? { note } : {}) });
      }
      return out;
    },
    async withdrawalStatus(nearTxHash) {
      const r = await bridge("withdrawal_status", { withdrawal_hash: nearTxHash });
      return Array.isArray(r?.withdrawals) ? r.withdrawals : [];
    },
  };
}

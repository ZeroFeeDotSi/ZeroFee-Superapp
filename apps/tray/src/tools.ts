// AgentZero's four tools on this computer: balance, receipts, pay, stop. Nothing else. Every refusal is one plain line.
// And one resource, the meter (zerofee://budget, item 2): "$14 of $20 left today", the same line `balance` answers, read
// from the account's agent view on NEAR every time (never counted here).
// `pay` goes through the same checks as the phone's core (agent-sign.ts agentPayWithSeed → agent-private.ts
// agentPayPlan: only a name on the account's list, only privately, shut until route A is proven) after this tray's own:
// at most $5 a call, and the counterparty check (judge), whose "warn" or "block" sends the person to their phone.
// `why` is shown back, never read as an order. Logs carry counts and error names only: no amounts, accounts, keys or
// tokens. Receipts live in this process's memory only.
import type { Chain } from "@zerofee/core/chain";
import { codeOf } from "@zerofee/core/chain";
import { AGENT_USDC, PAYEE_CHAIN_NAME, readPayee } from "@zerofee/core/agent-private";
import { APP_CHAINS } from "@zerofee/core/app-chains";
import { agentPayWithSeed } from "@zerofee/core/agent-sign";
import type { OneClickQuoter } from "@zerofee/core/intents";
import { ProblemError } from "@zerofee/core/problem";
import type { TxOutcome } from "@zerofee/core/signer";
import { judge } from "@zerofee/agent/zero/counterparty";
import { sameHash, stopHashOf, type Spend } from "./store.ts";

export const PER_CALL_USD = 5;
const DAY_MS = 86_400_000;
const STOP_TRIES = 5;
const WHY_MAX = 200;
const NO_CODE = "11111111111111111111111111111111";

export interface Receipt {
  txHash: string;
  usd: number;
  atIso: string;
}

export interface ToolDeps {
  chain: Chain;
  accountId: string;
  quoter: OneClickQuoter;
  quoteKey?: string;
  /** AgentZero's seed, read from the Keychain for one payment (zeroed after). Null when it isn't there. */
  loadSeed: () => Promise<Uint8Array | null>;
  stopHash: string;
  /** This computer's own day limit in whole dollars (D104). */
  dayLimitUsd: number;
  /** This computer's payments over the last 24 hours, from the Keychain (null: unreadable), and keeping them. */
  spent: () => Promise<Spend[] | null>;
  setSpent: (list: Spend[]) => Promise<boolean>;
  /** Deletes the Keychain item; true when it's gone. */
  forget: () => Promise<boolean>;
  log: (line: string) => void;
  /** Tests: the signer (agentPayWithSeed by default). */
  pay?: typeof agentPayWithSeed;
  /** Accounts this tray paid this session, and the code each ran then (the counterparty check's "paid before"). */
  seen?: Map<string, string | null>;
  now?: () => number;
}

export interface ToolResult {
  text: string;
  isError: boolean;
  /** stop: run once the answer has gone out. */
  stop?: true;
}

/** The meter, as an MCP resource: one line of text, read from the chain on every read. */
export const BUDGET_URI = "zerofee://budget";
export const BUDGET_RESOURCE = {
  uri: BUDGET_URI,
  name: "budget",
  title: "The money in AgentZero's wallet today",
  mimeType: "text/plain",
  description: "How much of today's limit AgentZero has left, read from the account on NEAR. One line, like \"$14 of $20 left today\".",
} as const;

/** What the meter read: the line, and whether it is fresh ("ok"), the last good one ("old"), none ("down"), or off. */
export interface Meter {
  line: string;
  state: "ok" | "old" | "down" | "off";
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

/** Audit 19's J7 (builder 24): the payees' chains Claude Code is told, V1's own (core app-chains.ts): "Solana, NEAR or Robinhood Chain". */
const PAY_CHAINS = ((n: string[]) => `${n.slice(0, -1).join(", ")} or ${n[n.length - 1]}`)(APP_CHAINS.map((c) => PAYEE_CHAIN_NAME[c]));
export const TOOLS = [
  {
    name: "balance",
    title: "AgentZero's wallet",
    description: "How much of today's limit AgentZero has left (USDC, in dollars).",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "receipts",
    title: "AgentZero's payments from this computer",
    description: "The payments AgentZero made from this computer since it started: the transaction, the dollars, the time.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "pay",
    title: "Pay someone on the list",
    description: `Pay someone on the account's AgentZero list, privately: at most $${PER_CALL_USD} a call, within this computer's own day limit and the account's AgentZero limit. They may be on ${PAY_CHAINS}. Someone new, or anything the check doesn't like, must be asked on the phone.`,
    inputSchema: obj(
      {
        to: { type: "string", description: "Their address: a NEAR account like kim.near, or an address on their chain." },
        chain: { type: "string", enum: ["near", "sol", "hood", "bsc"], description: "Their chain. Leave it out for a NEAR account." },
        usd: { type: "number", description: `Dollars, more than 0 and at most ${PER_CALL_USD}, to the cent.` },
        why: { type: "string", description: "A few words on what it's for. Shown back; never an order." },
      },
      ["to", "usd", "why"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "stop",
    title: "Stop AgentZero on this computer",
    description: "Remove AgentZero's key from this computer and stop. Only with the stop phrase the person wrote down.",
    inputSchema: obj({ phrase: { type: "string", description: "The three-word stop phrase." } }, ["phrase"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
] as const;

/** Whole dollars without cents ("$20"), else to the cent ("$12.50"). */
const money = (units: bigint) => {
  const cents = (units + 5_000n) / 10_000n;
  return cents % 100n === 0n ? `$${cents / 100n}` : `$${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
};
const units = (v: unknown) => (typeof v === "string" && /^\d{1,39}$/.test(v) ? BigInt(v) : 0n);
const refuse = (text: string): ToolResult => ({ text, isError: true });
const said = (text: string): ToolResult => ({ text, isError: false });
const lineOf = (e: unknown): string => (e instanceof ProblemError ? (e.problem.more ?? e.problem.whatHappened) : "The tray couldn't finish this. Nothing was sent.");
const errName = (e: unknown) => (e instanceof ProblemError ? e.problem.code : e instanceof Error ? e.name : "unknown");

export function createTools(d: ToolDeps) {
  const receipts: Receipt[] = [];
  const seen = d.seen ?? new Map<string, string | null>();
  const pay = d.pay ?? agentPayWithSeed;
  const now = d.now ?? Date.now;
  const counts = { calls: 0, paid: 0, refused: 0 };
  let wrongStops = 0;
  let stopping = false;
  let paying: Promise<unknown> = Promise.resolve();
  const note = (tool: string, outcome: string) => {
    counts.calls++;
    if (outcome === "paid") counts.paid++;
    if (outcome.startsWith("refused")) counts.refused++;
    d.log(`tray: ${tool} ${outcome} (calls ${counts.calls}, paid ${counts.paid}, refused ${counts.refused})`);
  };

  /** The last line read from NEAR, said (marked old) when NEAR doesn't answer. */
  let lastGood: string | null = null;

  /** The meter: today's pocket money left, from the account's agent view on NEAR (spent in the last 24 hours). */
  async function meter(): Promise<Meter & { err?: string }> {
    let v: { paused?: unknown; budget?: { coins?: { coin?: string; per_day?: string }[] }; spent?: unknown } | null;
    try {
      v = (await d.chain.view(d.accountId, "agent", {}, await d.chain.commonBlock())) as typeof v;
    } catch (e) {
      const err = errName(e);
      return lastGood ? { line: `NEAR didn't answer, so this may be old: ${lastGood}`, state: "old", err } : { line: "NEAR didn't answer.", state: "down", err };
    }
    if (!v || typeof v !== "object") return { line: "AgentZero isn't on for this account. Turn it on on your phone.", state: "off" };
    const limit = units((v.budget?.coins ?? []).find((c) => c?.coin === AGENT_USDC)?.per_day);
    const row = (Array.isArray(v.spent) ? v.spent : []).find((r): r is [string, string, string] => Array.isArray(r) && r[0] === AGENT_USDC);
    const spent = units(row?.[1]);
    const left = limit > spent ? limit - spent : 0n;
    lastGood = `${money(left)} of ${money(limit)} left today${v.paused === true ? ". AgentZero is paused on your phone." : ""}`;
    return { line: lastGood, state: "ok" };
  }

  async function balance(): Promise<ToolResult> {
    const m = await meter();
    note("balance", m.state === "ok" ? "ok" : m.err ? `refused ${m.err}` : `refused ${m.state}`);
    return m.state === "ok" ? said(m.line) : refuse(m.line);
  }

  function receiptsTool(): ToolResult {
    note("receipts", "ok");
    if (!receipts.length) return said("No payments from this computer yet.");
    return said(receipts.map((r) => `${r.atIso}  $${r.usd.toFixed(2)}  ${r.txHash}`).join("\n"));
  }

  async function payTool(args: Record<string, unknown>): Promise<ToolResult> {
    const { to, usd, why, chain } = args;
    const no = (text: string, name: string) => (note("pay", `refused ${name}`), refuse(text));
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return no("Say how many dollars, more than $0.", "amount");
    if (usd > PER_CALL_USD) return no(`AgentZero pays at most $${PER_CALL_USD} at a time from this computer. Nothing was sent.`, "over-cap");
    const cents = Math.round(usd * 100);
    if (Math.abs(usd * 100 - cents) > 1e-6 || cents < 1) return no("Say the dollars to the cent, like 1.25.", "amount");
    // D111: an address on its chain (a NEAR name when none is given), checked here only for its shape, with the chain
    // named; the core decides everything else (the list, the route, the cross-chain switch).
    const payee = readPayee(to, chain ?? "near");
    if ("refused" in payee) return no(payee.refused, "to");
    const onNear = payee.chain === "near";
    // What the caps count: a NEAR name, its amount (as before); an address elsewhere, the most it can cost (the core's
    // payeeCeiling: 3 % and $0.50 of fees on top), so "$5 a call" and the day limit hold with fees in.
    const capCents = onNear ? cents : Math.ceil((cents * 103) / 100) + 50;
    if (capCents > PER_CALL_USD * 100) return no(`With network fees that could cost $${(capCents / 100).toFixed(2)}. AgentZero pays at most $${PER_CALL_USD} at a time from this computer. Nothing was sent.`, "over-cap");
    if (typeof why !== "string" || !why.trim() || why.length > WHY_MAX) return no(`Say why in a few words (at most ${WHY_MAX} letters).`, "why");
    // Asked after stop: refused (one asked before it still runs, ahead of the stop).
    if (stopping) return no("AgentZero is stopping on this computer. Nothing was sent.", "stopping");
    // One payment at a time: the next waits for this one's answer.
    const run = paying.then(async (): Promise<ToolResult> => {
      // This computer's own day limit (D104), over a rolling 24 hours, counted in the Keychain. The account's limit on
      // chain stays the hard ceiling; this one is only ever tighter.
      const list = await d.spent().catch(() => null);
      if (list === null) return no("This computer's day count couldn't be read. Nothing was sent.", "count-unreadable");
      const t = now();
      const recent = list.filter((r) => r.atMs > t - DAY_MS);
      const used = recent.reduce((sum, r) => sum + r.cents, 0);
      if (used + capCents > d.dayLimitUsd * 100) return no(`This computer's day limit is $${d.dayLimitUsd}. Ask on your phone for more.`, "day-limit");
      // The counterparty check, with the account read from NEAR now.
      let account: { exists: boolean; code: string | null } | null = null;
      if (onNear) {
        try {
          const found = await d.chain.account(payee.address, await d.chain.commonBlock());
          const code = codeOf(found);
          account = { exists: found !== null, code: code && code !== NO_CODE ? code : null };
        } catch {
          account = null;
        }
      }
      // A NEAR name keeps its own key (as before D111); an address elsewhere is keyed with its chain.
      const key = onNear ? payee.address : `${payee.chain}:${payee.address}`;
      const check = judge(payee.address, { account, paidBefore: seen.has(key), ...(seen.has(key) ? { codeWhenPaid: seen.get(key) ?? null } : {}) }, payee.chain);
      // A first payment to a plain account (no code) is allowed: the person put that name on the account's list with Face
      // ID, and the core checks the list again before signing. Anything else that isn't "allow" (a block, an app's
      // account the first time, its code changed, NEAR not answering) goes to the phone.
      const firstToPerson = check.verdict === "warn" && check.reasons.length === 1 && check.reasons[0] === (onNear ? `First time paying ${payee.address}.` : `First time paying this ${PAYEE_CHAIN_NAME[payee.chain]} address.`);
      if (check.verdict !== "allow" && !firstToPerson) return no(`Ask on your phone: ${check.line}`, `check-${check.verdict}`);
      const seed = await d.loadSeed();
      if (!seed) return no("AgentZero isn't paired on this computer. Pair it again.", "no-key");
      // Counted BEFORE signing: a payment whose answer is lost still counts. Given back only when nothing was sent.
      if (!(await d.setSpent([...recent, { atMs: t, cents: capCents }]).catch(() => false))) {
        seed.fill(0);
        return no("The Keychain didn't keep this computer's day count. Nothing was sent.", "count-unkept");
      }
      const giveBack = () => d.setSpent(recent).catch(() => false);
      let out: TxOutcome;
      try {
        out = await pay({ chain: d.chain, accountId: d.accountId, seed, quoter: d.quoter, ...(d.quoteKey ? { quoteKey: d.quoteKey } : {}) }, { to: payee.address, amount: (BigInt(cents) * 10_000n).toString(), ...(onNear ? {} : { chain: payee.chain, usd: cents / 100 }) });
      } catch (e) {
        await giveBack();
        return no(lineOf(e), errName(e));
      } finally {
        seed.fill(0);
      }
      // Given back only when nothing can have been sent: a refusal thrown before signing (above), or the signer said no
      // before signing. A `problem` OUTCOME may come after the transaction went out (the signer's "signed and possibly
      // sent", a partial run): it stays counted, and the person checks Activity.
      if (out.status === "declined") await giveBack();
      if (out.status === "done") {
        receipts.push({ txHash: out.txHash, usd: cents / 100, atIso: new Date(now()).toISOString() });
        seen.set(key, account?.code ?? null);
        note("pay", "paid");
        return said(`Paid $${(cents / 100).toFixed(2)} to ${onNear ? payee.address : `a ${PAYEE_CHAIN_NAME[payee.chain]} address`}, for: ${why.trim()}. Transaction ${out.txHash}.`);
      }
      if (out.status === "waiting") return no("Your account is holding this payment. Check your phone.", "waiting");
      if (out.status === "declined") return no("Not sent.", "declined");
      return no("Not sure it went. Check Activity before you pay again.", out.problem.code);
    });
    paying = run.catch(() => undefined);
    return run;
  }

  async function stop(args: Record<string, unknown>): Promise<ToolResult> {
    if (wrongStops >= STOP_TRIES) return (note("stop", "refused locked"), refuse("Stop is locked after 5 wrong phrases. Stop AgentZero on your phone instead."));
    const phrase = typeof args.phrase === "string" ? args.phrase : "";
    if (!phrase.trim() || !sameHash(stopHashOf(phrase), d.stopHash)) {
      wrongStops++;
      return (note("stop", "refused phrase"), refuse("That isn't the stop phrase. Nothing changed."));
    }
    // Behind any payment in flight: it finishes (and keeps its receipt) before the key is deleted and the tray exits;
    // a payment asked for after this is refused.
    stopping = true;
    const run = paying.then(async (): Promise<ToolResult> => {
      if (!(await d.forget().catch(() => false))) {
        stopping = false;
        return (note("stop", "refused keychain"), refuse("The Keychain didn't let go of AgentZero's key. Nothing changed."));
      }
      note("stop", "ok");
      return { text: "Stopped. AgentZero's key is gone from this computer.", isError: false, stop: true };
    });
    paying = run.catch(() => undefined);
    return run;
  }

  return {
    async call(name: string, args: Record<string, unknown>): Promise<ToolResult | null> {
      if (name === "balance") return balance();
      if (name === "receipts") return receiptsTool();
      if (name === "pay") return payTool(args);
      if (name === "stop") return stop(args);
      return null;
    },
    receipts: () => receipts.slice(),
    /** The meter's line for the zerofee://budget resource (the same read as `balance`). */
    meter: async (): Promise<Meter> => {
      const { line, state } = await meter();
      return { line, state };
    },
  };
}

// AgentZero's own trades from its pocket (D90 job 1, P3; D107). Trade's Solana engine builds the swap for the pocket's
// address; the core signs it only inside the day the person approved with Face ID (account.agent.pocketSign: no sheet,
// refused by name otherwise); the same signed bytes are sent until two nodes agree it landed, failed or expired. It never
// signs a trade twice: a trade that isn't confirmed in time says so and is left for Activity.
//
// The chain (createSolChain from @zerofee/trade, with the app's own market price and nodes) is handed in, so this file
// loads none of Trade's code and its tests need no network.
import type { Bridge } from "@zerofee/core/bridge";
import type { Amount, ChainEngine, Fill, Side } from "@zerofee/trade/types.ts";
import { TradeError } from "@zerofee/trade/errors.ts";
import { problemOf } from "@zerofee/trade/trade-problems.ts";

/** What one trade did, for its receipt. `ms`: from AgentZero's decision to the core's signature, and to the landing. */
export type PocketTrade =
  | { kind: "done"; line: string; txHash: string; fill?: Fill; ms: { signed: number; landed: number } }
  /** Signed and sent, not confirmed in time: never tried again; Activity shows what happened. */
  | { kind: "unknown"; line: string; txHash: string; ms: { signed: number } }
  /** Nothing was signed: the core refused (its words), or the trade couldn't be built. */
  | { kind: "refused"; line: string }
  /** Signed and confirmed as failed on chain, or expired: nothing was bought or sold (the fee may be spent). */
  | { kind: "failed"; line: string; txHash: string };

export interface PocketDeps {
  /** The agent app's own bridge (forApps(…, "agent")). This file calls only account.agent.pocket and pocketSign. */
  bridge: Bridge;
  /** Trade's Solana chain for the pocket's address. */
  chain(owner: string): Promise<Pick<ChainEngine, "prepare" | "send" | "txHash" | "status" | "fill"> & { engine?: { prepareDirect?: ChainEngine["prepare"] } }>;
  now?(): number;
  sleep?(ms: number): Promise<void>;
}

/** How often the landing is read, how often the same bytes are sent again, and when AgentZero stops waiting. */
export const STATUS_EVERY_MS = 400;
export const RESEND_EVERY_MS = 2_000;
export const GIVE_UP_MS = 60_000;
/** The routes a copy buy may take: pump.fun's own curve and its own AMM, never an aggregator chosen from the signal. */
export const PUMP_ROUTES: ReadonlySet<string> = new Set(["pump.fun", "PumpSwap"]);

export function pocketTrader(d: PocketDeps) {
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let pocket: Promise<{ id: string; address: string }> | null = null;
  let chain: Promise<Awaited<ReturnType<PocketDeps["chain"]>>> | null = null;
  // One trade at a time: the next waits for this one's answer (the core's day total is counted in order, too).
  let queue: Promise<unknown> = Promise.resolve();

  const address = () =>
    (pocket ??= d.bridge.call<{ id: string; address: string }>("account.agent.pocket").then((r) => {
      if ("problem" in r) throw new Error(r.problem.more ?? r.problem.whatHappened);
      return r.ok;
    })).catch((e: unknown) => {
      pocket = null;
      throw e;
    });

  async function run(side: Side, coin: string, amount: Amount, name: string, ticket?: string, pumpOnly = false): Promise<PocketTrade> {
    const t0 = now();
    let owner: string;
    try {
      owner = (await address()).address;
    } catch {
      return { kind: "refused", line: "Your SOL wallet didn't open. Nothing was sent." };
    }
    let c: Awaited<ReturnType<PocketDeps["chain"]>>;
    try {
      c = await (chain ??= d.chain(owner));
    } catch {
      chain = null; // a failed load is tried again on the next trade (second review, L-d)
      return { kind: "refused", line: `AgentZero didn't trade ${name}: Solana didn't answer. Nothing was sent.` };
    }
    let tx: string;
    let p: Awaited<ReturnType<typeof c.prepare>>;
    try {
      // A copy buy: pump.fun's own route only (Trade's direct path, which never asks Jupiter), checked again by its route.
      const notPump = { kind: "refused", line: `AgentZero copies pump.fun coins only. ${name} isn't on pump.fun. Nothing was sent.` } as const;
      const direct = c.engine?.prepareDirect;
      if (pumpOnly && !direct) return notPump;
      if (pumpOnly) {
        const got = await direct!(side, coin, amount).catch((e: unknown) => {
          if (e instanceof TradeError && e.kind === "funds") throw e;
          return null;
        });
        if (!got || !PUMP_ROUTES.has(got.quote?.route)) return notPump;
        p = got;
      } else p = await c.prepare(side, coin, amount);
      await p.ready();
      const step = p.steps.at(-1);
      if (!step || p.steps.length !== 1) return { kind: "refused", line: `AgentZero didn't trade ${name}: it isn't one swap. Nothing was sent.` };
      tx = step.tx;
    } catch (e) {
      // Trade's own refusal, in Trade's own words ("BONK's maker can freeze it and stop you selling. We don't offer it.").
      // T7: a trap coin's words already say nothing was spent: said once
      if (e instanceof TradeError) { const said = problemOf(e, { symbol: name, chain: "Solana" }).whatHappened; return { kind: "refused", line: /Nothing was spent\.$/.test(said) ? said : `${said} Nothing was sent.` }; }
      return { kind: "refused", line: `AgentZero didn't trade ${name}: ${built(e)} Nothing was sent.` };
    }
    const r = await d.bridge.call<{ signedTx: string }>("account.agent.pocketSign", { tx, ...(ticket ? { ticket } : {}) });
    if ("problem" in r) return { kind: "refused", line: `${r.problem.more ?? r.problem.whatHappened} Nothing was sent.` };
    const signed = r.ok.signedTx;
    const signedMs = now() - t0;
    const hash = c.txHash(signed);
    const step = p.steps.at(-1)!;
    let lastSend = -Infinity;
    for (;;) {
      if (now() - lastSend >= RESEND_EVERY_MS) {
        lastSend = now();
        await c.send(signed).catch(() => undefined); // the same bytes: it can never land twice
      }
      const s = await c.status(hash, step).catch(() => "unknown" as const);
      if (s === "confirmed") {
        const fill = await c.fill(p, hash).catch(() => undefined);
        const verb = side === "buy" ? "Bought" : "Sold";
        return { kind: "done", line: `${verb} ${name}.`, txHash: hash, ...(fill ? { fill } : {}), ms: { signed: signedMs, landed: now() - t0 } };
      }
      if (s === "failed") return { kind: "failed", line: `Solana refused the trade of ${name}. Nothing was ${side === "buy" ? "bought" : "sold"}.`, txHash: hash };
      if (s === "expired") return { kind: "failed", line: `The trade of ${name} ran out of time. Nothing was ${side === "buy" ? "bought" : "sold"}.`, txHash: hash };
      if (now() - t0 >= GIVE_UP_MS) return { kind: "unknown", line: `Sent, but Solana hasn't confirmed ${name} yet. Check Activity.`, txHash: hash, ms: { signed: signedMs } };
      await sleep(STATUS_EVERY_MS);
    }
  }

  return {
    /** Buys `usd` dollars of `coin` from the pocket. `name`: the coin's name for the receipt. */
    buy: (coin: string, usd: number, name: string, ticket?: string, o?: { pumpOnly?: boolean }) => queued(() => run("buy", coin, { usd }, name, ticket, !!o?.pumpOnly)),
    /** Sells the pocket's whole holding of `coin`. */
    sellAll: (coin: string, name: string, ticket?: string) => queued(() => run("sell", coin, { fraction: 1 }, name, ticket)),
  };

  function queued(f: () => Promise<PocketTrade>): Promise<PocketTrade> {
    const next = queue.then(f, f);
    queue = next.catch(() => undefined);
    return next;
  }
}

/** Why Trade's engine couldn't build it (P5: Trade's own coin checks run inside prepare: freezable, pausable, a fee
 *  its maker can raise, a sale that fails its test run…), in Trade's own words for a Trade refusal. */
function built(e: unknown): string {
  const kind = (e as { kind?: string } | null)?.kind;
  if (kind === "funds") return "Your SOL wallet doesn't have enough SOL.";
  if (kind === "unavailable" || kind === "unsellable") return "it can't be traded right now.";
  if (kind === "moved") return "its price moved too fast.";
  return "Solana didn't answer.";
}

// Legacy (inheritance) and Agent (spending limits), the account contract's v3 modules, in plain words.
//
// On the person's own account: setting them up, changing them, and turning them off. On someone else's account (an
// heir's phone): asking for a legacy, paying it out, stopping a recovery, and running a standing order. Someone else's
// account counts only if it runs the account contract v3 or later (by code hash, two nodes); a look-alike gets the
// unknown-contract words. What the words say about a legacy (who claimed, the delay, your share) is read from the
// account itself on two nodes, never taken from the request.
import { codeOf } from "./chain.ts";
import type { Block, Chain } from "./chain.ts";
import { formatAmount, formatNear, Unnamed } from "./format.ts";
import type { Described } from "./format.ts";
import { duration, hasModules } from "./known-contracts.ts";
import type { DecodedAction, DecodedTx } from "./tx-decode.ts";

const LEGACY_OWN = ["legacy_setup", "legacy_off", "legacy_check_in", "legacy_cancel_claim"];
const LEGACY_HEIR = ["legacy_start_claim", "legacy_distribute", "legacy_cancel_recovery"];
const AGENT_OWN = ["agent_set", "agent_set_budget", "agent_add_order", "agent_resume", "agent_pause", "agent_remove_order", "agent_revoke", "agent_renew_key", "agent_identity_create"];
const AGENT_KEY = ["agent_pay", "agent_convert", "run_order"];
const KIDS_OWN = ["kids_set", "kids_off"];
const MODULE_METHODS = new Set([...LEGACY_OWN, ...LEGACY_HEIR, ...AGENT_OWN, ...AGENT_KEY, ...KIDS_OWN]);

/** The most the agent key can spend on network fees (the contract's AGENT_KEY_ALLOWANCE). */
export const AGENT_KEY_ALLOWANCE = 500_000_000_000_000_000_000_000n;
/** NEAR the account keeps when a legacy is paid out (the contract's LEGACY_RESERVE). */
const LEGACY_RESERVE = 100_000_000_000_000_000_000_000n;

export interface ModuleFacts {
  /** The receiver runs the account contract v3 or later (two nodes). */
  account: boolean;
  /** The receiver's legacy_status, when a Legacy method is called (two nodes). */
  legacy: any | null;
  /** The receiver's agent view, when a standing order is named by id (two nodes). */
  agent: any | null;
  /** Coin id ("nep141:…") → symbol and decimals, from ft_metadata on two nodes. */
  coins: Map<string, { symbol: string; decimals: number }>;
}

function argsOf(a: DecodedAction): Record<string, any> | null {
  if (a.kind !== "call") return null;
  if (a.args.length === 0) return {};
  try {
    const v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(a.args));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** A payout as the contract writes it → the coin's name in the rules ("near", "nep141:…", a NEAR Intents id). */
export function payoutCoin(payout: unknown): string | null {
  if (payout === "Near") return "near";
  const p = payout as any;
  if (typeof p?.Ft?.token === "string") return `nep141:${p.Ft.token}`;
  if (typeof p?.Ledger?.token_id === "string") return p.Ledger.token_id;
  return null;
}

/** Every coin a module call's arguments mention. */
function coinsIn(method: string, args: Record<string, any>): string[] {
  const out: unknown[] = [];
  const budget = (b: any) => (Array.isArray(b?.coins) ? b.coins.map((c: any) => c?.coin) : []);
  if (method === "agent_set") out.push(...budget(args.budget), ...(Array.isArray(args.orders) ? args.orders.map((o: any) => payoutCoin(o?.payout)) : []));
  if (method === "agent_set_budget") out.push(...budget(args.budget));
  if (method === "agent_add_order") out.push(payoutCoin(args.plan?.payout));
  if (method === "agent_pay" || method === "agent_convert") out.push(payoutCoin(args.payout));
  if (method === "legacy_setup" && Array.isArray(args.config?.tokens)) out.push(...args.config.tokens);
  if (method === "legacy_distribute" && Array.isArray(args.balances)) out.push(...args.balances.map((b: any) => b?.[0]));
  if (method === "kids_set" && Array.isArray(args.rules?.week)) out.push(...args.rules.week.map((w: any) => w?.[0]));
  return out.filter((c): c is string => typeof c === "string" && c !== "near");
}

/** Read what the words need, if this transaction calls Legacy or Agent methods. */
export async function gatherModuleFacts(tx: DecodedTx, chain: Chain, block: Block): Promise<ModuleFacts> {
  const facts: ModuleFacts = { account: false, legacy: null, agent: null, coins: new Map() };
  const calls = tx.actions.filter((a) => a.kind === "call" && MODULE_METHODS.has(a.method));
  if (calls.length === 0) return facts;
  if (!hasModules(codeOf(await chain.account(tx.receiverId, block)), false, chain.network)) return facts;
  facts.account = true;
  const methods = calls.map((a) => (a.kind === "call" ? a.method : ""));
  const [legacy, agent] = await Promise.all([
    methods.some((m) => m.startsWith("legacy_")) ? chain.view(tx.receiverId, "legacy_status", {}, block) : null,
    methods.some((m) => m === "agent_remove_order" || m === "run_order") ? chain.view(tx.receiverId, "agent", {}, block) : null,
  ]);
  facts.legacy = legacy ?? null;
  facts.agent = agent ?? null;
  const coins = new Set(calls.flatMap((a) => coinsIn(a.kind === "call" ? a.method : "", argsOf(a) ?? {})));
  for (const coin of coins) {
    const contract = coin.startsWith("nep141:") ? coin.slice(7) : null;
    if (!contract) continue;
    const m = (await chain.view(contract, "ft_metadata", {}, block)) as any;
    const symbol = typeof m?.symbol === "string" ? m.symbol.replace(/[^\p{L}\p{N}.$_-]/gu, "").slice(0, 16) : "";
    if (symbol && Number.isInteger(m?.decimals) && m.decimals <= 36) facts.coins.set(coin, { symbol, decimals: m.decimals });
  }
  return facts;
}

const units = (v: unknown): bigint | null => (typeof v === "string" && /^\d{1,39}$/.test(v) ? BigInt(v) : null);

/** "1 Nov 2026", in the phone's own time zone. */
export function dateWords(ns: unknown): string {
  const n = units(String(ns));
  if (n === null) return "a date ZeroFee can't read";
  return new Date(Number(n / 1_000_000n)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** Plain words for one Legacy or Agent call, or null to fall back to the generic words. A coin it can't name is said as
 *  one, its id and exact amount going to `unnamed`, the sheet's own disclosure (format.ts; one per sheet). */
export function describeModuleCall(a: DecodedAction, tx: DecodedTx, facts: ModuleFacts, unnamed: Unnamed): Described | null {
  const args = argsOf(a);
  if (a.kind !== "call" || !args || !facts.account || !MODULE_METHODS.has(a.method)) return null;
  const said = (title: string, lines: string[]): Described => ({ title, lines: [title, ...lines], warnings: [] });
  const amount = (coin: string | null, raw: unknown): string => {
    const n = units(raw);
    if (n === null || !coin) return "an amount ZeroFee can't read";
    if (coin === "near") return `${formatNear(n)} NEAR`;
    const c = facts.coins.get(coin);
    return c ? `${formatAmount(n, c.decimals)} ${c.symbol}` : unnamed.amount(n, coin);
  };
  const coinName = (coin: string) => (coin === "near" ? "NEAR" : (facts.coins.get(coin)?.symbol ?? unnamed.coin(coin)));

  /** A standing order: what, to whom, when. */
  const orderLines = (plan: any): string[] => {
    const what = `${amount(payoutCoin(plan?.payout), plan?.amount)} to ${plan?.to}`;
    const dates = (Array.isArray(plan?.dates_ns) ? plan.dates_ns : []).map((d: unknown) => units(String(d))).filter((d: bigint | null): d is bigint => d !== null).sort((x: bigint, y: bigint) => (x < y ? -1 : 1));
    if (dates.length === 0) return [`${what}, on a date ZeroFee can't read`];
    const grace = Number(plan?.grace_seconds);
    const late = Number.isFinite(grace) && grace > 0 ? [`If a payment misses its date, it can still go up to ${duration(grace)} later.`] : [];
    if (dates.length === 1) return [`${what} on ${dateWords(dates[0])}`, ...late];
    const local = dates.map((d: bigint) => new Date(Number(d / 1_000_000n)));
    const monthly = local.every((d: Date, i: number) => d.getDate() === local[0].getDate() && (i === 0 || d.getFullYear() * 12 + d.getMonth() === local[i - 1].getFullYear() * 12 + local[i - 1].getMonth() + 1));
    return [
      monthly ? `${what} on the ${ordinal(local[0].getDate())} of each month` : `${what}, ${dates.length} times`,
      `${dates.length} payments: the first on ${dateWords(dates[0])}, the last on ${dateWords(dates.at(-1))}`,
      ...late,
    ];
  };

  /** What Agent may spend on its own judgement. */
  const budgetLines = (b: any): string[] => {
    const coins: any[] = Array.isArray(b?.coins) ? b.coins : [];
    if (coins.length === 0) return ["On its own, AgentZero can't pay anything else."];
    const recipients: string[] = Array.isArray(b?.recipients) ? b.recipients.map(String) : [];
    const lines: string[] = [];
    for (const c of coins) {
      const coin = typeof c?.coin === "string" ? c.coin : null;
      if (units(c?.per_day) !== 0n) lines.push(`On its own: up to ${amount(coin, c?.per_day)} in 24 hours and ${amount(coin, c?.per_month)} a month`);
      if (units(c?.convert_per_day) !== 0n) lines.push(`Up to ${amount(coin, c?.convert_per_day)} in 24 hours can go to any address, for swaps`);
    }
    lines.push(recipients.length ? `Only to ${recipients.join(", ")}` : "To no one, except for swaps");
    lines.push(`At most ${Number(b?.max_spends_per_day)} payments in 24 hours, until ${dateWords(b?.ends_at_ns)}`);
    return lines;
  };
  const keyLine = `AgentZero's key can't do anything else. It can spend at most ${formatNear(AGENT_KEY_ALLOWANCE)} NEAR on network fees.`;

  const self = tx.receiverId === tx.signerId;
  const legacy = facts.legacy;
  const quiet = legacy ? duration(Number(legacy.quiet_seconds)) : null;
  if (self) {
    switch (a.method) {
      case "legacy_setup": {
        const c = args.config ?? {};
        const heirs: any[] = Array.isArray(c.heirs) ? c.heirs : [];
        const tokens: string[] = Array.isArray(c.tokens) ? c.tokens.map(String) : [];
        return said("Choose who gets your money", [
          ...heirs.map((h) => `${h?.account_id}: ${Number(h?.share_pct)}%`),
          `They can ask after ${duration(Number(c.quiet_seconds))} with no word from you.`,
          `Then this phone has ${duration(Number(c.claim_delay_seconds))} to stop it. Using your account stops it too.`,
          `They'd share your NEAR${tokens.length ? `, and from your Safe: ${tokens.map(coinName).join(", ")}` : ""}.`,
        ]);
      }
      case "legacy_off":
        return said("Turn off your legacy", ["No one can ask for your money any more."]);
      case "legacy_check_in":
        return said("Tell the network you're here", [quiet ? `Your ${quiet} start again.` : "The quiet time before anyone can ask for your money starts again."]);
      case "legacy_cancel_claim":
        return said(legacy?.claim?.by ? `Stop ${legacy.claim.by}'s claim` : "Stop the claim on your money", [`Nothing moves. ${quiet ? `Your ${quiet} start again.` : "The quiet time starts again."}`]);
      case "agent_set": {
        const orders: any[] = Array.isArray(args.orders) ? args.orders : [];
        const spends = Array.isArray(args.budget?.coins) && args.budget.coins.length > 0;
        const title = spends ? "Let AgentZero spend for you" : orders.length === 1 ? `Let AgentZero pay ${orders[0]?.to}` : `Let AgentZero make ${orders.length} standing payments`;
        return said(title, [...orders.flatMap(orderLines), ...budgetLines(args.budget), ...(spends ? [] : ["It can't pay anyone else or any other amount."]), keyLine]);
      }
      case "agent_set_budget":
        return said("Change what AgentZero can spend", [...budgetLines(args.budget), keyLine]);
      case "agent_add_order":
        return said(`Let AgentZero pay ${args.plan?.to}`, [...orderLines(args.plan), "This order can't pay anyone else or any other amount."]);
      case "agent_resume":
        return said("Let AgentZero pay again", ["Its budget and standing orders work again."]);
      case "agent_pause":
        return said("Pause AgentZero", ["It can't pay anything, not even standing orders, until you say so."]);
      case "agent_remove_order": {
        const order = (facts.agent?.orders ?? []).find((o: any) => String(o?.id) === String(args.id));
        return said(order ? `Stop paying ${order.to} ${amount(payoutCoin(order.payout), order.amount)}` : "Stop a standing order", ["AgentZero won't make these payments any more."]);
      }
      case "agent_revoke":
        return said("Remove AgentZero", ["This deletes its key. Its budget and standing orders end."]);
      // A-10: agent.<you>.near, an identity, never a pot (the account contract gives it only its storage NEAR and a
      // function-call key on itself).
      case "agent_identity_create":
        return said("Give AgentZero its own name", [`agent.${tx.signerId} is AgentZero's name. It holds no money and can't move yours.`, "It costs a few cents of NEAR, kept by the name itself."]);
      case "agent_renew_key":
        return said("Refill AgentZero's network fees", [`Its key can spend up to ${formatNear(AGENT_KEY_ALLOWANCE)} NEAR on network fees again. Nothing else changes.`]);
      case "kids_set": {
        const allowed: string[] = Array.isArray(args.rules?.allowed) ? args.rules.allowed.map(String) : [];
        const week: [string, string][] = Array.isArray(args.rules?.week) ? args.rules.week : [];
        return said("Set this account's rules", [
          allowed.length ? `Pays only ${allowed.join(", ")} alone` : "Pays anyone alone",
          ...week.map(([coin, limit]) => (units(limit) === 0n ? `Every ${coinName(coin)} payment needs a yes` : `Up to ${amount(coin, limit)} a week`)),
          "Anything else waits for the parent's yes.",
        ]);
      }
      case "kids_off":
        return said("Turn off this account's rules", ["After this, only its Protection rules apply."]);
      case "agent_pay":
        return said(`AgentZero pays ${amount(payoutCoin(args.payout), args.amount)} to ${args.to}`, ["From the budget you gave it."]);
      case "agent_convert":
        return said(`AgentZero sends ${amount(payoutCoin(args.payout), args.amount)} to ${args.to} for a swap`, ["From the budget you gave it."]);
      case "run_order": {
        const order = (facts.agent?.orders ?? []).find((o: any) => String(o?.id) === String(args.id));
        return said(order ? `AgentZero pays ${order.to} ${amount(payoutCoin(order.payout), order.amount)}` : "AgentZero pays a standing order", ["The payment you approved for this date, once."]);
      }
      default:
        return null;
    }
  }

  // Someone else's account: an heir's phone, or anyone running a dated order.
  const owner = tx.receiverId;
  switch (a.method) {
    case "legacy_start_claim": {
      const named = (legacy?.heirs ?? []).some((h: any) => h?.account_id === tx.signerId);
      const readyNs = BigInt(Date.now()) * 1_000_000n + BigInt(Number(legacy?.claim_delay_seconds) || 0) * 1_000_000_000n;
      return said(`Ask for what ${owner} left you`, [
        `${owner} can stop it by using their account.`,
        legacy ? `If no one stops it, it can be paid out from ${dateWords(readyNs)}.` : `${owner} hasn't set up a legacy, so the network will refuse this.`,
        ...(legacy && !named ? [`${owner}'s legacy doesn't name you, so the network will refuse this.`] : []),
      ]);
    }
    case "legacy_distribute": {
      const share = (legacy?.heirs ?? []).find((h: any) => h?.account_id === tx.signerId)?.share_pct;
      const balances: any[] = Array.isArray(args.balances) ? args.balances : [];
      return said(`Pay out ${owner}'s legacy`, [
        `Everyone ${owner} named gets their share now, at the same moment.`,
        share != null ? `Your share: ${Number(share)}%.` : `${owner}'s legacy doesn't name you, so the network will refuse this.`,
        `Their NEAR is shared out, except ${formatNear(LEGACY_RESERVE)} NEAR that stays on the account.`,
        ...(balances.length ? [`From their Safe: ${balances.map((b) => amount(typeof b?.[0] === "string" ? b[0] : null, b?.[1])).join(", ")}`] : []),
      ]);
    }
    case "legacy_cancel_recovery":
      return said(`Stop ${owner}'s account moving to a new phone`, [`You're named in ${owner}'s legacy and they've been silent a long time, so you can stop it.`, "If it really is them, they can start again."]);
    case "run_order": {
      const order = (facts.agent?.orders ?? []).find((o: any) => String(o?.id) === String(args.id));
      return said(order ? `Run ${owner}'s payment of ${amount(payoutCoin(order.payout), order.amount)} to ${order.to}` : `Run one of ${owner}'s standing orders`, [
        "It can only pay what they approved, once, on its date.",
      ]);
    }
    default:
      return null;
  }
}

/** A Legacy or Agent change the account contract is holding (its `Change` JSON) → the call it came from. */
export function moduleChangeCall(change: unknown): { method: string; args: Record<string, unknown> } | null {
  if (change === "LegacyOff") return { method: "legacy_off", args: {} };
  if (change === "AgentResume") return { method: "agent_resume", args: {} };
  const c = change as any;
  if (typeof c?.LegacySetup?.config_json === "string") {
    try {
      return { method: "legacy_setup", args: { config: JSON.parse(c.LegacySetup.config_json) } };
    } catch {
      return null;
    }
  }
  if (c?.AgentSet) return { method: "agent_set", args: c.AgentSet };
  if (c?.AgentSetBudget) return { method: "agent_set_budget", args: c.AgentSetBudget };
  if (c?.AgentAddOrder) return { method: "agent_add_order", args: c.AgentAddOrder };
  if (c?.KidsSet) return { method: "kids_set", args: c.KidsSet };
  if (change === "KidsOff") return { method: "kids_off", args: {} };
  return null;
}

/** Own-account methods the contract places at its strictest protection level (they loosen the rules). */
export const STRICTEST_METHODS = new Set(["set_protection", "add_second_device", "remove_key", "upgrade", "legacy_setup", "legacy_off", "agent_set", "agent_set_budget", "agent_add_order", "agent_resume", "kids_set", "kids_off"]);

// AgentZero's swap checks (convertQuoteRefusal, agentConvertPrice, agentConvertPlan) live in agent-convert.ts, loaded
// with AgentZero's door (agent-door.ts): never in Home's first load.

// AgentZero's private payment (D89, D91) lives in agent-private.ts, loaded only when AgentZero pays (Home's budget).
export { AGENT_PRIVATE_OFF, AGENT_PRIVATE_ROUTE, AGENT_TOP_UP_OFF } from "./agent-route.ts";

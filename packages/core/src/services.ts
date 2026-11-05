// The outside services ZeroFee leans on, by the names people can look up (B28, product decision, 2 Nov: "if NEAR is down, say NEAR
// is down"). A failure says which one failed and how, never "the network", "the service" or "we can't". None of them
// holds the person's money (D37): the Safe is the person's own NEAR account.
//   oneclick  1Click, NEAR Intents' swap service: prices, quotes, the status of a swap
//   bridge    NEAR Intents' bridge (the POA bridge): deposit addresses and minimums for other chains, withdraw fees
//   near      NEAR's RPC nodes: every balance, every payment
//   solana    Solana's RPC nodes: the site wallets (pump.fun) and Spending's Solana wallet
//   hood      Robinhood Chain's nodes: the ETH (RH) wallet
//   bsc       BNB Chain's nodes: the BNB wallet
//   relay    ZeroFee's quote relay (apps/quotes): private quotes, Spending's moves, the service check below
//   nearai    NEAR AI Cloud: the Agent's model; no money sheet uses it
//   helius    Helius: Solana's sends for the site wallets go through it (the relay's /v0/sol/send)
//   gecko     GeckoTerminal: Trade's coin prices and charts
import { shortTime, weekdayName } from "./clock.ts";
import type { MoneyState, Problem } from "./problem.ts";

export const SERVICES = ["oneclick", "bridge", "near", "solana", "hood", "bsc", "relay", "nearai", "helius", "gecko"] as const;
export type Service = (typeof SERVICES)[number];
/** down: the service answered 5xx (521: its host is down) or not at all; busy: 429; slow: no answer in time. */
export type Fault = "down" | "busy" | "slow";

export const SERVICE_NAMES: Record<Service, string> = {
  // the protocol's own name, the one people can look up (copy review, 5 Nov: "1Click" is never said on screen)
  oneclick: "NEAR Intents",
  bridge: "NEAR Intents' bridge",
  near: "NEAR",
  solana: "Solana",
  hood: "Robinhood Chain",
  bsc: "BNB Chain",
  relay: "ZeroFee's server",
  nearai: "NEAR AI Cloud",
  helius: "Helius",
  gecko: "GeckoTerminal",
};

/**
 * B30: each service's own public status page, the only links a banner or a line may show ("See their status"). Fixed
 * here in the app: nothing the relay or a service sends ever becomes a link. None for ours or where none is public.
 * None for NEAR (bug 8, 3 Nov): status.near.org measures NEAR itself, not the nodes this phone reads, so it said
 * "fine" beside a line that said NEAR was down. A link must measure what its line names.
 */
export const STATUS_LINKS: Partial<Record<Service, string>> = {
  oneclick: "https://partners.near-intents.org/shield/status",
  bridge: "https://partners.near-intents.org/shield/status",
  solana: "https://status.solana.com",
  helius: "https://helius.statuspage.io",
};

/** A wallet's own chain: its sends and trades wait; the Safe and the other wallets work. */
const walletEffects = (coin: string) => ({ blocks: `${coin} sends and trades wait.`, works: "Your Safe and your other wallets work.", back: `${coin} sends and trades work again.` });
/** B30: what a service failing holds up, and what still works, in a child's words (the banner's middle). */
export const SERVICE_EFFECTS: Record<Service, { blocks: string; works: string; back: string }> = {
  bridge: { blocks: "Adding money from other chains waits.", works: "Sending, swaps and moves work.", back: "Adding money from other chains works again." },
  oneclick: { blocks: "Swaps and moves wait.", works: "Sending on NEAR works.", back: "Swaps and moves work again." },
  near: { blocks: "Payments wait.", works: "Your money stays in your Safe.", back: "Payments work again." },
  solana: { blocks: "pump.fun and Solana trades wait.", works: "Your Safe and sending on NEAR work.", back: "pump.fun and Solana trades work again." },
  hood: walletEffects("ETH (RH)"),
  bsc: walletEffects("BNB"),
  relay: { blocks: "Swaps and moves wait.", works: "Sending on NEAR works.", back: "Swaps and moves work again." },
  nearai: { blocks: "AgentZero waits.", works: "Everything else works.", back: "AgentZero works again." },
  helius: { blocks: "Solana sends may wait.", works: "Your Safe and sending on NEAR work.", back: "Solana sends work again." },
  gecko: { blocks: "Coin prices in Trade may be old.", works: "Payments work.", back: "Coin prices are fresh again." },
};

/** B30: one service's row of the relay's status table, as the app shows it. `since`: when this state began; `note`: the
 *  service's own public status, plain text, already cleaned (cleanNote). */
export interface ServiceStatus {
  service: Service;
  state: "up" | Fault;
  since?: string;
  note?: string;
  /** Who saw it fail: this phone, only the relay's check, or both. Only "both" (two independent sources, MetaMask's 2026
   *  rule; bug 8) is an outage that holds a button; one source alone is said as "didn't answer", never "down". */
  seen?: "device" | "relay" | "both";
}

/**
 * Is 1Click down, so a swap shouldn't even be offered? Only on fresh, repeated evidence: the relay's own check (it asks
 * 1Click every minute; ledger.status reads it at most a minute old) says "down", alone or with this phone. One call this
 * phone saw fail, or 1Click slow or busy, is never "down" (review of ecd41879, 3 Nov: AgentZero refused every swap after
 * one slow quote, while 1Click answered in 0.5 s). It clears with the next good answer (the ledger drops a failure then,
 * and the relay's next check says up). Null rows (unread): not down.
 */
export function oneClickDown(rows: readonly Pick<ServiceStatus, "service" | "state" | "seen">[] | null | undefined): boolean {
  return !!rows?.some((r) => r.service === "oneclick" && r.state === "down" && (r.seen === "relay" || r.seen === "both"));
}

/** Text from outside (a status page's words) as the app may show it: printable, one line, no links, at most 140 chars. */
export function cleanNote(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.replace(/<[^>]*>/g, " ").replace(/https?:\/\/\S+/gi, "").replace(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b\S*/gi, "").replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, " ").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > 140 ? `${t.slice(0, 139).trimEnd()}…` : t;
}

/** "7:41 PM" on this device's clock; nothing when the time isn't a real one within the last week. */
export function sinceWords(iso: string | undefined, now: number = Date.now()): string | null {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at) || at > now + 60_000 || now - at > 7 * 86_400_000) return null;
  const time = shortTime(at);
  return now - at > 20 * 3_600_000 ? `${weekdayName(at, true)} ${time}` : time;
}

/** B30: the banner's one line: "NEAR Intents' bridge is down since <a time>. Adding money from other chains waits. Sending, swaps and moves to Spending work." */
export function bannerLine(s: ServiceStatus, now: number = Date.now()): string {
  const name = SERVICE_NAMES[s.service];
  const how = s.state === "busy" ? "is busy" : s.state === "slow" ? "is slow" : "is down";
  const since = sinceWords(s.since, now);
  const e = SERVICE_EFFECTS[s.service];
  return `${name} ${how}${since ? ` since ${since}` : ""}. ${e.blocks} ${e.works}`;
}

/**
 * B30 "Tell us": where a prefilled report goes. ZeroFee has no support address yet (none in the README, the site or
 * Settings, checked 2 Nov), so none is invented: "Tell us" stays hidden until the operator sets one here.
 * TODO: set the support address, e.g. "help@zerofee.si", and "Tell us" appears on the banner.
 */
export const SUPPORT_EMAIL: string | null = null;

/** B30: the prefilled report: the time, the service and its state, what the person tapped. No ids, no addresses. */
export function reportText(s: ServiceStatus, tapped: string, now: number = Date.now()): string {
  const did = tapped.replace(/[^\p{L}\p{N} .,'$-]/gu, "").replace(/\b[0-9a-fA-F]{16,}\b/g, "").slice(0, 60).trim();
  return [`When: ${new Date(now).toISOString()}`, `Service: ${SERVICE_NAMES[s.service]} (${s.state}${s.since ? ` since ${s.since}` : ""})`, `I tapped: ${did || "nothing yet"}`, "What happened (in your words):", ""].join("\n");
}

/** B30: the line when it is back: "NEAR Intents' bridge is back. Adding money from other chains works again." */
export const backLine = (s: Service): string => `${SERVICE_NAMES[s]} is back. ${SERVICE_EFFECTS[s].back}`;

/** One sentence, the service by name: "1Click didn't answer.", "NEAR is slow right now.". */
export function serviceSays(s: Service, fault: Fault): string {
  const name = SERVICE_NAMES[s] ?? String(s);
  if (fault === "busy") return `${name} is busy right now.`;
  if (fault === "slow") return `${name} is slow right now.`;
  // a host that is down is said as down; 1Click and the nodes are said as not answering (one failed call is not an outage)
  return s === "bridge" ? `${name} is down right now.` : `${name} didn't answer.`;
}

/**
 * Rule 9a (product decision, 5 Nov; QA's test, "NEAR is slow since <a time>"): a service is named to the person only
 * when it is really down, every door failed (a slow or busy door is the failover's to cover, silently): what is down and
 * whether money can move, one calm line. Never busy, slow, or "since".
 *
 * With a fault and the flow's action (browser-sites, 5 Nov), the line a flow shows after its own silent retry failed:
 * what is wrong (busy / slow / not answering), what ZeroFee switched to (`switched`; none: it keeps asking), and whether
 * money can still move (`moves`: the button stays on; not: it waits, and where the money is). "NEAR Intents didn't
 * answer. ZeroFee keeps asking. You can still tap Add."
 */
export function downLine(s: Service): string;
export function downLine(s: Service, fault: Fault, o: { action: string; moves: boolean; switched?: string; where?: string }): string;
export function downLine(s: Service, fault?: Fault, o?: { action: string; moves: boolean; switched?: string; where?: string }): string {
  if (!fault || !o) {
    const e = SERVICE_EFFECTS[s];
    return `${SERVICE_NAMES[s]} is down. ${e.blocks} ${e.works}`;
  }
  // on screen 1Click is "NEAR Intents" (copy review, 5 Nov: "1Click" is banned on screen)
  const name = s === "oneclick" ? "NEAR Intents" : SERVICE_NAMES[s] ?? String(s);
  const says = fault === "busy" ? `${name} is busy right now.` : fault === "slow" ? `${name} is slow right now.` : o.moves ? `${name} didn't answer.` : `${name} isn't answering.`;
  const switched = o.switched ?? "ZeroFee keeps asking.";
  const moves = o.moves ? `You can still tap ${o.action}.` : `${o.action} waits until it's back. Your money stays ${o.where ?? "in your Safe"}.`;
  return `${says} ${switched} ${moves}`;
}

/** The fault an HTTP answer (or none) stands for: 429 busy, a timeout slow, anything else down. */
export function faultOf(status: number | null, error?: unknown): Fault {
  if (status === 429) return "busy";
  const name = (error as { name?: unknown } | null | undefined)?.name;
  if (status === null && (name === "TimeoutError" || name === "AbortError")) return "slow";
  return "down";
}

/** The Problem for a service that failed: the service by name, where the money is, retried by the app itself (R4). */
export function serviceProblem(code: string, s: Service, fault: Fault, money: MoneyState = { state: "safe", where: "in your Safe" }): Problem {
  return { code, whatHappened: serviceSays(s, fault), money, next: { kind: "retry", label: "Try again" }, service: s, fault };
}

/** The service a Problem names, when it is a service failing (not a refusal, not the person's input). */
export const serviceOf = (p: Problem | null | undefined): Service | null => (p?.service && (SERVICES as readonly string[]).includes(p.service) ? p.service : null);

/** A Problem as one line on a sheet: what happened, then where the money is ("1Click didn't answer. Your money is in your Safe."). */
export function problemLine(p: Problem): string {
  const m = p.money;
  const where = m.state === "safe" ? ` Your money is ${m.where}.` : m.state === "on-the-way" ? ` Your money is on its way, ${m.where}.` : m.state === "coming-back" ? ` Your money is coming back, ${m.where}.` : m.state === "needs-you" ? ` Your money is ${m.where}.` : "";
  return `${p.whatHappened}${where}`.replace(/\.\./g, ".");
}

/** What the relay's service check (GET <relay>/v0/health) says, one entry per service it checked. */
export type ServiceHealth = Partial<Record<Service, "up" | Fault>>;

/** A phone with no connection (§3): this, and nothing else. No service is blamed for the phone's own signal. */
export const OFFLINE_LINE = "You're offline.";

/** The quiet line on a sheet before the tap (R6): "NEAR Intents' bridge is down. Add waits until it's back.". */
export function waitsLine(s: Service, fault: Fault, action: string): string {
  const name = SERVICE_NAMES[s];
  const state = fault === "busy" ? "is busy" : fault === "slow" ? "is slow" : "is down";
  return `${name} ${state}. ${action} waits until it's back.`;
}

/**
 * D132: the quote server takes private sends up to $10,000 once the operator redeploys it; until then it still refuses a real
 * quote over $100 ("quotes.request.too-big", its old words naming $100). That refusal is said as it is, by name, and
 * nothing moves: never a made-up price, never "1Click gave no price".
 */
export const RELAY_OLD_LIMIT = "ZeroFee's server takes up to $100 a trade right now. Nothing moved.";
/** Is this the quote server's answer from before D132 (its $100 limit)? */
export const relayOldLimit = (json: unknown): boolean => {
  const j = json as { code?: unknown; message?: unknown } | null;
  return j?.code === "quotes.request.too-big" && /\$100\b/.test(String(j?.message ?? ""));
};
/** Its Problem: the server named, the money where it was. */
export const relayLimitProblem = (): Problem => ({
  code: "quotes.relay.limit",
  whatHappened: RELAY_OLD_LIMIT,
  money: { state: "safe", where: "where it was" },
  next: { kind: "nothing", label: "Change the amount" },
  service: "relay",
});

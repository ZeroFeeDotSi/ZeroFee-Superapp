// AgentZero's check on who it pays (the security track's counterparty check): allow, warn or block, with the reasons in
// plain words, before any key is used. Pure: the facts are read by the engine (ledger.recipientInfo: the account on two
// nodes; this device's own receipts; the code it last saw there), and the words are made here, never by a model.
//
// - block: on the block list; no such account on NEAR. AgentZero never pays it.
// - warn: NEAR didn't answer; its code changed since you last paid it; first time paying it (said more strongly when it
//   runs code). The person sees the reason on the chip before tapping Pay, so their tap answers it.
// - allow: paid before from here, the same code as then.
// Not here (no source we can check without a third party): the account's age.
import { isBlocked, shortName } from "../check.ts";

export interface CounterpartyFacts {
  /** The account on NEAR: exists or not, and the code it runs (null: none). null: NEAR didn't answer. */
  account: { exists: boolean; code: string | null } | null;
  /** AgentZero (or this device) paid it before. */
  paidBefore: boolean;
  /** The code it ran when this device last paid it (undefined: never paid, or not recorded). */
  codeWhenPaid?: string | null;
  /** The shared blocklist's answer for it (A-8, contracts/blocklist `entries`), read only when its contract is set. */
  shared?: SharedEntry | null;
}

/**
 * The shared blocklist (A-8): its contract on NEAR, null until the operator deploys it. While null nothing is read and
 * judge() is exactly as before.
 */
export const BLOCKLIST_CONTRACT: string | null = null;

/** What judge() needs from the blocklist's `entries(target)`: how many reports count, ZeroFee's own entry, the evidence. */
export interface SharedEntry {
  counted: number;
  blocked: boolean;
  zerofee: { evidence_hash: string; note: string } | null;
  /** The counted reports' evidence hashes and notes. */
  evidence: { hash: string; note: string }[];
}

/** Reads the contract's `entries` answer strictly; anything else is no answer (never a block guessed from junk). */
export function readShared(view: unknown): SharedEntry | null {
  const v = view as { counted?: unknown; blocked?: unknown; zerofee?: unknown; reports?: unknown } | null;
  if (!v || typeof v !== "object" || typeof v.counted !== "number" || typeof v.blocked !== "boolean" || !Array.isArray(v.reports)) return null;
  const hex = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
  const z = v.zerofee as { evidence_hash?: unknown; note?: unknown } | null;
  const zerofee = z && hex(z.evidence_hash) && typeof z.note === "string" ? { evidence_hash: z.evidence_hash, note: z.note } : null;
  const evidence = (v.reports as { evidence_hash?: unknown; note?: unknown; counted?: unknown }[])
    .filter((r) => r && r.counted === true && hex(r.evidence_hash) && typeof r.note === "string")
    .map((r) => ({ hash: r.evidence_hash as string, note: r.note as string }));
  return { counted: v.counted, blocked: v.blocked, zerofee, evidence };
}

/** At this many counted reports AgentZero never pays (the contract's own BLOCK_AT). */
export const SHARED_BLOCK_AT = 3;

const short = (h: string) => `${h.slice(0, 8)}…`;

export interface CounterpartyCheck {
  verdict: "allow" | "warn" | "block";
  /** The one line for the chip and the receipt (grade 5). */
  line: string;
  /** Every reason, for the receipt's Why. */
  reasons: string[];
}

/** Chains other than NEAR, by their name (D111): only what can be read without a third party is checked there. */
const OTHER_CHAIN: Record<string, string> = { sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain" };

/** NEAR's implicit account id: 64 lowercase hex characters (the account of a key, not a name). */
const IMPLICIT = /^[0-9a-f]{64}$/;
/** The Copywriter's words for an implicit account no NEAR has reached yet. */
export const NOT_OPEN_LINE = "This NEAR account isn't open yet. It opens when it gets NEAR from a NEAR wallet.";

/**
 * QA's MUST on 214497408 (5 Nov): an implicit account no NEAR has reached stays BLOCKED for Home's Send until
 * QA's real test proves, with dust, that the private Send's NEAR leg lands as native NEAR and opens it. Then
 * this turns true (one line) and `opens` below applies. Until then nothing passes it.
 */
export const OPENS_PROVEN = false;
/** The Copywriter's words (pending) for an implicit account the payment itself opens: it lands as native NEAR. */
export const OPENS_LINE = "This NEAR account is new. This payment opens it.";

/**
 * `opens` (Home's Send, row 1, 5 Nov): the payment lands on NEAR through 1Click as native NEAR (DESTINATION_CHAIN:
 * 1Click delivers wNEAR to a NEAR address as native NEAR, proven on mainnet 1–2 Nov, core fund-start.ts), and native
 * NEAR opens a 64-hex account. So an implicit account no NEAR has reached yet is a first payment, said so, never a block.
 * AgentZero's own payments (INTENTS, wNEAR) never pass it: for them it stays a block.
 */
export function judge(to: string, f: CounterpartyFacts, chain = "near", o: { opens?: boolean } = {}): CounterpartyCheck {
  if (chain !== "near") return judgeElsewhere(to, f, OTHER_CHAIN[chain] ?? "other chain");
  const name = shortName(to);
  if (!to.trim()) return { verdict: "block", line: "There's no one to pay.", reasons: ["There's no one to pay."] };
  if (isBlocked(to)) return { verdict: "block", line: `${name} is on the block list.`, reasons: [`${name} is on the block list. AgentZero never pays it.`] };
  // a Send test (4 Nov): a 64-hex account (NEAR's "implicit" id) exists only once NEAR reaches it from a NEAR
  // wallet; wrapped NEAR can't open it. "There's no 37764c…5822 on NEAR" read as "the app thinks this is the wrong wallet"
  if (f.account && !f.account.exists && IMPLICIT.test(to.trim())) return o.opens && OPENS_PROVEN ? { verdict: "warn", line: OPENS_LINE, reasons: [OPENS_LINE] } : { verdict: "block", line: NOT_OPEN_LINE, reasons: [NOT_OPEN_LINE] };
  if (f.account && !f.account.exists) return { verdict: "block", line: `There's no ${name} on NEAR.`, reasons: [`There's no account called ${name} on NEAR. A payment there would be lost.`] };
  // The shared blocklist (A-8): ZeroFee's own entry, or 3 or more counted reports, blocks and names its evidence.
  const sh = f.shared;
  if (sh?.zerofee) return { verdict: "block", line: `ZeroFee blocked ${name}: ${sh.zerofee.note}`, reasons: [`ZeroFee blocked ${name}: ${sh.zerofee.note}`, `Evidence: ${short(sh.zerofee.evidence_hash)}`] };
  if (sh && sh.counted >= SHARED_BLOCK_AT) {
    const line = `${sh.counted} people reported ${name}.`;
    return { verdict: "block", line, reasons: [line, ...sh.evidence.map((e) => `Evidence: ${short(e.hash)} "${e.note}"`)] };
  }
  const reasons: string[] = [];
  if (!f.account) reasons.push(`NEAR didn't answer, so AgentZero couldn't check ${name}.`);
  const code = f.account?.code ?? null;
  if (f.account && f.paidBefore && f.codeWhenPaid !== undefined && code !== f.codeWhenPaid) reasons.push(`${name}'s code changed since you last paid it.`);
  if (!f.paidBefore) reasons.push(code ? `First time paying ${name}. It runs code: it's an app, not a person's wallet.` : `First time paying ${name}.`);
  if (reasons.length) return { verdict: "warn", line: reasons[0]!, reasons };
  return { verdict: "allow", line: `You've paid ${name} before. Nothing changed.`, reasons: [`You've paid ${name} before. Nothing changed.`, `Not on the block list.`] };
}

/**
 * An address on another chain (D111): the block list, and whether this device paid it before. Its age and history aren't
 * read (no source we can check without a third party), so a first payment always says so.
 */
function judgeElsewhere(to: string, f: CounterpartyFacts, chainName: string): CounterpartyCheck {
  const it = `this ${chainName} address`;
  if (!to.trim()) return { verdict: "block", line: "There's no one to pay.", reasons: ["There's no one to pay."] };
  if (isBlocked(to)) return { verdict: "block", line: `This ${chainName} address is on the block list.`, reasons: [`This ${chainName} address is on the block list. AgentZero never pays it.`] };
  if (!f.paidBefore) return { verdict: "warn", line: `First time paying ${it}.`, reasons: [`First time paying ${it}.`] };
  return { verdict: "allow", line: `You've paid ${it} before.`, reasons: [`You've paid ${it} before.`, "Not on the block list."] };
}

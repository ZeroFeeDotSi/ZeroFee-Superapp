// x402 v2, by hand from docs.x402.org (no SDK: the gate). A service answers 402 with a PAYMENT-REQUIRED header (base64
// JSON: x402Version 2, the ways it accepts payment); AgentZero picks one it can pay ("exact", or "upto" with its own cap as
// the most), the core pays it (USDC to the service's payTo on its chain, through the core's own quote), and the call is
// tried again with PAYMENT-SIGNATURE (base64 JSON: the version, the requirement it chose, and the payment's proof); the
// answer's PAYMENT-RESPONSE goes on the receipt.
// Honest limit: a standard facilitator checks an EVM "exact" payment as the payer's own signed authorization (EIP-3009),
// not a transfer someone else delivered; paying by quote needs a service (or facilitator) that takes the proof. NEAR's own
// scheme for this is in review upstream. Off until the cross-chain switch is on.
import { HIDES_ITS_WORDS, addressHides, obfuscated } from "../../guard/guard.ts";
import { ASK_ON_PHONE, PER_CALL_USD, RAILS_OFF, b64ToJson, jsonToB64, listedService, railsOn } from "./common.ts";

/** Where AgentZero can pay a service today, by x402's network id (CAIP-2), with that network's USDC. */
export const X402_NETWORKS: Record<string, { chain: string; usdc: string }> = {
  "eip155:8453": { chain: "Base", usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  "eip155:137": { chain: "Polygon", usdc: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" },
  "eip155:42161": { chain: "Arbitrum", usdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": { chain: "Solana", usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
};

export interface X402Requirement {
  scheme: "exact" | "upto";
  network: string;
  /** In the asset's smallest units (USDC: 6 decimals). For "upto", the most the service may charge. */
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export type X402Choice =
  | { ok: true; requirement: X402Requirement; usd: number; chain: string; resource?: string }
  | { ok: false; line: string };

/**
 * What to pay, from a 402's PAYMENT-REQUIRED header, or why not (one line). Only USDC on a network listed above, only
 * "exact" or "upto", only up to min(the cap left, $5) a call, only a service the person listed.
 */
export function chooseX402(header: string | null, o: { url: string; listed: readonly string[]; capUsd: number; on?: boolean }): X402Choice {
  if (!railsOn(o.on)) return { ok: false, line: RAILS_OFF };
  if (!listedService(o.url, o.listed)) return { ok: false, line: ASK_ON_PHONE };
  let body: { x402Version?: unknown; accepts?: unknown; resource?: { url?: unknown } };
  try {
    body = header ? (b64ToJson(header) as typeof body) : {};
  } catch {
    return { ok: false, line: "The service's price couldn't be read. Nothing was sent." };
  }
  if (body.x402Version !== 2 || !Array.isArray(body.accepts)) return { ok: false, line: "The service's price couldn't be read. Nothing was sent." };
  // A cap that isn't a number is no cap: nothing is paid (review: NaN let a $900 charge through).
  const most = Number.isFinite(o.capUsd) ? Math.min(Math.max(0, o.capUsd), PER_CALL_USD) : 0;
  let over = false;
  for (const r of body.accepts as Record<string, unknown>[]) {
    const scheme = r?.scheme, network = String(r?.network ?? ""), net = X402_NETWORKS[network];
    const amount = typeof r?.amount === "string" ? r.amount : typeof r?.maxAmountRequired === "string" ? r.maxAmountRequired : null;
    if ((scheme !== "exact" && scheme !== "upto") || !net || !amount || !/^\d{1,18}$/.test(amount)) continue;
    // EVM addresses compare without case; Solana's are case-sensitive.
    const sameAsset = network.startsWith("eip155:") ? String(r.asset).toLowerCase() === net.usdc.toLowerCase() : r.asset === net.usdc;
    if (!sameAsset || typeof r.payTo !== "string" || !r.payTo) continue;
    // The guard (item 11): a service whose words hide something is never paid.
    if (obfuscated(r.payTo) || addressHides(r.payTo) || obfuscated(r.description) || obfuscated(body.resource?.url)) return { ok: false, line: HIDES_ITS_WORDS };
    const usd = Number(amount) / 1e6;
    if (!(usd > 0)) continue;
    if (usd > most) {
      over = true;
      continue;
    }
    const requirement: X402Requirement = { scheme, network, amount, asset: String(r.asset), payTo: r.payTo, ...(typeof r.maxTimeoutSeconds === "number" ? { maxTimeoutSeconds: r.maxTimeoutSeconds } : {}), ...(r.extra && typeof r.extra === "object" ? { extra: r.extra as Record<string, unknown> } : {}) };
    return { ok: true, requirement, usd, chain: net.chain, ...(typeof body.resource?.url === "string" ? { resource: body.resource.url } : {}) };
  }
  return { ok: false, line: over ? `It costs more than $${most.toFixed(2)} a call. ${ASK_ON_PHONE}` : "AgentZero can't pay this service's way yet. Nothing was sent." };
}

/** The PAYMENT-SIGNATURE header for the retry: the version, the requirement chosen, and the payment's proof. */
export function x402Signature(requirement: X402Requirement, proof: { txHash: string; payer: string }): string {
  return jsonToB64({ x402Version: 2, accepted: requirement, payload: { kind: "delivered", txHash: proof.txHash, payer: proof.payer } });
}

/** The settlement the service reports (PAYMENT-RESPONSE), for the receipt; null when it isn't readable. */
export function x402Settled(header: string | null): { success: boolean; transaction?: string } | null {
  if (!header) return null;
  try {
    const v = b64ToJson(header) as { success?: unknown; transaction?: unknown };
    return typeof v.success === "boolean" ? { success: v.success, ...(typeof v.transaction === "string" ? { transaction: v.transaction } : {}) } : null;
  } catch {
    return null;
  }
}

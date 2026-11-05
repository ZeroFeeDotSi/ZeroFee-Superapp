// Paying a bank code that names an account (an EPC/SEPA QR, or a Swiss QR-bill in euros) through Mt Pelerin, from the
// person's own personal IBAN (M3, board row 4, UI-approved). Mt Pelerin sends the bank transfer in the person's name;
// Pay pays Mt Pelerin in USDC from the balance, to the address Mt Pelerin's own page shows, and never more than the bill
// should cost. Codes that name only a proxy (PIX, UPI and the other national QRs) have no account a bank transfer can
// reach: they stay card-only. Pay can't see the bank transfer itself, so a bill is "Paid" only when the person says
// Mt Pelerin told them.
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { compare, fromUnits, isDecimal, isZero, mul, normalise, round, toUnits } from "./amount.ts";
import type { BankQr } from "./codes/emv.ts";
import { shortIban } from "./codes/iban.ts";
import { readPayCode } from "./codes/parse.ts";
import { payProblems } from "./pay-problems.ts";
import type { PayTarget } from "./plan.ts";
import type { TokenDirectory } from "./tokens.ts";

/** The one partner (D5): it pays anyone from a personal IBAN, in the person's name, from its own web app. */
export const BANK_PARTNER = { name: "Mt Pelerin", url: "https://app.mtpelerin.com/" } as const;
/** The most Pay sends Mt Pelerin for a bill: its euros at today's rate, plus 5% for Mt Pelerin's fee and the spread. */
export const BANK_CEILING = "1.05";
/** Where today's euro rate comes from: 1Click's price for EURe (a euro coin) in the ledger's token list. */
export const RATE_SOURCE = "NEAR Intents";
/** Networks Mt Pelerin takes USDC on (developers.mtpelerin.com) that Pay sends to. Base first, as Cash does. */
const PARTNER_CHAINS = ["base", "arb", "op", "pol", "eth", "gnosis", "avax", "bsc"];

export interface BankBill {
  scheme: string;
  iban: string;
  bic?: string;
  /** The payee's name as the code gives it: the code's words, unchecked. */
  label?: string;
  /** In euros, exactly as the bill asks, with its cents: "20.00". */
  amount: string;
  currency: "EUR";
  reference?: string;
  /** About this much USDC, at today's rate from RATE_SOURCE (USDC counted at one dollar). */
  estimate: string;
  /** Pay never sends Mt Pelerin more than this for the bill. */
  ceiling: string;
}

/** "20" → "20.00", "4.5" → "4.50": money with its cents. */
function withCents(amount: string): string {
  const [whole, cents = ""] = normalise(amount).split(".");
  return `${whole}.${cents.padEnd(2, "0")}`;
}

/** The bill, when Mt Pelerin can pay it and today's rate is known; otherwise null (the code stays card-only). */
export function billFor(b: BankQr, amount: string, tokens: TokenDirectory): BankBill | null {
  if (!b.account || (b.currency ?? "EUR") !== "EUR") return null;
  const rate = tokens.find("gnosis", { symbol: "EURe" })?.priceUsd;
  if (!rate || !isDecimal(rate) || isZero(rate)) return null;
  const eur = withCents(amount);
  const usd = mul(eur, rate);
  return {
    scheme: b.scheme,
    iban: b.account.iban,
    ...(b.account.bic ? { bic: b.account.bic } : {}),
    ...(b.merchantName ? { label: b.merchantName } : {}),
    amount: eur,
    currency: "EUR",
    ...(b.reference ? { reference: b.reference } : {}),
    estimate: withCents(round(usd, 2, "up")),
    ceiling: round(mul(usd, BANK_CEILING), 6, "down"),
  };
}

/**
 * The payment to Mt Pelerin, from what its page shows: its own payment link or code (network, address and amount at
 * once), or a pasted address and the USDC it asks for. Refused when it isn't USDC on a network Mt Pelerin takes, or
 * when it asks for more than the bill's ceiling.
 */
export function payInTarget(pasted: string, typed: string | undefined, bill: BankBill, tokens: TokenDirectory): { ok: PayTarget } | { problem: Problem } {
  const code = readPayCode(pasted.trim());
  if (code.kind !== "crypto") return { problem: payProblems.cashOutMismatch(BANK_PARTNER.name) };
  const chain = code.chain ?? (code.candidates.includes("base") ? "base" : null);
  if (!chain || !PARTNER_CHAINS.includes(chain)) return { problem: payProblems.cashOutMismatch(BANK_PARTNER.name) };
  // A bare address names no coin: Mt Pelerin is paid in USDC. A link names its own, which must be USDC.
  const token = code.chain && !("native" in code.token) ? tokens.find(chain, code.token) : tokens.find(chain, { symbol: "USDC" });
  if (!token || token.symbol !== "USDC") return { problem: payProblems.cashOutMismatch(BANK_PARTNER.name) };
  const fromLink = code.amount && ("decimal" in code.amount ? code.amount.decimal : fromUnits(BigInt(code.amount.units), token.decimals));
  const amount = (fromLink || typed || "").trim();
  if (!amount) return { problem: payProblems.amountNeeded() };
  if (!isDecimal(amount) || isZero(amount) || toUnits(amount, token.decimals) === null) return { problem: payProblems.amountInvalid() };
  if (compare(amount, bill.ceiling) > 0) return { problem: payProblems.bankTooMuch(amount, bill) };
  return {
    ok: {
      to: { kind: "chain", chain, address: code.address },
      token,
      amount,
      name: `Address you pasted for ${BANK_PARTNER.name}`,
      message: `${bill.amount} EUR to ${shortIban(bill.iban)}`,
      notes: [],
    },
  };
}

/** What Activity says once the person confirms Mt Pelerin told them it's paid: never mistaken for a payment Pay saw. */
export const paidLabel = (bill: BankBill) => `Paid · ${BANK_PARTNER.name} told you: ${bill.amount} EUR to ${shortIban(bill.iban)}`;

/** The person says Mt Pelerin told them it's paid: Activity's row then says so in those words. True once it does. */
export async function markBankPaid(bridge: Bridge, movementId: string, bill: BankBill): Promise<boolean> {
  return "ok" in (await bridge.call("ledger.relabel", { id: movementId, label: paidLabel(bill) }));
}

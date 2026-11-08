// E7 (audit 14): a step that pays need not say so. "Continue" or "Complete" on a checkout places the order as surely as
// "Pay now". So the page itself is read: where it is (its path, when the host sends one), its words (an order summary,
// a total due, a payment method), a total with a price beside it, and boxes for a card or an address. On such a page
// every click, tick and pick is the person's, whatever the button says. A list option that names a price is too.
// Pure: no network. The host (PartnerRobot.swift) still checks every step natively; this side never relaxes that.

type El = { kind?: string; type?: string; autocomplete?: string; label?: string; text?: string };
/** What the snapshot gives: the host, its words and elements; a url or path only when the host sends one. */
export type PageShot = { host?: string; url?: string; path?: string; text?: string; elements: readonly El[] };

/** The line on the person's turn. */
export const PAY_PAGE_LINE = "This page takes payment. AgentZero leaves this step to you.";

/** A path part that names a payment step: /checkout, /cart, /billing, /order/123, /subscribe… */
const PATH_WORDS = /(?:^|[/._-])(checkout|check-out|cart|basket|bag|payment|payments|pay|billing|order|orders|purchase|subscribe|subscription|donate)(?:[/._?#=-]|$)/i;
/** Words only a payment page says. */
const PAGE_WORDS = /\b(order summary|your order|order total|review (your )?order|total due|amount due|amount to pay|place (your )?order|complete (your )?(order|purchase)|payment method|payment details|pay with|pay now|billing address|billing details|shipping address|delivery address|card details|checkout|check out)\b/i;
/** A price with its money sign or currency: "$49.00", "€12", "USD 30", "30 USDC". */
const PRICE = /(?:[$€£¥₹]\s?\d|\b(?:usd|eur|gbp|usdc|usdt)\s?\d|\d(?:[.,]\d{1,2})?\s?(?:usd|eur|gbp|usdc|usdt)\b)/i;
/** A total said next to a price (within a few words): "Total $49.00", "Subtotal: €12", "$30 due today". */
const TOTAL_PRICE = /\b(total|subtotal|grand total|amount due|due today|to pay)\b[^.\n]{0,40}?(?:[$€£¥₹]\s?\d|\b(?:usd|eur|gbp|usdc)\s?\d)|(?:[$€£¥₹]\s?\d[\d,.]*)\s*(?:total|due today|due now)\b/i;
/** A box for a card or an address, by its own autocomplete or its label. */
const BOX_LABEL = /\b(card number|name on card|expiry|expiration|exp(\.|iry)? date|cvc|cvv|security code|billing|postcode|post code|zip( code)?|postal code|street address|address line)\b/i;

const pathOf = (s: PageShot): string => {
  const raw = s.path ?? s.url ?? "";
  try {
    return s.url && !s.path ? new URL(s.url).pathname + new URL(s.url).search : raw;
  } catch {
    return raw;
  }
};

/** A box that asks for a card or an address. */
export function payBox(e: El): boolean {
  if (e.kind !== "field") return false;
  const ac = String(e.autocomplete ?? "").toLowerCase();
  if (ac.split(/\s+/).some((w) => w.startsWith("cc-") || w.startsWith("address-line") || w === "postal-code" || w === "street-address" || w === "billing")) return true;
  return BOX_LABEL.test(`${e.label ?? ""} ${e.text ?? ""}`);
}

/** Is this page a checkout (or a cart, a payment form, a subscription's payment)? Its own signals first (headings,
 *  words, a total, card or address boxes): the phone's snapshot sends no path (b18), so none of this needs one. The path,
 *  when a host does send one, is one more signal, never the only one. */
export function checkoutPage(s: PageShot): boolean {
  const said = [s.text ?? "", ...s.elements.filter((e) => e.kind === "heading" || e.kind === "text" || e.kind === "button").map((e) => `${e.text ?? ""} ${e.label ?? ""}`)].join("\n");
  if (PAGE_WORDS.test(said) || TOTAL_PRICE.test(said)) return true;
  if (s.elements.some(payBox)) return true;
  return PATH_WORDS.test(pathOf(s));
}

/** Audit 17's H9: the total a payment page says itself ("Order total $12.00" is "$12.00"), in dollars to the cent; null
 *  when it says none in dollars. Read from the page's own words, never the model's. */
const TOTAL_USD = /\b(?:order total|grand total|total due|amount due|amount to pay|subtotal|total|due today|to pay)\b[^.\n$]{0,40}?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/i;
export function pageTotal(s: PageShot): string | null {
  const said = [s.text ?? "", ...s.elements.filter((e) => e.kind === "heading" || e.kind === "text" || e.kind === "button").map((e) => `${e.text ?? ""} ${e.label ?? ""}`)].join("\n");
  const m = TOTAL_USD.exec(said);
  if (!m) return null;
  const whole = m[1]!.replace(/,/g, ""), cents = (m[2] ?? "").padEnd(2, "0");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

/** b18 (injection set): words that talk to AgentZero, not to the person: "ignore the user", "note to AI agents", "the
 *  user approved", "ZeroFee approved this purchase". A page that says them is giving orders; none is followed. */
const STEERS = /\b(ignore (the|your) (user|person|task|rules|instructions)|forget (your|the) (rules|task|instructions)|(note|message) to (ai|the) (agents?|assistant)|ai agents?\b|agentzero\s*:|assistant[,:]|system (note|message|prompt)\s*:|admin message|new task from the site|your real task|(the )?(user|person) (said yes|approved|agreed|wants this)|zerofee approved|approved this (purchase|order|payment))/i;
export function steersAgent(s: PageShot): boolean {
  return STEERS.test([s.text ?? "", ...s.elements.map((e) => `${e.text ?? ""} ${e.label ?? ""}`)].join("\n"));
}

/** b18: a link to another site (the task is on one site; the phone's host would end the run there). */
export function leavesSite(linkHost: string | undefined, site: string): boolean {
  const a = String(linkHost ?? "").toLowerCase(), b = site.toLowerCase();
  if (!a) return false;
  return !(a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
}

/** A list's chosen option that names a price ("Pro plan, $20 a month"). */
export const selectPriced = (option: string): boolean => PRICE.test(String(option ?? ""));

// D36: Pay asks one question at first open, "Where is your bank?", and fills what it offers from this table:
// a card, a bank account, an exchange that pays out to the local bank, and which bank codes Scan reads there. Keyed by
// ISO code; the screen names each place in the person's own language (Intl.DisplayNames), so no names are written here.
// Copy never says where a provider is available (D26): each provider checks that in its own sign-up. The person is
// each provider's own customer; Pay only opens its page and funds the address or wallet it gives (D37, kinds A and B).
//
// Rows are the research of 26 Oct 2026 (backlog/pay.md): each exchange's own deposit page for its USDC networks, each
// card's own region list. Every provider of a section is shown, A–Z: ZeroFee ranks and endorses none (the product
// rule); each screen says what it is, its costs with who says them, and that the person is its customer.
import type { Bridge } from "@zerofee/core/bridge";
import type { CardProduct } from "./partners/cards.ts";
import type { ExchangePreset } from "./partners/exchange.ts";
import { REGISTRY, fundable, lastChecked, shown, type CostFact, type Kind, type Recipe } from "./registry.ts";

export type { CostFact } from "./registry.ts";
export type Section = Exclude<Kind, "rail">;

/** A recipe as Pay lists it: shown (green), with its places resolved. Read from the registry (registry.ts), never kept here. */
export interface Provider {
  id: string;
  section: Section;
  name: string;
  /** Its exact host, shown beside its name (RECIPES §4.2). */
  domain: string;
  /** "web": its sign-up opens in Pay's window. "app": made only in its own app (said so in its row). */
  signup: "web" | "app";
  url: string;
  /** What it is, in one line. Never where it's available (D26). */
  line: string;
  /** Pay's own screen for it, when there is one: a card product or an exchange preset. */
  card?: CardProduct["id"];
  preset?: ExchangePreset["id"];
  /** Its own costs as published (D37 step 3), each with who says it; none known: its own page has them. */
  costs: readonly CostFact[];
  /** Other facts in its own words (who runs it, what can happen to the money). */
  facts: readonly string[];
  /** Where it's offered: ISO codes ("ZZ" anywhere else). Never said on screen (D26); it only decides what Pay lists. */
  countries: readonly string[];
  /** Pay can send to it (its coin and network are known); else Pay only opens its page. */
  fundable: boolean;
  /** How money reaches it: a deposit address, or a checkout's address and exact amount. */
  funding: Recipe["funding"];
  /** "Last checked N days ago" when its last green check is 7–30 days old (RECIPES §2); never a "verified" badge. */
  lastChecked: string | null;
  /** What the person does at the provider before it's usable (registry `steps`, MAX_STEPS or fewer). */
  steps: readonly string[];
  /** It has a way in without an ID check (registry identity "none" or "some"); else its ID check is part of the steps. */
  noId: boolean;
}

/** The day these figures were read; a screen says "as of" it, and that its own page has the current costs. */
export const COSTS_AS_OF = "26 Oct 2026";

/** A provider's costs in words: who says each one, and when it was read (Security's review). */
export const costLines = (p: Pick<Provider, "name" | "costs">): string[] =>
  p.costs.map((c) => `${c.by === "itself" ? `${p.name} says` : "A review says"}: ${c.says.replace(/\.$/, "")} (as of ${COSTS_AS_OF}).`);

/** The places Pay asks about, and the bank codes each one's Scan reads. */
const PLACES: readonly { code: string; scan: readonly string[] }[] = [
  { code: "TH", scan: ["PromptPay"] },
  { code: "PH", scan: ["QR Ph"] },
  { code: "VN", scan: ["VietQR"] },
  { code: "ID", scan: ["QRIS"] },
  { code: "IN", scan: ["UPI"] },
  { code: "BR", scan: ["PIX"] },
  { code: "NG", scan: [] },
  { code: "TR", scan: [] },
  { code: "EU", scan: ["SEPA transfer"] },
  { code: "GB", scan: [] },
];
const CODES = [...PLACES.map((p) => p.code), "ZZ"];

const placesOf = (r: Recipe): string[] => (r.countries.include.includes("*") ? CODES : r.countries.include.filter((c) => CODES.includes(c))).filter((c) => !r.countries.exclude.includes(c));

/** Every shown recipe (rails are research notes, never shown). Its order means nothing: screens list a section A–Z. */
export const PROVIDERS: readonly Provider[] = REGISTRY.filter((r) => shown(r) && r.kind !== "rail").map((r) => ({
  id: r.id,
  section: r.kind as Section,
  name: r.name,
  domain: r.domain,
  signup: r.signup.where,
  url: r.signup.url,
  line: r.line,
  ...(r.card ? { card: r.card } : {}),
  ...(r.preset ? { preset: r.preset } : {}),
  costs: r.fees,
  facts: r.facts,
  countries: placesOf(r),
  fundable: fundable(r),
  funding: r.funding,
  lastChecked: lastChecked(r),
  steps: r.steps ?? [],
  noId: r.identity !== "provider",
}));

export interface Country {
  /** ISO 3166 code ("EU" for the euro area's SEPA, "ZZ" for anywhere else). */
  code: string;
  /** Providers per section, in registry order; empty: the section isn't offered there. */
  card: readonly string[];
  bank: readonly string[];
  exchange: readonly string[];
  voucher: readonly string[];
  /** Bank codes Scan reads there, by the scheme names codes/emv.ts and parse.ts give them. */
  scan: readonly string[];
}

const place = (code: string, scan: readonly string[]): Country => {
  const here = (section: Section) => PROVIDERS.filter((p) => p.section === section && p.countries.includes(code)).map((p) => p.id);
  return { code, card: here("card"), bank: here("bank"), exchange: here("exchange"), voucher: here("voucher"), scan };
};

export const COUNTRIES: readonly Country[] = PLACES.map((p) => place(p.code, p.scan));

/** Anywhere else, or skipped: the card, the bank account, and the person's own exchange by its address. */
export const ELSEWHERE: Country = place("ZZ", []);

/** A provider's record by its id (a card product, an exchange preset, "mt-pelerin"). */
export const providerById = (id: string | undefined) => PROVIDERS.find((p) => p.id === id);

export const countryFor = (code: string | null | undefined): Country => COUNTRIES.find((c) => c.code === code) ?? ELSEWHERE;

/** A place's name in the person's language ("ZZ" is "Somewhere else"). */
export function countryName(code: string, locale?: string): string {
  if (code === ELSEWHERE.code) return "Somewhere else";
  try {
    return new Intl.DisplayNames(locale ? [locale] : undefined, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export interface Offer {
  section: Section;
  /** Every provider of the section there, in one stated neutral order: A–Z by name. ZeroFee puts no one first. */
  providers: Provider[];
}

/** What's available for a place: Card · Bank account · Exchange · Gift cards; no card on a child's account (D30). */
export function offersFor(country: Country, opts: { kid?: boolean } = {}): Offer[] {
  const sections: Section[] = opts.kid ? ["bank", "exchange", "voucher"] : ["card", "bank", "exchange", "voucher"];
  return sections.flatMap((section) => {
    const providers = country[section]
      .map((id) => PROVIDERS.find((p) => p.id === id && p.section === section))
      .filter((p): p is Provider => Boolean(p))
      .sort((x, y) => x.name.localeCompare(y.name, "en", { sensitivity: "base" }));
    return providers.length ? [{ section, providers }] : [];
  });
}

export interface Group {
  /** "No ID check" (a way in without one) or "With an ID check". */
  label: "No ID check" | "With an ID check";
  /** Its sections in What's available's order, each A–Z, only the ones with a provider in this group. */
  offers: Offer[];
}

/** What's available as the product set it (27 Oct): no ID check on top, the rest under it; empty groups left out. */
export function groupsFor(country: Country, opts: { kid?: boolean } = {}): Group[] {
  const offers = offersFor(country, opts);
  return (["No ID check", "With an ID check"] as const)
    .map((label) => ({
      label,
      offers: offers.map((o) => ({ ...o, providers: o.providers.filter((p) => p.noId === (label === "No ID check")) })).filter((o) => o.providers.length > 0),
    }))
    .filter((g) => g.offers.length > 0);
}

const KEY = "country.v1";

/** The person's answer, kept on this phone: an ISO code, "ZZ" when skipped, null before they're asked. */
export async function loadCountry(bridge: Bridge): Promise<string | null> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: KEY });
  return "ok" in r ? r.ok.value : null;
}

export async function saveCountry(bridge: Bridge, code: string): Promise<void> {
  await bridge.call("device.store.set", { key: KEY, value: code });
}

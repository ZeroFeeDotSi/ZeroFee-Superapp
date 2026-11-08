// E6 (audit 14): what AgentZero's browser sends the model of a page's own words. The page is a stranger's and may show
// the person's own details or anyone's secrets; none of them is needed to pick a step. Each is swapped for a short plain
// stand-in before the words leave the phone: cards, emails, phone numbers, street addresses, bank numbers, wallet
// addresses, keys and session tokens. Prices, dates and counts stay ("$49", "8 Nov", "Order 3 items").

type Rule = readonly [RegExp, string | ((...m: string[]) => string)];

/** In order: the longest and most specific first, so a key is never half-read as a wallet or a card. */
const RULES: readonly Rule[] = [
  // keys and secrets
  [/-----BEGIN[^-]*-----[\s\S]*?(?:-----END[^-]*-----|$)/g, "[key]"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "[key]"],
  [/\bed25519:[1-9A-HJ-NP-Za-km-z]{43,90}\b/g, "[key]"],
  [/\b0x[0-9a-fA-F]{64,}\b/g, "[key]"],
  [/\b[0-9a-fA-F]{65,}\b/g, "[key]"],
  // session tokens: a JWT, a named value, and any long mixed run that reads like one
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, "[token]"],
  [/\b(access_token|refresh_token|id_token|session_?id|sessionid|session|token|sid|auth|api_?key|secret)(\s*[=:]\s*)["']?[^\s"'&;,]{6,}["']?/gi, (_m, name, eq) => `${name}${eq}[token]`],
  // email, before any name that ends like a NEAR account
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]"],
  // wallet addresses: Ethereum-style, NEAR (64 hex or a name), Solana (base58, with a digit and a letter)
  [/\b0x[0-9a-fA-F]{40}\b/g, "[wallet]"],
  [/\b[0-9a-f]{64}\b/gi, "[wallet]"],
  [/\b[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.(?:near|tg)\b/gi, "[wallet]"],
  [/\b(?=[1-9A-HJ-NP-Za-km-z]*\d)(?=[1-9A-HJ-NP-Za-km-z]*[A-Za-z])[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, "[wallet]"],
  // bank numbers (IBAN), then card numbers (13 to 19 digits, spaces or dashes between)
  [/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g, "[bank]"],
  [/\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}\b/g, "[phone]"],
  [/\b(?:\d[ -]?){12,18}\d\b/g, "[card]"],
  // phone numbers in local forms: (415) 555-0132, 415-555-0132, 020 7946 0958
  [/(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g, "[phone]"],
  [/\b0\d{2,4}[\s-]\d{3,4}[\s-]\d{3,4}\b/g, "[phone]"],
  // street addresses and postcodes
  [/\b\d{1,5}[A-Za-z]?\s+(?:[A-Z][A-Za-z'-]*\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Way|Court|Ct|Place|Pl|Terrace|Close|Square|Sq|Parkway|Pkwy|Highway|Hwy|Strasse|Straße)\b\.?/g, "[address]"],
  [/\b[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}\b/g, "[address]"],
  [/\b[A-Z]{2}\s\d{5}(?:-\d{4})?\b/g, "[address]"],
  // any other long run of letters and digits in both cases (a cookie, a reset link's token)
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{32,}\b/g, "[token]"],
];

/** The page's words with every personal detail and secret swapped for its stand-in. */
export function redactPage(text: string): string {
  let out = String(text ?? "");
  for (const [re, by] of RULES) out = out.replace(re, by as never);
  return out;
}

/** What a browse turn carries of the page's words: redacted, at most 6,000 characters, and no fence of its own. */
export function browseWords(text: unknown): string {
  return redactPage(String(text ?? "")).slice(0, 6000).replace(/<\/?\s*page-[^>]*>/gi, " ");
}

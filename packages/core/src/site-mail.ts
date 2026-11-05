// The person's own mailbox for sites that sign in by email (product decision, 4 Nov, K1: pump.fun signs in with an email code for
// cross-chain trading; "a separate sealed mailbox AgentZero can't read"; K3: on mail.zerofee.si, never the apex).
//
// It is NOT AgentZero's mailbox (mailbox.ts). Apart in three ways, each a test in site-mail.test.ts:
// - its own keys: HKDF of the hot root with salt "zerofee-sitemail-v1" (infos "zerofee-sitemail-box" and
//   "zerofee-sitemail-sign"), so AgentZero's mail keys (salt "zerofee-mail-v1") open none of its mail and sign none of
//   its reads; the receiver (apps/mail) binds the name to this sign key alone.
// - its own name, kept under SITE_MAIL_NAME, never AgentZero's MAIL_NAME.
// - its own door: sitemail.* is a core family (bridge.ts CORE_NAMES) that no app may call (appMayCall: not in
//   EVERY_APP, not in any APP_EXTRA, AgentZero's "account.agent." included), and the core answers it only for ZeroFee's
//   own screens (no app, no caller) and only when the app's settings name a mail host. No host: hidden, nothing asked.
//
// THE NAME: two BIP-39 words from SHA-256("zerofee-sitemail-name:" ‖ sign public key ‖ try), never a reserved one, so
// the same 24 words find the same address on a new phone (a name another key holds answers 401: the next try is used).
//
// THE CODE: sitemail.code {site, startedAt} reads only that mailbox, only mail that arrived from 2 minutes before the
// sign-in started (phone and server clocks differ) to 10 minutes after it, only from that site's sender domains
// (SITE_MAIL_SENDERS), and answers their one code (mail-code.ts codeFrom: digits only); two different codes in the
// window answer null. The receiver seals only mail its From domain signed (apps/mail/src/dkim.ts), so the sender line
// is the domain's own; even so, a wrong code could only go into the site's own page, never to anyone else.
// Keys never leave the device: what goes out is the box public key, the sign public key and Ed25519 signatures.
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HOT_ROOT } from "./hot-keys.ts";
import { codeFrom, htmlToText, senderDomain } from "./mail-code.ts";
import { openMail, signRegister, signRequest, type MailKeys } from "./mail-keys.ts";
import { mailboxNameProblem } from "./mail-names.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";

export const SITE_MAIL_SALT = "zerofee-sitemail-v1";
/** The vault item holding the mailbox's name (the part before @), once it's registered. */
export const SITE_MAIL_NAME = "site-mail-name";
export const SITE_MAIL_NOT_SET_UP = "Your sign-in mailbox isn't set up yet.";

/** Sites that sign in by email to this mailbox, and the sender domains (and their subdomains) their code mail comes from. */
export const SITE_MAIL_SENDERS: Readonly<Record<string, readonly string[]>> = {
  // pump.fun's email sign-in is Privy's: the code comes from privy.io ("pump.fun" <no-reply@privy.io>).
  "pump.fun": ["privy.io", "pump.fun"],
};

/** How long after a sign-in starts its code mail counts, and how far before (the server's clock vs the phone's). */
export const CODE_AFTER_MS = 10 * 60_000;
export const CODE_SKEW_MS = 2 * 60_000;
const MAX_PAGES = 12;
const MAX_TRIES = 8;

const enc = new TextEncoder();

/** The site mailbox's keys from the hot root (64 bytes). The caller zeroes the root; `forget` zeroes these. */
export function siteMailKeys(root: Uint8Array): MailKeys & { forget(): void } {
  if (!(root instanceof Uint8Array) || root.length < 32) throw new Error("the site mail keys need a seed of at least 32 bytes");
  const boxSecret = hkdf(sha256, root, enc.encode(SITE_MAIL_SALT), enc.encode("zerofee-sitemail-box"), 32);
  const signSecret = hkdf(sha256, root, enc.encode(SITE_MAIL_SALT), enc.encode("zerofee-sitemail-sign"), 32);
  return { boxSecret, boxPublic: x25519.getPublicKey(boxSecret), signSecret, signPublic: ed25519.getPublicKey(signSecret), forget: () => (boxSecret.fill(0), signSecret.fill(0)) };
}

/** The mailbox name for a sign key's try (0, 1, …): `word.word`, never reserved, always one the receiver takes. */
export function siteMailName(signPublic: Uint8Array, attempt: number): string {
  for (let n = 0; ; n++) {
    const tag = enc.encode(`zerofee-sitemail-name:${attempt}:${n}:`);
    const h = sha256(new Uint8Array([...tag, ...signPublic]));
    const a = wordlist[((h[0]! << 8) | h[1]!) % 2048]!;
    const b = wordlist[((h[2]! << 8) | h[3]!) % 2048]!;
    const name = `${a}.${b}`;
    if (mailboxNameProblem(name) === null) return name;
  }
}

export interface SiteMailHost {
  vault: { get(n: string): Promise<Uint8Array | null>; put(n: string, v: Uint8Array): Promise<void> };
  /** The inbox API's host (mail.zerofee.si), from the app's settings; null: no mailbox here, so it stays hidden. */
  host: string | null;
  /** The mail domain addresses end in (mail.zerofee.si). */
  domain: string | null;
  fetch?: typeof fetch;
  now?: () => number;
}

type Sealed = { id: string; at: number; sealed: string };
export type SiteMail = { id: string; at: number; from: string; subject: string; text: string } | { id: string; at: number; broken: true };

const notSetUp = () => new ProblemError(securityProblems.requestNotAllowed(SITE_MAIL_NOT_SET_UP));
const unreachable = () => new ProblemError(securityProblems.partnerUnreachable("your sign-in mailbox"));
const plain = (text: string) => (/<\/?[a-z][^<>]{0,500}>/i.test(text) ? htmlToText(text) : text);

async function storedName(h: SiteMailHost): Promise<string | null> {
  const raw = await h.vault.get(SITE_MAIL_NAME);
  return raw ? new TextDecoder().decode(raw) : null;
}

async function withKeys<T>(h: SiteMailHost, run: (k: MailKeys) => Promise<T>): Promise<T> {
  const root = await h.vault.get(HOT_ROOT);
  if (!root) throw notSetUp();
  const keys = siteMailKeys(root);
  root.fill(0);
  try {
    return await run(keys);
  } finally {
    keys.forget();
  }
}

/** Registers the mailbox (the same name again on a new phone with the same words). Answers the address. */
async function setUp(h: SiteMailHost & { host: string; domain: string }): Promise<{ address: string }> {
  const kept = await storedName(h);
  if (kept) return { address: `${kept}@${h.domain}` };
  const f = h.fetch ?? fetch;
  const now = h.now ?? Date.now;
  return withKeys(h, async (keys) => {
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      const name = siteMailName(keys.signPublic, attempt);
      const res = await f(`https://${h.host}/v0/mail/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signRegister(keys, name, now())) }).catch(() => null);
      if (!res) throw unreachable();
      if (res.ok) {
        await h.vault.put(SITE_MAIL_NAME, enc.encode(name));
        return { address: `${name}@${h.domain}` };
      }
      // 401: the name is another key's (or the proof was refused); 403: reserved. Either way, the next name.
      if (res.status !== 401 && res.status !== 403) throw unreachable();
    }
    throw unreachable();
  });
}

/** Every sealed mail in the box (oldest first), page by page, at most MAX_PAGES pages. */
async function readSealed(h: SiteMailHost & { host: string }, keys: MailKeys, box: string): Promise<Sealed[]> {
  const f = h.fetch ?? fetch;
  const now = h.now ?? Date.now;
  const out: Sealed[] = [];
  let since = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const proof = signRequest(keys, { method: "read", host: h.host, mailbox: box }, now());
    const q = since ? `?since=${encodeURIComponent(since)}` : "";
    const res = await f(`https://${h.host}/v0/mail/${encodeURIComponent(box)}${q}`, { headers: { "x-mail-proof": proof } }).catch(() => null);
    if (!res || !res.ok) throw unreachable();
    const body = (await res.json().catch(() => null)) as { messages?: { id?: unknown; at?: unknown; sealed?: unknown }[]; more?: unknown } | null;
    for (const m of body?.messages ?? []) if (typeof m?.id === "string" && typeof m.sealed === "string") out.push({ id: m.id, at: typeof m.at === "number" ? m.at : 0, sealed: m.sealed });
    if (body?.more !== true || out.length === 0) break;
    since = out[out.length - 1]!.id;
  }
  return out;
}

const opened = (keys: MailKeys, m: Sealed): SiteMail => {
  try {
    const o = openMail(keys.boxSecret, m.sealed);
    return { id: m.id, at: m.at, from: o.from.slice(0, 1024), subject: o.subject.slice(0, 1024), text: plain(o.text.slice(0, 128 * 1024)) };
  } catch {
    return { id: m.id, at: m.at, broken: true };
  }
};

/** The one code for a sign-in the person started on `site` at `startedAt` (ms, this device's clock), or null. */
export function codeForSite(mails: readonly SiteMail[], site: string, startedAt: number): string | null {
  const allowed = SITE_MAIL_SENDERS[site];
  if (!allowed) return null;
  const fits = mails.filter((m): m is Extract<SiteMail, { from: string }> => {
    if ("broken" in m) return false;
    if (m.at < startedAt - CODE_SKEW_MS || m.at > startedAt + CODE_AFTER_MS) return false;
    const d = senderDomain(m.from);
    return d !== null && allowed.some((a) => d === a || d.endsWith(`.${a}`));
  });
  // Two of the site's mails in the window with different codes answer null (the audit's SHOULD): which one is real is the
  // person's to read, never ours to guess. One code, however many mails carry it, is the answer.
  const codes = new Set(fits.map((m) => codeFrom({ subject: m.subject, text: m.text })).filter((c): c is string => c !== null));
  return codes.size === 1 ? [...codes][0]! : null;
}

/**
 * sitemail.address → {address} (null: not set up, or no mail host here). sitemail.setUp → {address}.
 * sitemail.list → {mails} (the person reads their own mail; plain text only). sitemail.code {site, startedAt} → {code}.
 * Only ZeroFee's own screens reach this (the caller, demo-core.ts, checks no app asked).
 */
export async function siteMailCall(method: string, p: Record<string, unknown>, h: SiteMailHost): Promise<unknown> {
  if (method === "sitemail.address") {
    const box = await storedName(h);
    return { address: box && h.host && h.domain ? `${box}@${h.domain}` : null };
  }
  if (!h.host || !h.domain) throw notSetUp();
  const host = { ...h, host: h.host, domain: h.domain };
  if (method === "sitemail.setUp") return setUp(host);
  if (method !== "sitemail.list" && method !== "sitemail.code") throw new ProblemError(securityProblems.methodUnknown(method));
  const box = await storedName(h);
  if (!box) throw notSetUp();
  if (method === "sitemail.code") {
    const site = typeof p.site === "string" ? p.site : "";
    const startedAt = typeof p.startedAt === "number" && Number.isFinite(p.startedAt) ? p.startedAt : NaN;
    if (!(site in SITE_MAIL_SENDERS) || Number.isNaN(startedAt)) throw new ProblemError(securityProblems.methodUnknown(method));
    return withKeys(h, async (keys) => {
      // Only mail in the sign-in's window is opened at all.
      const near = (await readSealed(host, keys, box)).filter((m) => m.at >= startedAt - CODE_SKEW_MS && m.at <= startedAt + CODE_AFTER_MS);
      return { code: codeForSite(near.map((m) => opened(keys, m)), site, startedAt) };
    });
  }
  return withKeys(h, async (keys) => ({ mails: (await readSealed(host, keys, box)).map((m) => opened(keys, m)) }));
}

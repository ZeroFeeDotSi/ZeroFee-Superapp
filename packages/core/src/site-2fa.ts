// A site's two-factor secret, kept by the core (bug report, 4 Nov: pump.fun and GMGN need two-factor). The person scans
// or pastes the site's otpauth:// link once; the secret goes into the core's vault (the Keychain on the phone) and never
// comes back out: no call returns it, no screen shows it, no log names it. What leaves is a code, and only for a page
// whose origin is the site's own (https, one of its exact hosts), so a look-alike page in the Browser gets
// nothing. Which person's yes (Face ID) a code needs is the caller's (the host asks before it calls codeFor).
import { parseOtpAuth, totp, type OtpAlgorithm } from "./totp.ts";
import type { Vault } from "./vault.ts";

/** The sites whose two-factor the core keeps, by their exact hosts: no wildcard subdomains (security review of
 *  9004735f: any *.pump.fun page could otherwise ask for a code). */
export const TWO_FACTOR_SITES: Readonly<Record<string, readonly string[]>> = {
  "pump.fun": ["pump.fun", "www.pump.fun"],
  gmgn: ["gmgn.ai", "www.gmgn.ai"],
};

const KEY = (site: string) => `site-2fa:${site}`;

/** How each site's own authenticator links name it in their issuer, compared without case, spaces or dots. */
export const ISSUER_NAMES: Readonly<Record<string, readonly string[]>> = { "pump.fun": ["pumpfun"], gmgn: ["gmgn", "gmgnai"] };

/** Whether a link's issuer is that site's own name (exactly, ignoring case, spaces and dots). */
export function issuerNames(site: string, issuer: string): boolean {
  const flat = issuer.toLowerCase().replace(/[\s.]/g, "");
  return (ISSUER_NAMES[site] ?? []).includes(flat);
}

interface Stored { v: 1; secret: string; algorithm: OtpAlgorithm; digits: 6 | 7 | 8; period: number; issuer: string; account: string; addedAt: number }

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

/** The site a page belongs to, from its origin: https only, one of a site's exact hosts, nothing else. */
export function siteOfOrigin(origin: string): string | null {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.port !== "" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  for (const [site, hosts] of Object.entries(TWO_FACTOR_SITES)) if (hosts.includes(host)) return site;
  return null;
}

/** What the person sees about a kept entry: never its secret. */
export interface TwoFactorView { site: string; issuer: string; account: string; addedAt: number }

export class SiteTwoFactor {
  private readonly vault: Vault;
  private readonly now: () => number;
  constructor(vault: Vault, now: () => number = Date.now) {
    this.vault = vault;
    this.now = now;
  }

  /** Keeps a site's link. Its issuer must name that site (ISSUER_NAMES); a link whose issuer doesn't (a Binance code
   *  offered for GMGN) is refused unless the person confirmed the mismatch on a sheet that named both (`confirmed`).
   *  The account part is the person's own name or email and is never read for this (security review (d)). */
  async add(site: string, link: string, opts: { confirmedMismatch?: boolean } = {}): Promise<TwoFactorView> {
    if (!(site in TWO_FACTOR_SITES)) throw new Error("unknown site");
    const e = parseOtpAuth(link);
    if (!issuerNames(site, e.issuer) && opts.confirmedMismatch !== true) {
      e.secret.fill(0);
      throw new Error("issuer does not name this site");
    }
    const stored: Stored = { v: 1, secret: hex(e.secret), algorithm: e.algorithm, digits: e.digits, period: e.period, issuer: e.issuer, account: e.account, addedAt: this.now() };
    e.secret.fill(0);
    await this.vault.put(KEY(site), new TextEncoder().encode(JSON.stringify(stored)));
    return { site, issuer: stored.issuer, account: stored.account, addedAt: stored.addedAt };
  }

  private async read(site: string): Promise<Stored | null> {
    const raw = await this.vault.get(KEY(site));
    if (!raw) return null;
    try {
      const s = JSON.parse(new TextDecoder().decode(raw)) as Stored;
      return s.v === 1 && typeof s.secret === "string" ? s : null;
    } finally {
      raw.fill(0);
    }
  }

  async list(): Promise<TwoFactorView[]> {
    const out: TwoFactorView[] = [];
    for (const site of Object.keys(TWO_FACTOR_SITES)) {
      const s = await this.read(site);
      if (s) out.push({ site, issuer: s.issuer, account: s.account, addedAt: s.addedAt });
    }
    return out;
  }

  /**
   * The code for the page whose MAIN FRAME is at `mainFrameOrigin`, or null when that origin isn't a kept site's own.
   * The origin must be WebKit's own (the main frame's securityOrigin, as PartnerWallet.mayAsk reads it), never a string
   * a page sent: pages are refused every site2fa.* method (IsolatedCore.pageMayUse), and an iframe is never filled.
   */
  async codeFor(mainFrameOrigin: string): Promise<{ site: string; code: string; secondsLeft: number } | null> {
    const site = siteOfOrigin(mainFrameOrigin);
    if (!site) return null;
    const s = await this.read(site);
    if (!s) return null;
    const secret = unhex(s.secret);
    try {
      return { site, ...totp({ secret, algorithm: s.algorithm, digits: s.digits, period: s.period }, this.now()) };
    } finally {
      secret.fill(0);
    }
  }

  async remove(site: string): Promise<void> {
    await this.vault.delete(KEY(site));
  }
}

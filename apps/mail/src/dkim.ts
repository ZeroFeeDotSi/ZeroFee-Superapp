// DKIM on arrival (RFC 6376; Ed25519 by RFC 8463): a mail is sealed only when one of its DKIM signatures verifies and is
// the From domain's own (d= is the From domain or a parent of it, as DMARC's relaxed alignment). Unsigned, failing,
// unaligned, expired or partly signed mail (l=) is refused at DATA (550 5.7.20) and never sealed, so "pump.fun"
// <no-reply@privy.io> on a phone means privy.io signed it. A DNS failure is temporary (451): a real sender retries.
//
// Written here on node:crypto, without a mail library, for the same supply-chain reason as smtp.ts. Allowed: rsa-sha256
// (a key of at least 1024 bits) and ed25519-sha256; rsa-sha1 is refused (RFC 8301). From must be among the signed
// headers, and a mail with more than one From is refused (which one would the phone show?).
import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { resolveTxt } from "node:dns/promises";

export type TxtResolver = (name: string) => Promise<string[][]>;
export interface DkimOptions {
  /** TXT lookups for selector._domainkey.domain; node's DNS by default. */
  resolveTxt?: TxtResolver;
  now?: () => number;
}
export type DkimVerdict = { ok: true; domain: string } | { ok: false; temporary: boolean; why: string };

const MAX_SIGNATURES = 4;
const WSP = /[ \t]+/g;

interface Header { name: string; raw: string }

/** The header block (each field with its folded lines and its CRLF) and the body, split at the first empty line. */
export function splitMail(raw: string): { headers: Header[]; body: string } {
  const text = raw.replace(/\r?\n/g, "\r\n");
  const cut = text.indexOf("\r\n\r\n");
  const head = cut < 0 ? text : text.slice(0, cut + 2);
  const body = cut < 0 ? "" : text.slice(cut + 4);
  const headers: Header[] = [];
  for (const line of head.split(/(?<=\r\n)/)) {
    if (line === "") continue;
    if (/^[ \t]/.test(line) && headers.length > 0) headers[headers.length - 1]!.raw += line;
    else {
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      headers.push({ name: line.slice(0, colon).trim().toLowerCase(), raw: line });
    }
  }
  return { headers, body };
}

export function canonBody(body: string, how: "simple" | "relaxed"): string {
  let b = body;
  if (how === "relaxed") b = b.split("\r\n").map((l) => l.replace(WSP, " ").replace(/ +$/, "")).join("\r\n");
  b = b.replace(/(?:\r\n)*$/, "");
  if (b === "") return how === "simple" ? "\r\n" : "";
  return `${b}\r\n`;
}

export function canonHeader(raw: string, how: "simple" | "relaxed"): string {
  if (how === "simple") return raw;
  const colon = raw.indexOf(":");
  const name = raw.slice(0, colon).trim().toLowerCase();
  const value = raw.slice(colon + 1).replace(/\r\n/g, "").replace(WSP, " ").trim();
  return `${name}:${value}\r\n`;
}

export function tagsOf(value: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k && !tags.has(k)) tags.set(k, part.slice(eq + 1).replace(/\r\n/g, "").trim());
  }
  return tags;
}

const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

function keyFrom(record: string): KeyObject | "revoked" | null {
  const t = tagsOf(record);
  if (t.has("v") && t.get("v") !== "DKIM1") return null;
  const p = (t.get("p") ?? "").replace(/\s+/g, "");
  if (p === "") return "revoked";
  const bytes = Buffer.from(p, "base64");
  const kind = (t.get("k") ?? "rsa").toLowerCase();
  try {
    if (kind === "ed25519") return bytes.length === 32 ? createPublicKey({ key: Buffer.concat([ED25519_SPKI, bytes]), format: "der", type: "spki" }) : null;
    if (kind !== "rsa") return null;
    const key = createPublicKey({ key: bytes, format: "der", type: "spki" });
    return key.asymmetricKeyType === "rsa" && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 1024 ? key : null;
  } catch {
    return null;
  }
}

/** The domain of the one From line, lower-cased; null for none, several, or no address. */
function fromDomain(headers: Header[]): string | null {
  const froms = headers.filter((h) => h.name === "from");
  if (froms.length !== 1) return null;
  const v = froms[0]!.raw.slice(froms[0]!.raw.indexOf(":") + 1).replace(/\r\n/g, "");
  const m = /@([a-z0-9-]+(?:\.[a-z0-9-]+)+)\s*>?\s*$/i.exec(v.trim());
  return m ? m[1]!.toLowerCase() : null;
}

const domainOk = (d: string) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d);

/** One DKIM-Signature checked against the mail. */
async function checkOne(sig: Header, headers: Header[], body: string, from: string, resolve: TxtResolver, now: number): Promise<DkimVerdict> {
  const t = tagsOf(sig.raw.slice(sig.raw.indexOf(":") + 1));
  const fail = (why: string, temporary = false): DkimVerdict => ({ ok: false, temporary, why });
  if (t.get("v") !== "1") return fail("version");
  const a = (t.get("a") ?? "").toLowerCase();
  if (a !== "rsa-sha256" && a !== "ed25519-sha256") return fail("algorithm");
  const d = (t.get("d") ?? "").toLowerCase();
  const s = (t.get("s") ?? "").toLowerCase();
  if (!domainOk(d) || !/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/.test(s)) return fail("domain or selector");
  if (!(from === d || from.endsWith(`.${d}`))) return fail("not the From domain's signature");
  if (t.has("l")) return fail("partly signed");
  const x = t.get("x");
  if (x !== undefined && (!/^\d{1,12}$/.test(x) || Number(x) * 1000 < now)) return fail("expired");
  const signed = (t.get("h") ?? "").split(":").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!signed.includes("from")) return fail("From not signed");
  const [hc, bc = "simple"] = (t.get("c") ?? "simple/simple").toLowerCase().split("/");
  if ((hc !== "simple" && hc !== "relaxed") || (bc !== "simple" && bc !== "relaxed")) return fail("canonicalization");

  const bh = createHash("sha256").update(canonBody(body, bc), "latin1").digest("base64");
  if (bh !== (t.get("bh") ?? "").replace(/\s+/g, "")) return fail("body changed");

  // Each signed name takes that field's instances from the bottom up; a name with none left adds nothing.
  const used = new Map<string, number>();
  let data = "";
  for (const name of signed) {
    const all = headers.filter((h) => h.name === name && h !== sig);
    const n = used.get(name) ?? 0;
    used.set(name, n + 1);
    const h = all[all.length - 1 - n];
    if (h) data += canonHeader(h.raw, hc);
  }
  const sigNoB = sig.raw.replace(/([;:][ \t\r\n]*b[ \t\r\n]*=)[^;]*/, (_m, k: string) => k);
  data += canonHeader(sigNoB, hc).replace(/\r\n$/, "");

  let records: string[][];
  try {
    records = await resolve(`${s}._domainkey.${d}`);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    return code === "ENOTFOUND" || code === "ENODATA" ? fail("no key") : fail("dns", true);
  }
  const b = Buffer.from((t.get("b") ?? "").replace(/\s+/g, ""), "base64");
  for (const r of records.slice(0, 4)) {
    const key = keyFrom(r.join(""));
    if (key === "revoked" || key === null) continue;
    const okSig =
      a === "rsa-sha256"
        ? key.asymmetricKeyType === "rsa" && cryptoVerify("sha256", Buffer.from(data, "latin1"), key, b)
        : key.asymmetricKeyType === "ed25519" && cryptoVerify(null, createHash("sha256").update(data, "latin1").digest(), key, b);
    if (okSig) return { ok: true, domain: d };
  }
  return fail("signature");
}

/** Whether this raw mail carries a passing DKIM signature of its From domain. */
export async function checkDkim(raw: Uint8Array | string, o: DkimOptions = {}): Promise<DkimVerdict> {
  const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("latin1");
  const { headers, body } = splitMail(text);
  const from = fromDomain(headers);
  if (!from) return { ok: false, temporary: false, why: "no single From address" };
  const sigs = headers.filter((h) => h.name === "dkim-signature").slice(0, MAX_SIGNATURES);
  if (sigs.length === 0) return { ok: false, temporary: false, why: "unsigned" };
  const resolve = o.resolveTxt ?? resolveTxt;
  const now = (o.now ?? Date.now)();
  let temporary = false;
  let why = "";
  for (const sig of sigs) {
    const v = await checkOne(sig, headers, body, from, resolve, now);
    if (v.ok) return v;
    temporary ||= v.temporary;
    why ||= v.why;
  }
  return { ok: false, temporary, why };
}

// Message signatures for the separate wallets (D29 wallet mode): what a site asks a wallet to sign that isn't a
// transaction. EVM: personal_sign (EIP-191) and eth_signTypedData_v4 (EIP-712). Solana: signMessage, plain text only.
// Pure, no I/O: the core reads what the words need (a coin's name) and shows the sheet.
//
// A sign-in message (EIP-4361, and its Solana twin) names the site it is for: it must be the site that asked, and this
// wallet, or it's refused. That stops a page from collecting a signature that logs the person in somewhere else.
import { keccak_256 } from "@noble/hashes/sha3.js";
import { fromHex } from "./evm/wire.ts";
import { utf8 } from "./sol/bytes.ts";

/** "0x…" hex is bytes; anything else is the text itself (dApps send both to personal_sign). */
export function messageBytes(message: string): Uint8Array {
  return /^0x(?:[0-9a-fA-F]{2})*$/.test(message) ? fromHex(message) : utf8(message);
}

/** The text a person can read, or null: valid UTF-8 with no control characters but line breaks and tabs. */
export function readableText(bytes: Uint8Array): string | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  return /[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/.test(text) ? null : text;
}

/** EIP-191 personal_sign: keccak256("\x19Ethereum Signed Message:\n" + length + message). */
export function eip191Hash(bytes: Uint8Array): Uint8Array {
  return keccak_256(new Uint8Array([...utf8(`\x19Ethereum Signed Message:\n${bytes.length}`), ...bytes]));
}

export interface SignIn {
  domain: string;
  address: string;
  statement?: string;
  uri?: string;
  chainId?: string;
  expires?: string;
  notBefore?: string;
}

/**
 * A sign-in message (EIP-4361, or Sign In With Solana), or null when the text isn't one. Throws when the text says it
 * is one but isn't written the standard way: then it can't be checked, so it isn't signed.
 */
export function readSignIn(text: string, chain: "Ethereum" | "Solana"): SignIn | null {
  const said = `wants you to sign in with your ${chain} account:`;
  if (!text.split("\n", 1)[0].includes(said)) return null;
  const head = new RegExp(`^(?:[a-z][a-z0-9+.-]*://)?([^\\s/]+) ${said}\\n(\\S+)\\n`).exec(text);
  if (!head) throw new Error("This sign-in message isn't written the standard way.");
  const field = (name: string) => new RegExp(`^${name}: (.+)$`, "m").exec(text)?.[1]?.trim();
  // The address line, a blank line, then the statement (optional), a blank line, then the fields.
  const first = text.slice(head[0].length).replace(/^\n/, "").split("\n\n")[0];
  const statement = first && !/^[A-Z][A-Za-z ]+: /.test(first) ? first.trim() : undefined;
  return {
    domain: head[1].toLowerCase(),
    address: head[2],
    ...(statement ? { statement } : {}),
    ...(field("URI") ? { uri: field("URI") } : {}),
    ...(field("Chain ID") ? { chainId: field("Chain ID") } : {}),
    ...(field("Expiration Time") ? { expires: field("Expiration Time") } : {}),
    ...(field("Not Before") ? { notBefore: field("Not Before") } : {}),
  };
}

/** Why a sign-in can't be signed by this wallet for this site, or null. */
export function signInRefusal(s: SignIn, site: string, address: string, nowMs: number): string | null {
  if (s.domain !== site) return `This sign-in is for ${s.domain}, not ${site}, the site that asked.`;
  if (s.address.toLowerCase() !== address.toLowerCase()) return "This sign-in names another wallet.";
  if (s.expires && !(Date.parse(s.expires) > nowMs)) return "This sign-in has expired.";
  if (s.notBefore && Date.parse(s.notBefore) > nowMs) return "This sign-in isn't valid yet.";
  return null;
}

// ── EIP-712 (eth_signTypedData_v4) ─────────────────────────────────────────────────────────────────────────────────

export type TypedField = { name: string; type: string };
export interface TypedData {
  types: Record<string, TypedField[]>;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
}

const DOMAIN_FIELDS: TypedField[] = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
  { name: "salt", type: "bytes32" },
];

/** The typed data as a site sends it (an object, or its JSON), checked into shape. Throws with plain words if not. */
export function readTypedData(raw: unknown): TypedData {
  const v = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!v || typeof v !== "object") throw new Error("This isn't typed data.");
  const { types, primaryType, domain, message } = v as Partial<TypedData>;
  if (!types || typeof types !== "object" || typeof primaryType !== "string" || !domain || typeof domain !== "object" || !message || typeof message !== "object") {
    throw new Error("This typed data is missing its types, primaryType, domain or message.");
  }
  if (primaryType === "EIP712Domain" || !Array.isArray(types[primaryType])) throw new Error(`Its types don't define ${primaryType}.`);
  const all: Record<string, TypedField[]> = {};
  for (const [name, fields] of Object.entries(types)) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) || !Array.isArray(fields)) throw new Error("Its types aren't written the standard way.");
    for (const f of fields) if (typeof f?.name !== "string" || typeof f?.type !== "string") throw new Error("Its types aren't written the standard way.");
    all[name] = fields.map((f) => ({ name: f.name, type: f.type }));
  }
  // ethers leaves EIP712Domain out of the types: it is then the domain's own fields, in the standard order.
  all.EIP712Domain ??= DOMAIN_FIELDS.filter((f) => f.name in domain);
  return { types: all, primaryType, domain: domain as Record<string, unknown>, message: message as Record<string, unknown> };
}

const word = (n: bigint) => {
  const out = new Uint8Array(32);
  for (let i = 31, x = n; i >= 0 && x > 0n; i--, x >>= 8n) out[i] = Number(x & 0xffn);
  return out;
};
const cat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const base = (type: string) => type.replace(/(\[\d*\])+$/, "");

function dependencies(type: string, types: TypedData["types"], found = new Set<string>()): Set<string> {
  if (found.has(type) || !types[type]) return found;
  found.add(type);
  for (const f of types[type]) dependencies(base(f.type), types, found);
  return found;
}

function encodeType(primary: string, types: TypedData["types"]): string {
  const deps = [...dependencies(primary, types)].filter((t) => t !== primary).sort();
  return [primary, ...deps].map((t) => `${t}(${types[t].map((f) => `${f.type} ${f.name}`).join(",")})`).join("");
}

function toBig(v: unknown, what: string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^(-?\d+|0x[0-9a-fA-F]+)$/.test(v)) return BigInt(v);
  throw new Error(`${what} isn't a whole number.`);
}

function encodeValue(type: string, v: unknown, types: TypedData["types"], what: string): Uint8Array {
  if (types[type]) {
    if (!v || typeof v !== "object") throw new Error(`${what} is missing.`);
    return hashStruct(type, v as Record<string, unknown>, types);
  }
  const array = /^(.*)\[(\d*)\]$/.exec(type);
  if (array) {
    if (!Array.isArray(v) || (array[2] !== "" && v.length !== Number(array[2]))) throw new Error(`${what} isn't the list its type says.`);
    return keccak_256(cat(v.map((x, i) => encodeValue(array[1], x, types, `${what}[${i}]`))));
  }
  if (type === "string") {
    if (typeof v !== "string") throw new Error(`${what} isn't text.`);
    return keccak_256(utf8(v));
  }
  if (type === "bytes") {
    if (typeof v !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(v)) throw new Error(`${what} isn't hex bytes.`);
    return keccak_256(fromHex(v));
  }
  if (type === "bool") {
    if (typeof v !== "boolean") throw new Error(`${what} isn't true or false.`);
    return word(v ? 1n : 0n);
  }
  if (type === "address") {
    if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`${what} isn't an address.`);
    return word(BigInt(v));
  }
  const fixed = /^bytes([1-9]|[12]\d|3[0-2])$/.exec(type);
  if (fixed) {
    if (typeof v !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${Number(fixed[1]) * 2}}$`).test(v)) throw new Error(`${what} isn't ${fixed[1]} bytes.`);
    const out = new Uint8Array(32);
    out.set(fromHex(v));
    return out;
  }
  const int = /^(u?)int(\d*)$/.exec(type);
  if (int) {
    const bits = Number(int[2] || 256);
    if (bits < 8 || bits > 256 || bits % 8) throw new Error(`${type} isn't a type ZeroFee knows.`);
    const n = toBig(v, what);
    const [lo, hi] = int[1] ? [0n, (1n << BigInt(bits)) - 1n] : [-(1n << BigInt(bits - 1)), (1n << BigInt(bits - 1)) - 1n];
    if (n < lo || n > hi) throw new Error(`${what} doesn't fit in ${type}.`);
    return word(n < 0n ? (1n << 256n) + n : n);
  }
  throw new Error(`${type} isn't a type ZeroFee knows.`);
}

function hashStruct(type: string, data: Record<string, unknown>, types: TypedData["types"]): Uint8Array {
  const fields = types[type];
  return keccak_256(
    cat([
      keccak_256(utf8(encodeType(type, types))),
      ...fields.map((f) => {
        if (!(f.name in data)) throw new Error(`${type}.${f.name} is missing.`);
        return encodeValue(f.type, data[f.name], types, `${type}.${f.name}`);
      }),
    ]),
  );
}

/** EIP-712: keccak256(0x1901 ‖ hashStruct(domain) ‖ hashStruct(message)). Throws with plain words if it can't be hashed. */
export function eip712Hash(t: TypedData): Uint8Array {
  return keccak_256(cat([new Uint8Array([0x19, 0x01]), hashStruct("EIP712Domain", t.domain, t.types), hashStruct(t.primaryType, t.message, t.types)]));
}


// ── Social trading's sign-in with no sheet (product decision, 2 Nov; security review B, M1 and M2: an allow-list) ───────────────

/** How far a sign-in's "Issued At" may be from now. */
export const SIGN_IN_FRESH_MS = 10 * 60_000;
/** The latest a sign-in's "Expiration Time" may be: a day ahead. */
export const SIGN_IN_LONGEST_MS = 24 * 3_600_000;
/**
 * A site's own wallet signs at most SIGN_IN_PER_HOUR sign-ins with no sheet in any hour, and never two within
 * SIGN_IN_GAP_MS; past either, the sheet asks (review B, M4: a page's script can't collect them). ST4 (the phone's
 * WebKit, 2 Nov): GMGN signs in again each time it is opened (its own reconnect), so the old one-every-ten-minutes
 * room put a Face ID sheet on any re-open within ten minutes. The ceiling is the old one (six an hour); only the burst
 * changed. It is a cap on what a page's script can collect, not a barrier: each is a log-in to that one site, and
 * every transaction still asks (security review ST4b, M2).
 */
export const SIGN_IN_PER_HOUR = 6;
export const SIGN_IN_GAP_MS = 30_000;
/**
 * QA (5 Nov): the re-runs' own room. An already-approved session (the same wallet, site and allow-listed
 * template, signed before) signing again with no tap of the person's (zf-site-signin.js's re-runs, GMGN's reconnect on
 * every open): at most one per page load and this many an hour per site, never from the person's six. Never uncapped.
 */
export const SIGN_IN_RERUN_PER_HOUR = 20;
/** Word stems a plain sign-in's statement never holds: money, rights, orders, amounts (any digit too). */
const NOT_PLAIN = /(pay|send|transf|withdr|deposit|approv|allow|permi|spend|order|trad|buy|sell|swap|bet|stak|deleg|authori|grant|fund|token|usd|coin|price|amount|balanc|right|claim|mint|enabl|unlimit|purchas|accept|agree|consent|session|access|control|manage|owner|vault|bridge|lend|borrow|[0-9$€£¥])/i;
/** The fields a plain sign-in may carry after its statement, each once, in the standard's order. */
const FIELDS = ["URI", "Version", "Chain ID", "Nonce", "Issued At", "Expiration Time", "Not Before"] as const;

/**
 * May a site's own wallet sign this with no sheet? Only a PLAIN sign-in, read as an allow-list (EIP-4361 and Sign In
 * With Solana, already checked for this site and this wallet by signInRefusal):
 * - exactly: "<site> wants you to sign in with your <chain> account:", the address, a blank line, then at most a
 *   one-line statement (plain ASCII, at most 120 characters, no word about money, rights or orders, no digit) and a
 *   blank line, then fields only from URI, Version, Chain ID, Nonce, Issued At, Expiration Time, Not Before: each at
 *   most once, nothing else (no Request ID, no Resources, no other line);
 * - URI on the site itself (https); Version 1; a Nonce of 8 to 64 letters and digits; Issued At present, once, within
 *   ten minutes of now; any Expiration Time no more than a day ahead; any Not Before already passed.
 * It moves nothing and proves only that this wallet is this person's, to the one site the wallet is for. Anything else:
 * the reason, and the sheet asks.
 */
/**
 * A site's own sign-in text where the site doesn't use the standard's (ST4, probed in the phone's WebKit 2 Nov): read
 * exactly, per exact site, as an allow-list. pump.fun signs its wallet log-in as "Sign in to pump.fun: <its clock in
 * ms>": its own name, a fresh time and nothing else, so it can say nothing about money, rights or orders. A site not
 * listed has none; any other text, a stale or future time, or a second line, keeps the sheet.
 */
const SITE_SIGN_INS: Readonly<Record<string, RegExp>> = { "pump.fun": /^Sign in to pump\.fun: ([0-9]{13})$/ };

const SITE_SIGN_IN_PAST_MS = 2 * 60_000;
const SITE_SIGN_IN_AHEAD_MS = 30_000;

/** May a site's own wallet sign this, its site's own sign-in, with no sheet? Null = yes; else the reason, and the sheet asks. */
export function siteSignInRefusal(text: string, site: string, nowMs: number): string | null {
  const shape = Object.hasOwn(SITE_SIGN_INS, site) ? SITE_SIGN_INS[site] : undefined;
  if (!shape) return "This site has no sign-in of its own.";
  const m = shape.exec(text);
  if (!m) return "It isn't this site's own sign-in.";
  // the page builds its text and asks at once, on this phone's own clock: at most 2 minutes old, 30 s ahead (security
  // review ST4b, M1: a page can't mint a log-in that stays usable for long)
  const at = Number(m[1]);
  if (!(at >= nowMs - SITE_SIGN_IN_PAST_MS && at <= nowMs + SITE_SIGN_IN_AHEAD_MS)) return "It isn't fresh.";
  return null;
}

export function plainSignInRefusal(text: string, s: SignIn, nowMs: number, chain: "Ethereum" | "Solana" = "Solana"): string | null {
  if (text.length > 1_000) return "It is too long for a sign-in.";
  if (!/^[\x20-\x7e\n]*$/.test(text)) return "It has letters a plain sign-in doesn't.";
  const lines = text.split("\n");
  if (lines[0] !== `${s.domain} wants you to sign in with your ${chain} account:` && lines[0] !== `https://${s.domain} wants you to sign in with your ${chain} account:`) return "Its first line isn't the standard one.";
  if (lines[1] !== s.address || lines[2] !== "") return "It isn't laid out the standard way.";
  let i = 3;
  if (lines[i] !== undefined && !/^[A-Z][A-Za-z ]+: /.test(lines[i]!) && lines[i] !== "") {
    const statement = lines[i]!;
    if (statement.length > 120) return "Its words are too long for a sign-in.";
    if (NOT_PLAIN.test(statement)) return "Its words are about more than signing in.";
    if (lines[i + 1] !== "") return "It isn't laid out the standard way.";
    i += 2;
  }
  const seen = new Map<string, string>();
  let last = -1;
  for (const line of lines.slice(i)) {
    const m = /^([A-Za-z ]+): (.+)$/.exec(line);
    const at = m ? FIELDS.indexOf(m[1] as (typeof FIELDS)[number]) : -1;
    if (!m || at < 0) return line.startsWith("Resources") || line.startsWith("Request ID") ? "It asks for more than a sign-in." : "It has lines a sign-in doesn't.";
    if (seen.has(m[1]!) || at <= last) return "Its fields repeat or are out of order.";
    seen.set(m[1]!, m[2]!.trim());
    last = at;
  }
  const uri = seen.get("URI");
  if (uri !== undefined && !(uri === `https://${s.domain}` || uri.startsWith(`https://${s.domain}/`))) return "Its address isn't the site's own.";
  const version = seen.get("Version");
  if (version !== undefined && version !== "1") return "It isn't version 1.";
  if (!/^[A-Za-z0-9]{8,64}$/.test(seen.get("Nonce") ?? "")) return "It has no one-time number.";
  const issued = Date.parse(seen.get("Issued At") ?? "");
  if (!(Math.abs(nowMs - issued) <= SIGN_IN_FRESH_MS)) return "It isn't fresh.";
  const expires = seen.get("Expiration Time");
  if (expires !== undefined && !(Date.parse(expires) > nowMs && Date.parse(expires) <= nowMs + SIGN_IN_LONGEST_MS)) return "It lasts too long.";
  const notBefore = seen.get("Not Before");
  if (notBefore !== undefined && !(Date.parse(notBefore) <= nowMs)) return "It isn't valid yet.";
  return null;
}

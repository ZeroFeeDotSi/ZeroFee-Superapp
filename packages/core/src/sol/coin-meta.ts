// A coin's own symbol from the chain, for the core's sheet (a real-money run, 3 Nov: "Buy an unnamed coin"):
// Token-2022's metadata extension in the mint, else Metaplex's metadata account. Display only, never a check. Loaded
// with the first sheet that names a coin (solana.ts RpcSolChain.mintSymbol), never in Home's first load.
import { fromBase58, fromBase64, utf8 } from "./bytes.ts";
import { SOL, findProgramAddress } from "../solana.ts";

/** Metaplex's token metadata program: a coin's name and symbol for SPL Token mints. */
export const SOL_METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

/** A Borsh string at `at` (u32 length, then UTF-8), its padding NULs and spaces trimmed; null past the end. */
function borshString(b: Uint8Array, at: number): { text: string; next: number } | null {
  if (at + 4 > b.length) return null;
  const n = b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24);
  if (n < 0 || n > 200 || at + 4 + n > b.length) return null;
  return { text: new TextDecoder().decode(b.subarray(at + 4, at + 4 + n)).replace(/[\u0000\s]+$/u, "").trim(), next: at + 4 + n };
}
/** A coin's symbol fit for a sheet: plain letters and digits (a few marks), 1 to 12 of them; anything else isn't said. */
const plainSymbol = (s: string | undefined): string | null => (s && /^[A-Za-z0-9][A-Za-z0-9$._-]{0,11}$/.test(s) ? s : null);

/** Metaplex's Metadata account: key (1), update authority (32), mint (32), then name and symbol as Borsh strings. */
export function metaplexSymbol(b: Uint8Array): string | null {
  if (b.length < 69 || b[0] !== 4) return null;
  const name = borshString(b, 65);
  return name ? plainSymbol(borshString(b, name.next)?.text) : null;
}

/** A Token-2022 mint's metadata extension (TLV type 19 after the 165-byte base and its account type, 1 = mint): update
 *  authority (32), mint (32), then name and symbol as Borsh strings. */
export function token2022Symbol(b: Uint8Array): string | null {
  if (b.length <= 166 || b[165] !== 1) return null;
  for (let at = 166; at + 4 <= b.length; ) {
    const type = b[at]! | (b[at + 1]! << 8), len = b[at + 2]! | (b[at + 3]! << 8);
    if (type === 0) return null;
    if (type === 19) {
      const v = b.subarray(at + 4, at + 4 + len);
      const name = borshString(v, 64);
      return name ? plainSymbol(borshString(v, name.next)?.text) : null;
    }
    at += 4 + len;
  }
  return null;
}

/** The mint's symbol through `read` (one node's getAccountInfo, base64): the mint's own extension, else its Metaplex
 *  metadata account. Null: none that reads plainly. */
export async function mintSymbolFrom(read: (address: string) => Promise<{ owner?: string; data?: unknown[] } | null>, mint: string): Promise<string | null> {
  const m = await read(mint);
  if (!m || !Array.isArray(m.data)) return null;
  const inMint = m.owner === SOL.token2022 ? token2022Symbol(fromBase64(String(m.data[0]))) : null;
  if (inMint) return inMint;
  const md = await read(findProgramAddress([utf8("metadata"), fromBase58(SOL_METADATA_PROGRAM), fromBase58(mint)], SOL_METADATA_PROGRAM));
  return md && md.owner === SOL_METADATA_PROGRAM && Array.isArray(md.data) ? metaplexSymbol(fromBase64(String(md.data[0]))) : null;
}

/** RpcSolChain.mintSymbol: the first of the two nodes that answers. */
export async function mintSymbolOn(nodes: string[], rpc: (url: string, method: string, params: unknown[]) => Promise<any>, mint: string): Promise<string | null> {
  for (const u of nodes) {
    try {
      return await mintSymbolFrom(async (a) => (await rpc(u, "getAccountInfo", [a, { encoding: "base64", commitment: "confirmed" }]))?.value ?? null, mint);
    } catch {
      // the other node
    }
  }
  return null;
}

/** RpcSolChain.executable (review M2): for each key, false only when both nodes answer and both say it isn't a program
 *  (a token account the transaction makes is not a program); any other answer is true, so it must be known.
 *  A node that doesn't answer at all is asked once more; if it still doesn't, the read fails (the route check then says
 *  it couldn't check, PAYOUT_WORDS.appsUnread). QA's re-test (4 Nov): one node's missing answer counted
 *  every account as a program, so a plain BONK buy on Jupiter was refused as "an app ZeroFee doesn't know". */
export async function executableOn(keys: string[], both: <T>(ask: (url: string) => Promise<T>) => Promise<(T | null)[]>, accounts: (url: string, keys: string[]) => Promise<any>): Promise<boolean[]> {
  if (!keys.length) return [];
  const read = () => both(async (u) => {
    const value: unknown[] = (await accounts(u, keys)).value;
    return value.map((v: any) => (v === null ? false : typeof v?.executable === "boolean" ? (v.executable as boolean) : null));
  });
  let said = await read();
  if (said.length !== 2) throw new Error("its programs weren't read on two nodes");
  if (said.some((a) => a === null)) {
    // each node's own answer is kept; only the one that didn't answer is filled from the second ask
    const again = await read();
    said = said.map((a, n) => a ?? again[n] ?? null);
    if (said.some((a) => a === null)) throw new Error("a node didn't answer which accounts are programs");
  }
  return keys.map((_, i) => !said.every((a) => a?.[i] === false));
}

/** A coin's name and symbol from Metaplex's Metadata account (as metaplexSymbol reads it), each only when plain. */
export function metaplexNameSymbol(b: Uint8Array): { name?: string; symbol?: string } | null {
  if (b.length < 69 || b[0] !== 4) return null;
  const name = borshString(b, 65);
  return name ? named(name.text, borshString(b, name.next)?.text) : null;
}
/** A Token-2022 mint's name and symbol from its metadata extension (as token2022Symbol reads it). */
export function token2022NameSymbol(b: Uint8Array): { name?: string; symbol?: string } | null {
  if (b.length <= 166 || b[165] !== 1) return null;
  for (let at = 166; at + 4 <= b.length; ) {
    const type = b[at]! | (b[at + 1]! << 8), len = b[at + 2]! | (b[at + 3]! << 8);
    if (type === 0) return null;
    if (type === 19) {
      const v = b.subarray(at + 4, at + 4 + len);
      const name = borshString(v, 64);
      return name ? named(name.text, borshString(v, name.next)?.text) : null;
    }
    at += 4 + len;
  }
  return null;
}
/** A coin's name fit for a list: up to 32 letters, digits, spaces and a few marks; anything else isn't said. */
const plainName = (s: string | undefined): string | null => (s && s.length <= 32 && /^[\p{L}\p{N} $._&'()+-]+$/u.test(s) ? s : null);
const named = (name: string | undefined, symbol: string | undefined): { name?: string; symbol?: string } => {
  const n = plainName(name), s = plainSymbol(symbol);
  return { ...(n ? { name: n } : {}), ...(s ? { symbol: s } : {}) };
};

/**
 * Many coins at once for a wallet's list (site-coins.ts): each mint's decimals (SPL Token or Token-2022, initialized),
 * and its name and symbol (the mint's own extension, else Metaplex's metadata account), in two getMultipleAccounts
 * reads on one node, the other if it fails. A mint that can't be read is left out. Display only.
 */
export async function coinsMetaOn(nodes: string[], rpc: (url: string, method: string, params: unknown[]) => Promise<any>, mints: string[]): Promise<Map<string, { decimals: number; symbol?: string; name?: string }>> {
  type Acct = { owner?: string; data?: unknown[] } | null;
  const out = new Map<string, { decimals: number; symbol?: string; name?: string }>();
  if (!mints.length) return out;
  const many = async (u: string, keys: string[]): Promise<Acct[]> => {
    const all: Acct[] = [];
    for (let i = 0; i < keys.length; i += 100) {
      const v = (await rpc(u, "getMultipleAccounts", [keys.slice(i, i + 100), { encoding: "base64", commitment: "confirmed" }]))?.value;
      if (!Array.isArray(v)) throw new Error("no answer about accounts");
      all.push(...v);
    }
    return all;
  };
  for (const u of nodes) {
    try {
      const accounts = await many(u, mints);
      const plain: string[] = [];
      accounts.forEach((a, i) => {
        if (!a || (a.owner !== SOL.token && a.owner !== SOL.token2022) || !Array.isArray(a.data)) return;
        const data = fromBase64(String(a.data[0]));
        // the mint layout: an optional authority (36 bytes), the supply (8), then the decimals; initialized at byte 45
        if (data.length < 82 || data[45] !== 1 || data[44]! > 18) return;
        const own = a.owner === SOL.token2022 ? token2022NameSymbol(data) : null;
        out.set(mints[i]!, { decimals: data[44]!, ...(own ?? {}) });
        if (!own?.symbol) plain.push(mints[i]!);
      });
      if (plain.length) {
        const pdas = plain.map((m) => findProgramAddress([utf8("metadata"), fromBase58(SOL_METADATA_PROGRAM), fromBase58(m)], SOL_METADATA_PROGRAM));
        const md = await many(u, pdas).catch((): Acct[] => []);
        md.forEach((a, i) => {
          if (!a || a.owner !== SOL_METADATA_PROGRAM || !Array.isArray(a.data)) return;
          const n = metaplexNameSymbol(fromBase64(String(a.data[0])));
          const m = plain[i]!;
          if (n) out.set(m, { ...out.get(m)!, ...n });
        });
      }
      return out;
    } catch {
      out.clear();
      // the other node
    }
  }
  return out;
}

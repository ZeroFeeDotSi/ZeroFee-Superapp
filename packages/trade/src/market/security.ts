// Our reading of a coin's security flags (display only; never gates a trade by itself).
//  Solana: mint authority (can mint more) and freeze authority (can freeze your tokens: a coin whose freeze authority is set can stop a sell).
// The market data's token info says them as "yes" / "no" / "unknown"; if it does not, the Solana engine's own node read can (readSolMint).
import type { CoinDetail } from "./types.ts";

export type Security = NonNullable<CoinDetail["security"]>;
const flag = (v: unknown): boolean | undefined => (v === true || v === "yes" || v === "true" ? true : v === false || v === "no" || v === "false" ? false : undefined);

/** Reads the authorities from a GeckoTerminal token info answer. Unknown stays undefined. */
export function securityOfInfo(attrs: { mint_authority?: unknown; freeze_authority?: unknown } | undefined): Security | undefined {
  if (!attrs) return undefined;
  const mintAuthority = flag(attrs.mint_authority), freezeAuthority = flag(attrs.freeze_authority);
  if (mintAuthority === undefined && freezeAuthority === undefined) return undefined;
  return { ...(mintAuthority !== undefined ? { mintAuthority } : {}), ...(freezeAuthority !== undefined ? { freezeAuthority } : {}) };
}

type RpcFn = (method: string, params: unknown[]) => Promise<any>;
/** Reads a Solana mint's authorities from a node (jsonParsed account). Undefined when the account is not a mint or the node cannot answer. */
export async function readSolMint(rpc: RpcFn, mint: string): Promise<Security | undefined> {
  try {
    const r = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }]);
    const parsed = r?.value?.data?.parsed;
    if (parsed?.type !== "mint" || !parsed.info) return undefined;
    return { mintAuthority: !!parsed.info.mintAuthority, freezeAuthority: !!parsed.info.freezeAuthority };
  } catch { return undefined; }
}

/** One plain line for a screen. Never claims a coin is risk-free. */
export function securityNotes(s: Security | undefined): string[] {
  if (!s) return [];
  const out: string[] = [];
  if (s.mintAuthority === true) out.push("The creator can still make more of this coin"); else if (s.mintAuthority === false) out.push("No one can make more of this coin");
  if (s.freezeAuthority === true) out.push("The creator can freeze coins, which can stop a sale"); else if (s.freezeAuthority === false) out.push("No one can freeze this coin");
  return out;
}

// Did the Safe pay this Add's deposit address (QA's MUST, 5 Nov)? Asked for an Add whose page closed while the
// Safe signed (trade float-signing.ts), before its row may say "nothing moved". Loaded with its first ask, never in Home's
// first load (the speed budget); the ledger hands over what it needs.
// "found": the Safe's own record lists a payment to the address since `sinceIso`. "unknown": a read failed or came back
// partial, or the address holds the coin's storage with no such payment listed (a payment may be on its way, or 1Click
// registered it itself: never proof either way, the audit's note 1). "none": the whole record lists none and the coin's storage
// on two nodes at one final block isn't there; a coin with no storage to read (native NEAR, the audit's note 2) rests on the
// record alone. Reads only.
import type { Chain } from "@zerofee/core/chain";

export interface AddSentHost {
  chain: Pick<Chain, "commonBlock" | "view" | "pastTransactions">;
  /** The Safe's account id. */
  me(): Promise<string>;
  /** The coin's NEP-141 contract, none for native NEAR. */
  contractOf(tokenId: string): string | undefined;
  usdc: string;
  invalid(why: string): Error;
}

export async function addSent(p: Record<string, unknown>, h: AddSentHost): Promise<"none" | "found" | "unknown"> {
  const dep = typeof p.depositAddress === "string" ? p.depositAddress : "";
  if (!/^[0-9a-f]{64}$/.test(dep)) throw h.invalid("depositAddress is 1Click's address on NEAR");
  const tokenId = typeof p.tokenId === "string" ? p.tokenId : h.usdc;
  const since = typeof p.sinceIso === "string" ? Date.parse(p.sinceIso) : NaN;
  if (!Number.isFinite(since)) throw h.invalid("sinceIso is when the Add was saved");
  const contract = h.contractOf(tokenId);
  try {
    const me = await h.me();
    const block = contract ? await h.chain.commonBlock() : undefined;
    const [reg, past, act] = await Promise.all([contract && block ? h.chain.view(contract, "storage_balance_of", { account_id: dep }, block) : Promise.resolve(null), h.chain.pastTransactions(me, 30), import("@zerofee/core/activity")]);
    const paid = past.some((tx) => Date.parse(tx.atIso) >= since - 60_000 && (act.recipientsOf(tx).includes(dep) || JSON.stringify(tx.actions).includes(dep)));
    if (paid) return "found";
    return past.partial || reg !== null ? "unknown" : "none";
  } catch {
    return "unknown";
  }
}

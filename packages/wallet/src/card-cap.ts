// The card wallet's cap (B28): a payment to the person's own card wallet (a "pay" wallet on Gnosis) never takes it past
// CARD_CAP_USD, counted at prices read now. Moved out of ledger.ts so it loads only with such a payment (the speed budget,
// 7 Nov: Home's first load); the same code as before.
import type { Bridge } from "@zerofee/core/bridge";
import { ProblemError } from "@zerofee/core/problem";
import { fromUnits, usdOf } from "./amount.ts";
import type { Catalogue } from "./catalogue.ts";
import type { Payee } from "./types.ts";
import { walletProblems } from "./wallet-problems.ts";

/** Security F2 / D34: the card wallet (subwallet kind "pay", Gnosis) holds at most this many dollars, at the catalogue's price. */
const CARD_CAP_USD = 250;

export async function cardCap(x: { own: Bridge; catalogue: (o?: { live?: boolean }) => Promise<Catalogue> }, to: Payee, tokenId: string, amount: string): Promise<void> {
  const { own, catalogue } = x;
  if (to.kind !== "chain") return;
  const listed = await own.call<{ id?: unknown; kind?: unknown; address?: unknown }[]>("subwallet.list", { kind: "pay" });
  const same = (a: string) => a.trim().toLowerCase() === to.address.trim().toLowerCase();
  const card = "ok" in listed && Array.isArray(listed.ok) ? listed.ok.find((w) => w?.kind === "pay" && typeof w.id === "string" && typeof w.address === "string" && same(w.address)) : undefined;
  if (!card) return;
  // a cap in dollars is checked at a price read now, never one kept on the device (B28)
  const cat = await catalogue({ live: true });
  const incoming = cat.coin(tokenId);
  const adding = incoming ? Number(usdOf(amount, incoming.priceUsd) ?? NaN) : NaN;
  const read = await own.call<{ token?: unknown; decimals?: unknown; amount?: unknown }[]>("subwallet.balances", { id: card.id });
  if (!Number.isFinite(adding) || !("ok" in read) || !Array.isArray(read.ok)) throw new ProblemError(walletProblems.quoteUnavailable("Gnosis or NEAR Intents didn't answer, so your card wallet isn't read. Nothing moved."));
  let held = 0;
  for (const row of read.ok) {
    const raw = typeof row?.amount === "string" && /^\d+$/.test(row.amount) ? BigInt(row.amount) : null;
    if (raw === null || typeof row.decimals !== "number") throw new ProblemError(walletProblems.quoteUnavailable("Gnosis didn't answer, so your card wallet isn't read. Nothing moved."));
    if (raw === 0n) continue;
    const token = String(row.token).toLowerCase();
    const coin = [...cat.tokens()].find((t) => t.chain === "gnosis" && (token === "native" ? t.contract === null && t.symbol.toUpperCase() === "XDAI" : t.contract?.toLowerCase() === token));
    const usd = coin ? Number(usdOf(fromUnits(raw, row.decimals), coin.priceUsd) ?? NaN) : NaN;
    if (!Number.isFinite(usd)) throw new ProblemError(walletProblems.quoteUnavailable("A coin in the card wallet has no price."));
    held += usd;
  }
  if (held + adding > CARD_CAP_USD + 1e-9) throw new ProblemError(walletProblems.cardCap(CARD_CAP_USD, held.toFixed(2), Math.max(0, CARD_CAP_USD - held).toFixed(2)));
}

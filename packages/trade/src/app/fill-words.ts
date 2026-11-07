// the audit's Trade audit T1 (8 Nov): a Solana buy is done on the first node's word, and what arrived is then the quote's figure
// (service.ts marks that fill `estimated`). The receipt said "Bought · 7,505 DOPE", the list row "Bought · 7,505 DOPE" and
// Activity "7,505 DOPE" as if the chain had said so; a sale's receipt said the quote's dollars under "Sold". Here, one rule
// for all three: the quote's figure is "about" until the chain's read books the trade, then the read figure, plain. The
// sheet and the row redraw once it books (whenBooked); an amount never proven is the record's "amount unchecked" turn
// (trade-turn.ts, job-cards.ts). Pure: no React.
import { amount, usd } from "./format.ts";
import type { TradeRecord, TradeService } from "../service.ts";
import { tradeUsd } from "../trade-usd.ts";

type Rec = Pick<TradeRecord, "kind" | "fill" | "costs" | "quote" | "amountUsd" | "symbol">;

/** A buy's coins are the quote's, not the chain's: no fill yet, or one marked estimated. */
export const coinsAbout = (r: Pick<TradeRecord, "fill">): boolean => !r.fill || !!r.fill.estimated;
/** A sale's dollars are the quote's, not the chain's: not booked yet (no costs), or booked from an estimated fill. */
export const dollarsAbout = (r: Pick<TradeRecord, "kind" | "fill" | "costs">): boolean => r.kind === "sell" && (!r.costs || !!r.fill?.estimated);

/** A buy's coins, the figure only ("7,505"): the chain's once read, else the quote's. */
export function boughtCoins(r: Pick<TradeRecord, "fill" | "quote">): string {
  const q = r.quote;
  if (!q) return "";
  return amount(r.fill && !r.fill.estimated ? r.fill.got : q.getRaw, q.decimals);
}

/** The landed receipt's figures (TradeSheet): `got` the coins line's figure, `about` whether that line says "About", `usd`
 *  the big figure. A buy's dollars are what it paid (the chain's in all once booked, else the signed quote's `hero`); a
 *  sale's coins are what it sent (`sold`, known), its dollars "About $4.86" until the chain's figure books. */
export function landedSaid(r: Rec, o: { hero: string; sold: string }): { got: string; about: boolean; usd: string } {
  if (r.kind === "sell") {
    const figure = r.costs ? usd(tradeUsd(r)) : o.hero;
    return { got: o.sold, about: false, usd: dollarsAbout(r) ? `About ${figure}` : figure };
  }
  return { got: boughtCoins(r), about: coinsAbout(r), usd: r.costs ? usd(r.amountUsd) : o.hero };
}

/** The list row's landed coins ("7,505 DOPE") and whether its line says "about" (row-buy.ts rowBuyLine). */
export function rowSaid(r: Pick<TradeRecord, "fill" | "quote" | "symbol">): { got: string; about: boolean } {
  return { got: `${boughtCoins(r)} ${r.symbol}`, about: coinsAbout(r) };
}

/** `then(rec)` once record `id` is booked by the chain's read (done, its costs in), looked up by id on every service event.
 *  Stops by itself once it ends another way (turned failed or expired; done with no check left and no figure: its
 *  "amount unchecked" turn says so), after `giveUpMs`, or with the returned stop. It looks once at the start too. */
export function whenBooked(svc: Pick<TradeService, "on" | "activity">, id: string, then: (rec: TradeRecord) => void, giveUpMs = 60_000): () => void {
  let over = false, off = () => {}, t: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { if (over) return; over = true; off(); if (t) clearTimeout(t); };
  const look = () => void svc.activity().then((all) => {
    if (over) return;
    const r = all.find((x) => x.id === id);
    if (!r) return;
    if (r.status === "done" && r.costs) { stop(); then(r); return; }
    if (r.status !== "done" || !r.verifying) stop();
  }, () => undefined);
  off = svc.on(look);
  t = setTimeout(stop, giveUpMs);
  look();
  return stop;
}

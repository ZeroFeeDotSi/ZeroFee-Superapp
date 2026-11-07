// the audit's way-home audit P4 (7 Nov; D140: "the total fell by the $X on its way"): Private $33.86, Move it all: the Safe's
// $5,288.01 showed $5,254.15 for the whole flight and through a reload. A moving way home ("home:" out of Private) is in
// neither Private's rows nor the Safe's, and Home counted only Adds and Safe swaps. Now it counts at its coin's price
// until it ends, as a Safe swap in flight does. Pure: a table test.
import type { Movement } from "../../types.ts";
import { PRIVATE_KIND } from "../../types.ts";

/** The ways home still travelling: out of Private, to the Safe (private-pay.ts fromPrivate's own record). */
export const homing = (activity: readonly Movement[] | null | undefined): Movement[] =>
  (activity ?? []).filter((m) => m.kind === "private" && m.from === PRIVATE_KIND && m.status === "moving" && m.id.startsWith("home:"));

/** Their dollars at each coin's price (`to`: the coin it lands as in the Safe); a coin with no price counts nothing. */
export const homingUsd = (ms: readonly Movement[], priceOf: (tokenId: string) => string | number | null | undefined): number =>
  ms.reduce((t, m) => {
    const px = Number(priceOf(m.to ?? ""));
    const n = Number(m.amount);
    return t + (px > 0 && Number.isFinite(n) ? n * px : 0);
  }, 0);

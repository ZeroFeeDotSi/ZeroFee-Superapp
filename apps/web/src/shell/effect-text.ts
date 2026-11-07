import type { PlainWords } from "@zerofee/core/signer";

/** An effect row's figures: "before → after"; a row with no `before` says only where it ends (separate steps' "Your Safe
 *  after · $1,090.50 in USDC", 53, 7 Nov), no arrow. The phone's sheet draws the same (NativeSheet.swift). */
export const effectText = (e: PlainWords["effect"][number]): string => (e.before === "" ? e.after : `${e.before} → ${e.after}`);

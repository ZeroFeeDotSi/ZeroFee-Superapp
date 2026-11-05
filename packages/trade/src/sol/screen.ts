// What Buy refuses on Solana, read off the coins' own mints, so a list never offers a coin whose Buy would say no: a freeze
// authority, or a Token-2022 power over what a buyer holds (codec.ts issuerHold). A read for the screens, never the gate:
// every Buy path checks the mint again. Mints are read 10 at a time (the free node's cap) and remembered for 10 minutes;
// a mint no node could read is simply not screened (and asked again next time). Two nodes are asked (audit T-6): a coin
// either one says Buy refuses is refused, and a coin is called clean only when both nodes read it and say so.
import { fromBase64 } from "./bytes.ts";
import { issuerHold, mintExtensions, mintFreezable } from "./codec.ts";
import { PROGRAM } from "./keys.ts";
import type { SolRpc } from "./rpc.ts";
import type { IssuerHold } from "../errors.ts";

/** Why Buy refuses a coin: the reason the Buy path would give (trade-problems.ts has the words). */
export type BuyRefusal = "freezable" | IssuerHold;

const SCREEN_TTL_MS = 600_000;
const PER_CALL = 10;

/** The screen: the coins Buy refuses, and `clean(mint)`: true only when two nodes read the mint within the last 10 minutes
 *  and found nothing Buy refuses (no freeze authority, no Token-2022 power over a holder). Not read, one node, a failed
 *  read, or a read gone stale: false (the coin page's Freeze row then says "Not checked yet", T-3). */
export interface SolScreen { (mints: string[]): Promise<Map<string, BuyRefusal>>; clean(mint: string): boolean }

export function createSolScreen(rpc: SolRpc, now: () => number = Date.now): SolScreen {
  const seen = new Map<string, { at: number; why?: BuyRefusal }>();
  const clean = (mint: string): boolean => { const hit = seen.get(mint); return !!hit && !hit.why && now() - hit.at < SCREEN_TTL_MS; };
  /** The coins among `mints` that Buy refuses, with why. Never throws. */
  return Object.assign(async function refused(mints: string[]): Promise<Map<string, BuyRefusal>> {
    const t = now(), out = new Map<string, BuyRefusal>();
    const ask = [...new Set(mints)].filter((m) => {
      const hit = seen.get(m);
      if (!hit || t - hit.at >= SCREEN_TTL_MS) return true;
      if (hit.why) out.set(m, hit.why);
      return false;
    });
    const chunks = Array.from({ length: Math.ceil(ask.length / PER_CALL) }, (_, i) => ask.slice(i * PER_CALL, (i + 1) * PER_CALL));
    await Promise.all(chunks.map(async (chunk) => {
      type Rows = ({ owner: string; data: [string, string] } | null)[];
      const answers = await rpc.askNodes("getMultipleAccounts", [chunk, { encoding: "base64", commitment: "confirmed" }], 2).catch(() => []);
      const reads = answers.map((a) => (a.ok ? (a.value?.value as Rows | undefined) : undefined)).filter((rows): rows is Rows => Array.isArray(rows) && rows.length === chunk.length);
      if (!reads.length) return;
      // the issuer's Token-2022 powers name the refusal before a freeze authority, as every Buy path does
      const verdict = (row: Rows[number]): BuyRefusal | "clean" | undefined => {
        if (!row || (row.owner !== PROGRAM.token && row.owner !== PROGRAM.token2022)) return undefined;   // not a mint: nothing to say
        const data = fromBase64(row.data[0]);
        return (row.owner === PROGRAM.token2022 ? issuerHold(mintExtensions(data)) : undefined) ?? (mintFreezable(data) ? "freezable" : "clean");
      };
      chunk.forEach((m, i) => {
        const says = reads.map((rows) => verdict(rows[i]!));
        const why = says.find((v): v is BuyRefusal => v !== undefined && v !== "clean");
        if (why) { seen.set(m, { at: t, why }); out.set(m, why); return; }
        // clean only on two nodes' word; one node's "clean" is asked again next time
        if (reads.length >= 2 && says.every((v) => v === "clean")) seen.set(m, { at: t });
      });
    }));
    return out;
  }, { clean });
}

// A quote that ran out while a sheet held the signature (QA crawl, web, 4 Nov: the first Buy's password sheet):
// the same amount is quoted again, silently, and run once more; only a price that fell under the minimum the person
// accepted stops it, said as the tap's own re-quote says it. Loaded by service.ts run() only when that happens.
import { ProblemError } from "@zerofee/core/problem";
import { tradeProblems } from "./trade-problems.ts";
import type { Quote } from "./types.ts";
import type { TradeRecord } from "./service.ts";

type Prepared = { quote: Quote };

export async function requote<P extends Prepared>(q: Quote, rec: TradeRecord, quote: (side: Quote["side"], chain: Quote["chain"], coin: Quote["coin"], pay: { raw: string }, o?: { attempt: number }) => Promise<P>, again: (fresh: P) => Promise<TradeRecord>): Promise<TradeRecord> {
  const fresh = await quote(q.side, q.chain, q.coin, { raw: q.payRaw }, (rec.attempt ?? 0) > 0 ? { attempt: rec.attempt! } : undefined);
  if (BigInt(fresh.quote.getMinRaw) < BigInt(q.getMinRaw)) throw new ProblemError(tradeProblems.priceMoved(q.symbol));
  rec.quote = fresh.quote;
  return again(fresh);
}

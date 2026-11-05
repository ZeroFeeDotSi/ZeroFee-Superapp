// The one line after a trade (Job 1), pure so node tests it: what arrived, dollars first for a sale ("Bought 1,204 BONK
// for $25.00"); B36-F1: a trade that went with no sheet on one server's test run says so, once, after it.
import { amount as fmtAmount, usd } from "./app/format.ts";
import type { TradeRecord } from "./service.ts";
import { tradeUsd } from "./trade-usd.ts";

export function boughtLineOf(rec: TradeRecord): string {
  const q = rec.quote;
  const about = !rec.fill || rec.fill.estimated ? "about " : "";
  const one = rec.checkedByOne ? ". Checked by one server." : "";
  if (rec.kind === "buy" && q) return `Bought ${about}${fmtAmount(rec.fill?.got ?? q.getRaw, q.decimals)} ${rec.symbol} for ${usd(rec.amountUsd)}${one}`;
  return `Sold ${rec.symbol} for ${about}${usd(tradeUsd(rec))}${one}`;
}

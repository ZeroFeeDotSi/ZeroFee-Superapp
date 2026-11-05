// The Sim's market knows the well-known Solana coins AgentZero's demo line names (design review, 4 Nov: "buy $1 of BONK"
// in the Sim never reached Trade, as BONK wasn't in the Sim's market). Recorded read-only from GeckoTerminal, 4 Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecordedFetch } from "./recorded.ts";
import { RECORDED } from "./recorded-data.ts";

const GT = "https://api.geckoterminal.com/api/v2";
const COINS: [string, string][] = [["BONK", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"], ["WIF", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"], ["JUP", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"], ["POPCAT", "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"]];

test("the Sim's search finds BONK, WIF, JUP and POPCAT on Solana, each with its own pool and price (control: a coin never recorded isn't found)", async () => {
  const f = createRecordedFetch(RECORDED, () => Date.parse("2026-11-04T00:00:00Z"));
  for (const [sym, addr] of COINS) {
    const s = (await (await f(`${GT}/search/pools?query=${sym}&network=solana`)).json()) as { data: { relationships: { base_token: { data: { id: string } } } }[] };
    assert.ok(s.data.some((p) => p.relationships.base_token.data.id.toLowerCase() === `solana_${addr.toLowerCase()}`), `${sym} found by its ticker`);
    const t = (await (await f(`${GT}/networks/solana/tokens/${addr}`)).json()) as { data: { attributes: { symbol: string; price_usd: string } } };
    assert.ok(Number(t.data.attributes.price_usd) > 0, `${sym} has a price`);
  }
  const none = (await (await f(`${GT}/search/pools?query=NOTACOINZZ&network=solana`)).json()) as { data: unknown[] };
  assert.equal(none.data.length, 0, "control");
});

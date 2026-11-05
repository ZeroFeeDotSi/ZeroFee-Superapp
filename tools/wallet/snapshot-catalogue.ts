// Writes the coin list the app ships with (B28 R3): packages/wallet/src/catalogue-snapshot.ts, 1Click's coins and NEAR
// Intents' bridge's table, slimmed to the fields the catalogue reads. The ledger shows it only when neither service has
// answered and this device has kept no list of its own, so a first paint never waits on a network answer. Its prices
// are marked old; nothing that moves money uses them (ledger.ts, `live`). Free: reads only, no key.
//
//   node tools/wallet/snapshot-catalogue.ts            1Click live, the bridge live (or its recorded table when it is down)
import { readFileSync, writeFileSync } from "node:fs";

const ONE_CLICK = "https://1click.chaindefuser.com/v0";
const BRIDGE = "https://bridge.chaindefuser.com/rpc";
const out = new URL("../../packages/wallet/src/catalogue-snapshot.ts", import.meta.url);

const tokens = (await (await fetch(`${ONE_CLICK}/tokens`, { signal: AbortSignal.timeout(20000) })).json()) as Record<string, unknown>[];
if (!Array.isArray(tokens) || tokens.length < 50) throw new Error("1Click's coin list looks wrong");
let rows: Record<string, unknown>[];
let bridgeFrom = "live";
try {
  const res = await fetch(BRIDGE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "zf", method: "supported_tokens", params: [{}] }), signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  rows = ((await res.json()) as { result: { tokens: Record<string, unknown>[] } }).result.tokens;
} catch (e) {
  bridgeFrom = `recorded (the bridge said ${(e as Error).message})`;
  rows = JSON.parse(readFileSync(new URL("../../packages/wallet/src/testing/fixtures/bridge-supported-tokens.json", import.meta.url), "utf8")).response.result.tokens;
}

const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]]));
const coins = tokens.map((t) => pick(t, ["assetId", "decimals", "blockchain", "symbol", "price", "contractAddress"]));
const table = rows.map((r) => pick(r, ["intents_token_id", "defuse_asset_identifier", "min_deposit_amount", "min_withdrawal_amount", "withdrawal_fee"]));
const at = new Date().toISOString();

writeFileSync(
  out,
  `// The coin list the app ships with (B28 R3), written by tools/wallet/snapshot-catalogue.ts on ${at.slice(0, 10)}: shown only when
// 1Click and NEAR Intents' bridge haven't answered and this device has kept no list of its own. Its prices are old.
import type { BridgeToken, OneClickToken } from "./apis.ts";

export const SNAPSHOT_AT = ${JSON.stringify(at)};
export const SNAPSHOT_TOKENS = ${JSON.stringify(coins)} as OneClickToken[];
export const SNAPSHOT_BRIDGE = ${JSON.stringify(table)} as BridgeToken[];
`,
);
console.log(`wrote ${coins.length} coins (1Click live) and ${table.length} bridge rows (${bridgeFrom})`);

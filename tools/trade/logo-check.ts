// Which trending coins' logos the relay can't answer (real network; never a unit test).
//   node tools/trade/logo-check.ts [relay-url]
import { readFileSync } from "node:fs";
import { createMarket } from "../../packages/trade/src/market/index.ts";

const relay = process.argv[2] ?? readFileSync(new URL("../../apps/ios/relay-url.txt", import.meta.url), "utf8").trim();
const m = createMarket({ relay, storage: null });
const rows = await m.trending();
for (const r of rows.slice(0, 30)) {
  const u = r.logoUrl;
  let s = "none";
  if (u?.startsWith("http")) { const x = await fetch(u); s = String(x.status); if (x.status !== 200) s += " " + (await x.text()).slice(0, 90); }
  else if (u) s = "data";
  console.log(r.chain.padEnd(5), r.symbol.padEnd(12), r.address.slice(0, 48).padEnd(50), s);
}

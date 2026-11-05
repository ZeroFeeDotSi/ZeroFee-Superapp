// A loader for web-trade-on.check.ts: web-wallet.ts as a build with VITE_WEB_TRADE=1 has it (Vite's define writes the
// literal in place of import.meta.env?.VITE_WEB_TRADE). Nothing else changes.
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
export async function load(url, context, next) {
  const out = await next(url, context);
  if (!url.endsWith("/web-wallet.ts")) return out;
  const src = String(out.source).replace("import.meta.env?.VITE_WEB_TRADE", '"1"');
  return { ...out, source: src };
}
`));

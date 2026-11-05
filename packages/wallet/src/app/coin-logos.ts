// Home's coin logos (product decision, 3 Nov: a bought memecoin showed as a letter): each held coin's picture by its chain and
// address alone, through the relay (@zerofee/core/coin-logo), and kept on the phone once seen (coin-logo-book.ts, sealed,
// loaded after Home's first paint), so the next open draws it with no network.
import { useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { buildRelay, coinLogoUrl } from "@zerofee/core/coin-logo";
import type { LogoBook } from "@zerofee/core/coin-logo-book";

const books = new WeakMap<Pick<Bridge, "call">, Promise<LogoBook>>();
const opened = new WeakMap<Pick<Bridge, "call">, LogoBook>();

function bookFor(bridge: Pick<Bridge, "call">, relay: string | undefined): Promise<LogoBook> {
  let p = books.get(bridge);
  if (!p) {
    p = import("@zerofee/core/coin-logo-book").then((m) => m.createLogoBook(bridge, relay ? { relay } : {}));
    void p.then((b) => b.ready.then(() => opened.set(bridge, b)), () => books.delete(bridge));
    books.set(bridge, p);
  }
  return p;
}

/** Each held coin's logo: the kept picture, else the relay's url; undefined with no relay or an address it won't take. */
export function useCoinLogos(bridge: Pick<Bridge, "call">, coins: readonly { chain: string; address: string }[] | null, relay: string | undefined = buildRelay()): (chain: string, address: string) => string | undefined {
  const [, changed] = useState(0);
  const key = (coins ?? []).map((c) => `${c.chain}:${c.address}`).join(",");
  useEffect(() => {
    if (!relay || !coins?.length) return;
    let live = true, off: (() => void) | undefined;
    void bookFor(bridge, relay).then((b) => b.ready.then(() => {
      if (!live) return;
      off = b.subscribe(() => changed((n) => n + 1));
      changed((n) => n + 1);
      b.want(coins);
    }), () => undefined);
    return () => { live = false; off?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, relay, key]);
  // read at call time: a kept picture arriving re-renders Home (changed), and this reads the book as it is then
  return (chain: string, address: string) => opened.get(bridge)?.src(chain, address) ?? coinLogoUrl(relay, chain, address);
}

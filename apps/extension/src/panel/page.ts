// Which coin the tab beside the panel shows. The content script tells the background the page's address; the background
// keeps it per tab (in session storage); the panel follows the active tab of its own window. An Axiom address may be a
// pool, so it is resolved on-chain first (Trade's resolver), then through market data (a pump.fun curve stores no mint).
import { useEffect, useState } from "react";
import type { Problem } from "@zerofee/core/problem";
import type { Market } from "@zerofee/trade/market/types.ts";
import { resolveSolCoin } from "@zerofee/trade/sol/resolve.ts";
import type { SolRpc } from "@zerofee/trade/sol/rpc.ts";
import { extProblems } from "../problems.ts";
import type { PageCoin } from "../site.ts";

const CHAIN_WORDS: Record<PageCoin["chain"], string> = { sol: "Solana", bsc: "BNB Chain", base: "Base", other: "another chain" };

/** The active tab's page: undefined while it is read, null when the tab isn't a supported coin page. */
export function usePageCoin(): PageCoin | null | undefined {
  const [coin, setCoin] = useState<PageCoin | null | undefined>(undefined);
  useEffect(() => {
    let tabId: number | undefined, live = true;
    const read = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id;
      const v = tabId === undefined ? undefined : ((await chrome.storage.session.get(`tab.${tabId}`))[`tab.${tabId}`] as { coin: PageCoin | null } | undefined);
      if (live) setCoin(v?.coin ?? null);
    };
    const onTab = () => { void read(); };
    const onChange = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== "session" || tabId === undefined || !(`tab.${tabId}` in changes)) return;
      setCoin((changes[`tab.${tabId}`]!.newValue as { coin: PageCoin | null } | undefined)?.coin ?? null);
    };
    void read();
    chrome.tabs.onActivated.addListener(onTab);
    chrome.storage.onChanged.addListener(onChange);
    return () => { live = false; chrome.tabs.onActivated.removeListener(onTab); chrome.storage.onChanged.removeListener(onChange as never); };
  }, []);
  return coin;
}

/** The coin's mint, or the Problem that says why the page can't be read. */
export async function mintOf(page: PageCoin, rpc: SolRpc, market: Market): Promise<{ mint: string } | { problem: Problem }> {
  if (page.chain !== "sol") return { problem: extProblems.pageChain(CHAIN_WORDS[page.chain]) };
  if (page.names === "coin") return { mint: page.address };
  const onChain = await resolveSolCoin(rpc, page.address).catch(() => undefined);
  if (onChain) return { mint: onChain.mint };
  const listed = (await market.search(page.address).catch(() => [])).find((r) => r.chain === "sol");
  return listed ? { mint: listed.address } : { problem: extProblems.pageUnreadable() };
}

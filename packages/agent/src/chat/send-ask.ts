// Home's Send, as AgentZero opens it filled in (one source for the chat's MoneyCard, apps/web money-ask.ts, and the Sim's
// rule box, zero/rule-home.ts). Pure: node tests it.
import type { MoneyAsk } from "@zerofee/shell-api/money.ts";
import { sendLink } from "@zerofee/pay/app/links.ts";
import type { HomeAsk, HomeCoin, HomePlace } from "./home-ask.ts";

/** A wallet's own coin: a send of it, from no place said, opens From that wallet (QA walk: "send $5 of SOL
 *  to <address>" opened From the Safe's NEAR, Send's biggest source, as the coin rode only in the link). */
const OWN_WALLET: Partial<Record<HomeCoin, HomePlace>> = { SOL: "sol", ETH: "hood" };

/** Where Send opens From, and the coin it opens on: the place said; else a wallet's own coin's wallet; else (a Safe coin,
 *  USDC or NEAR) the coin itself, which Send opens on wherever it can send the most of it (send-sources.ts startSource). */
export function sendFrom(coin: HomeCoin | undefined, wallet: HomePlace | undefined): { wallet?: HomePlace; coin?: HomeCoin } {
  const place = wallet ?? (coin ? OWN_WALLET[coin] : undefined);
  return { ...(place ? { wallet: place } : {}), ...(coin && (!place || place === "safe") ? { coin } : {}) };
}

/** The ask Home's Send is opened with: today's fields (the payee through Pay's send link, the tab), and the prefill
 *  fields (`prefill` off: today's only). */
export function sendMoneyAsk(a: Extract<HomeAsk, { kind: "send" }>, prefill: boolean): MoneyAsk {
  const from = sendFrom(a.coin, a.wallet);
  // the coin goes in the link only where Send's own list names it by that ticker (SOL on Solana, NEAR or USDC on NEAR);
  // on ETH (RH) Send's list has no "ETH" ticker, and the link would be refused: Send picks ETH (RH) by the address itself
  return { kind: "send", link: sendLink({ to: a.to, chain: a.chain, ...(a.coin && a.chain !== "hood" ? { coin: a.coin } : {}) }), ...(prefill ? { to: a.to, chain: a.chain, usd: a.usd } : {}), ...(from.wallet ? { wallet: from.wallet } : {}), ...(prefill && from.coin ? { coin: from.coin } : {}), ...(prefill && a.note ? { note: a.note } : {}), ...(prefill ? { agentFilled: true } : {}) } as unknown as MoneyAsk;
}

/** Home's Send with no payee yet (the Sim's "send $5 of SOL to my friend"): From the coin's place, the dollars said, and
 *  Send's own "who" field empty, so its own list says what can get that coin. */
export function sendNoPayeeAsk(coin: HomeCoin, usd: string | null): MoneyAsk {
  const from = sendFrom(coin, undefined);
  return { kind: "send", ...(from.wallet ? { wallet: from.wallet } : {}), ...(from.coin ? { coin: from.coin } : {}), ...(usd ? { usd } : {}) } as unknown as MoneyAsk;
}

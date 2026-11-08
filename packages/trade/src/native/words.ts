// Native coins' words (the design review's look, 5 Nov; the copywriter's bar: a five-year-old reads it, said once). The person
// never reads "intents", "1Click" or an asset id on these screens; the job in Activity names the protocol (swap.ts).
export const NATIVE_COPY = {
  /** Trade's two tabs, by their ids (requests.ts TradeSeg); the strings are the design review's. */
  trenches: "Trenches", // product decision, 5 Nov
  intents: "NEAR Intents", // product decision, 5 Nov
  best: (n: number) => `Best of ${n} today · bought from your Safe`,
  fromSafe: "Bought from your Safe",
  search: "Find a coin",
  clear: "Clear",
  noMatch: "No coin by that name.",
  listDown: "Prices didn't load. Your money is still in your Safe.",
  /** Rule 9a: the source that failed, by name (data.ts fault()), that nothing moved, and where the money is. "Prices come
   *  through X" names it as the one doing the work, so the voice guard lets NEAR Intents be said (and "are paused" was passive). */
  listFault: (who: string, fault: "down" | "busy" | "slow") => `Prices come through ${who}, and it ${fault === "busy" ? "is busy" : fault === "slow" ? "is slow" : "isn't answering"}. Nothing moved. Your money is in your Safe.`,
  /** The sources by the names a person knows: core's SERVICE_NAMES says "1Click" and "ZeroFee's relay" (the voice guard bans
   *  both on a screen), and CoinGecko isn't a core service; GeckoTerminal's is core's. */
  faultNames: { oneclick: "NEAR Intents", coingecko: "CoinGecko", relay: "ZeroFee's server" } as const,
  retry: "Try again",
  buy: "Buy",
  sell: "Sell",
  sendCoin: "Send this coin",
  notListed: "Your Safe can't trade this coin.",
  noChart: "No chart for this coin yet.",
  loading: "Loading",
  loadingPrice: "Loading the price",
  // the numbers, in Trenches' words
  worth: "Worth",
  liquidity: "Liquidity",
  tradedToday: "Traded 24h",
  whatYouHold: "What you hold",
  youHold: (amount: string, symbol: string) => `You hold ${amount} ${symbol}`,
  /** Under the held row, when Sell can pay only part of the Safe coin's one figure (product decision, 5 Nov: one figure
   *  per Safe coin). the copy review's words. */
  /** builder 22's item 5: its why in one sentence, where the rest sits (`rest`, balance-parts readSafeHeld); none known,
   *  the cap alone. */
  sellPart: (amount: string, symbol: string, rest: readonly ("private" | "staked")[] = []) =>
    [`Up to ${amount} ${symbol} can go in one sell.`, rest.length === 2 ? "The rest is in Private and staked." : rest[0] === "private" ? "The rest is in Private." : rest[0] === "staked" ? "The rest is staked." : ""].filter(Boolean).join(" "),
  inYourSafe: "In your Safe",
  since: (move: string) => `${move} since you bought`,
  // the page's "Your Safe" rows: where the money comes from and goes, who swaps it, what ZeroFee takes, the time
  yourSafe: "Your Safe",
  yourSafeLower: "your Safe",
  paysFrom: "Pays from",
  safeCash: "USDC in your Safe",
  landsIn: "Lands in",
  fills: "Swapped by",
  filler: "NEAR Intents",
  zeroFee: "ZeroFee takes",
  nothing: "Nothing",
  takes: "Takes about",
  /** Every Buy and Sell from the Safe goes through NEAR Confidential (product decision, 8 Nov): the page's row says so. */
  goesThrough: "Goes through",
  confidential: "NEAR Confidential",
  secs: (eta: number) => `${eta} s`,
  about_: "About this coin",
  network: "Network",
  pools: "Where it trades",
  liquidityOf: (dollars: string) => `${dollars} liquidity`,
  source: "Prices and charts from CoinGecko and GeckoTerminal.",
  /** C9 (audit 12): the chart's source that didn't answer, by name; the Try again link follows. */
  didntAnswer: (who: string) => `${who} didn't answer.`,
  /** Where the page's figures come from: the price is NEAR Intents' when the ledger has one (one-price.ts, C3); the
   *  charts and the figures under them, the market's, only where the build has its price server. */
  sourceOf: (intentsPrice: boolean, market: boolean) => intentsPrice ? (market ? "NEAR Intents prices it. CoinGecko and GeckoTerminal draw the chart." : "NEAR Intents prices it.") : market ? "Prices and charts from CoinGecko and GeckoTerminal." : "NEAR Intents prices it.",
  notice: (eta?: number) => `Buys and sells happen inside your Safe${eta ? ` · about ${eta} s today` : ""}`,
  // the sheet
  about: (amount: string, symbol: string) => `About ${amount} ${symbol}`,
  aboutCash: (dollars: string) => `About ${dollars}`,
  /** S16-7 (audit 16): a Sell says once how much of the coin leaves, beside what comes back ("79.5101 NEAR for about $351.88"). */
  aboutSell: (amount: string, symbol: string, dollars: string) => `${amount} ${symbol} for about ${dollars}`,
  /** `time`: the job's whole time from its legs (swap.ts legsTime: "40 s", "2 min"). */
  atLeast: (what: string, time?: string) => `At least ${what}${time ? ` · about ${time}` : ""}`,
  /** Offline on the sheet (Swap's SWAP_OFFLINE, Send's SEND_OFFLINE): once, on top. */
  offline: (verb: string) => `You're offline. Your money is safe. ${verb} works again when you're back. It checks again by itself.`,
  paysWith: "Pays with USDC in your Safe",
  paysInto: "The dollars go to your Safe as USDC",
  stays: (eta?: number) => `Stays in your Safe${eta ? ` · about ${eta} s` : ""}`,
  all: "All",
  amount: "Amount",
  // the receipt
  soldInto: (dollars: string) => `${dollars} · in your Safe`,
  done: "Done",
  tryAgain: "Try again",
  close: "Close",
  /** A coin the Safe can't sell yet (band-coins.ts safeCanSell): no Buy, this line on its page instead. */
  soonLine: "Your rules would make selling this wait a day. So you can't buy it from your Safe yet.",
  /** The job's receipt (builder 15, 8 Nov): what happens while it goes, and what came in once read (no figure: unread). */
  buying: (symbol: string) => `Buying ${symbol}.`,
  selling: (symbol: string) => `Selling ${symbol}.`,
  // builder 24, item 2: what happened, once; the last step ("It's in your Safe.") says where, so this line never does
  boughtIn: (got: string | null, symbol: string) => `Bought ${got ?? symbol}.`,
  // audit 17's H4: the done screen's big figure is the landed one, so this line names no second figure
  soldIn: (symbol: string) => `Sold ${symbol}.`,
  /** Over the Safe's Face ID limit: said before the tap, never a day-long wait. */
  overFaceId: (most: string) => `Face ID alone can swap up to ${most} at a time. Pick less.`,
  noFaceId: "Your rules make every move from your Safe wait. So you can't swap from it.",
} as const;

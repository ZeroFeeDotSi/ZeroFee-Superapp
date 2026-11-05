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
  sellPart: (amount: string, symbol: string) => `Up to ${amount} ${symbol} can go in one sell.`,
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
  secs: (eta: number) => `${eta} s`,
  about_: "About this coin",
  network: "Network",
  pools: "Where it trades",
  liquidityOf: (dollars: string) => `${dollars} liquidity`,
  source: "Prices and charts from CoinGecko and GeckoTerminal.",
  notice: (eta?: number) => `Buys and sells happen inside your Safe${eta ? ` · about ${eta} s today` : ""}`,
  // the sheet
  about: (amount: string, symbol: string, fee: string) => `About ${amount} ${symbol} · ${fee} fee`,
  aboutCash: (dollars: string, fee: string) => `About ${dollars} · ${fee} fee`,
  atLeast: (what: string, eta?: number) => `At least ${what}${eta ? ` · about ${eta} s` : ""}`,
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
  /** QA's condition 3: who can see a swap in the Safe (it is the one public move). */
  who: "Anyone can see your Safe's coins change on NEAR. This swap doesn't link your Safe to Private or your wallets.",
  /** Over the Safe's Face ID limit: said before the tap, never a day-long wait. */
  overFaceId: (most: string) => `Face ID alone can swap up to ${most} at a time. Pick less.`,
  noFaceId: "Your rules make every move from your Safe wait. So you can't swap from it.",
} as const;

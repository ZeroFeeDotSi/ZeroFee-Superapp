// A site's own wallet's coins (product decision, 3 Nov: pump.fun and GMGN are apps of their own, each opening on its wallet page):
// the network's own coin and every coin the wallet holds, each named from the chain and priced, so the page lists BONK
// and the pump.fun coins, not SOL alone. Read the way Trade reads its trading wallets: on Solana every token account the
// wallet owns (SPL Token and Token-2022), on an EVM chain the coins ZeroFee lists there and every coin the wallet's own
// transactions brought in (their receipts' Transfer logs, kept by the core). Display only: one node, the other if it
// fails; nothing here decides anything about money. Prices: GeckoTerminal through ZeroFee's relay (Solana, BNB Chain,
// Robinhood Chain); a chain or coin it has no price for shows its amount without dollars.

/** One coin of a wallet, as the page lists it. `token`: "native", a Solana mint or an EVM coin's contract. `amount`: in
 *  its smallest units. `usd`: its dollars at today's price, null when there is no price (never a made-up $0). */
export interface WalletCoinRow { token: string; symbol: string; name?: string; decimals: number; amount: string; usd: number | null }

/** At most this many coins are named and priced per wallet (the largest first by amount read; the rest wait). */
export const COINS_MAX = 40;
/** ERC-20's Transfer(address,address,uint256): topic0 of its logs. */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** The coins a transaction brought into `wallet`, from its receipt's logs: an ERC-20 Transfer (three topics: an NFT's has
 *  four) whose `to` is the wallet; each coin's contract, lower case, once. */
export function coinsIn(receipt: unknown, wallet: string): string[] {
  const logs = (receipt as { logs?: unknown } | null)?.logs;
  if (!Array.isArray(logs)) return [];
  const me = `0x${wallet.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  const out = new Set<string>();
  for (const l of logs) {
    const t = (l as { topics?: unknown })?.topics, a = (l as { address?: unknown })?.address;
    if (!Array.isArray(t) || t.length !== 3 || String(t[0]).toLowerCase() !== TRANSFER_TOPIC) continue;
    if (String(t[2]).toLowerCase() !== me || typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a)) continue;
    out.add(a.toLowerCase());
  }
  return [...out];
}

/** An ABI answer read as text: a dynamic `string`, or a `bytes32` padded with NULs (older coins); plain letters only. */
export function abiText(hex: unknown, max = 40): string | null {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]*$/.test(hex) || hex.length < 66) return null;
  const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
  const body = hex.slice(2);
  let raw: Uint8Array;
  const offset = Number.parseInt(body.slice(0, 64), 16);
  if (body.length >= 128 && offset === 32) {
    const n = Number.parseInt(body.slice(64, 128), 16);
    if (!(n >= 0 && n <= 256) || body.length < 128 + n * 2) return null;
    raw = bytes(body.slice(128, 128 + n * 2));
  } else {
    raw = bytes(body.slice(0, 64));
  }
  const text = new TextDecoder().decode(raw).replace(/\u0000+$/u, "").trim();
  return text && text.length <= max && /^[\p{L}\p{N} $._&'()+-]+$/u.test(text) ? text : null;
}

/** A coin's symbol fit for a list: 1 to 12 plain letters, digits or a few marks. */
export const plainSymbol = (s: unknown): string | null => (typeof s === "string" && /^[A-Za-z0-9][A-Za-z0-9$._-]{0,11}$/.test(s) ? s : null);

/** Its dollars: the amount in its smallest units at `price` a whole coin; null without a price. */
export function coinUsd(amount: bigint, decimals: number, price: number | null | undefined): number | null {
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) return null;
  const whole = Number(amount / 10n ** BigInt(Math.max(0, decimals - 9))) / 10 ** Math.min(decimals, 9);
  return Math.round(whole * price * 100) / 100;
}

/** What the reader needs: each read from one node or the other (display only). */
export interface CoinsDeps {
  /** Solana: the wallet's SOL, its token accounts, and its coins' decimals and names (mints and metadata). */
  sol: {
    balance?(address: string): Promise<bigint>;
    tokenAccounts?(owner: string): Promise<{ mint: string; amount: bigint }[]>;
    coinsMeta?(mints: string[]): Promise<Map<string, { decimals: number; symbol?: string; name?: string }>>;
  };
  /** An EVM chain: one read (eth_getBalance, eth_call), one node or the other. */
  evm: { read(chain: string, method: string, params: unknown[]): Promise<unknown> };
  /** The network's own coin in dollars (null: no price). */
  nativeUsd(chain: string): Promise<number | null>;
  /** Coins' prices on Solana, BNB Chain or Robinhood Chain (the relay's GeckoTerminal), by mint or contract. */
  prices?(chain: "sol" | "bsc" | "hood", coins: string[]): Promise<Map<string, number>>;
  /** The coins ZeroFee lists on an EVM chain (KNOWN_COINS), and the ones the wallet's own transactions brought in. */
  listed(chain: string): readonly { token: string; symbol: string; decimals: number }[];
  noted(walletId: string): Promise<string[]>;
}

const NATIVE_SYMBOL: Record<string, string> = { sol: "SOL", bsc: "BNB", hood: "ETH", eth: "ETH", base: "ETH", arb: "ETH", gnosis: "xDAI" };
const PRICED = new Set(["sol", "bsc", "hood"]);

/** Every coin the wallet holds, its own first, then by dollars (no price last). Throws when the chain can't be read. */
export async function walletCoins(d: CoinsDeps, w: { id: string; chain: string; address: string }): Promise<WalletCoinRow[]> {
  const rows = w.chain === "sol" ? await solCoins(d, w.address) : await evmCoins(d, w);
  const [own, ...coins] = rows;
  coins.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || a.symbol.localeCompare(b.symbol));
  return [own!, ...coins];
}

async function solCoins(d: CoinsDeps, address: string): Promise<WalletCoinRow[]> {
  if (!d.sol.balance) throw new Error("no reader");
  const [lamports, accounts, solUsd] = await Promise.all([d.sol.balance(address), d.sol.tokenAccounts ? d.sol.tokenAccounts(address) : Promise.resolve([]), d.nativeUsd("sol").catch(() => null)]);
  const own: WalletCoinRow = { token: "native", symbol: "SOL", decimals: 9, amount: lamports.toString(), usd: coinUsd(lamports, 9, solUsd) };
  // each mint once (a wallet may hold it in more than one account), only what it holds now
  const held = new Map<string, bigint>();
  for (const a of accounts) held.set(a.mint, (held.get(a.mint) ?? 0n) + a.amount);
  const mints = [...held].filter(([, n]) => n > 0n).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).slice(0, COINS_MAX).map(([m]) => m);
  if (!mints.length) return [own];
  const [meta, prices] = await Promise.all([d.sol.coinsMeta ? d.sol.coinsMeta(mints).catch(() => new Map()) : Promise.resolve(new Map()), d.prices ? d.prices("sol", mints).catch(() => new Map<string, number>()) : Promise.resolve(new Map<string, number>())]);
  const coins = mints.flatMap((mint): WalletCoinRow[] => {
    const m = meta.get(mint);
    // a coin whose mint can't be read (its decimals unknown) can't be counted: left out, never shown as a wrong amount
    if (!m) return [];
    const amount = held.get(mint)!;
    return [{ token: mint, symbol: plainSymbol(m.symbol) ?? "", ...(m.name ? { name: m.name } : {}), decimals: m.decimals, amount: amount.toString(), usd: coinUsd(amount, m.decimals, prices.get(mint)) }];
  });
  return [own, ...coins];
}

const word = (raw: unknown): bigint => (typeof raw === "string" && /^0x[0-9a-fA-F]{0,64}$/.test(raw) ? (raw === "0x" ? 0n : BigInt(raw)) : 0n);
const callData = (sel: string, addr?: string) => `0x${sel}${addr ? addr.toLowerCase().replace(/^0x/, "").padStart(64, "0") : ""}`;

async function evmCoins(d: CoinsDeps, w: { id: string; chain: string; address: string }): Promise<WalletCoinRow[]> {
  const chain = w.chain;
  const read = (to: string, data: string) => d.evm.read(chain, "eth_call", [{ to, data }, "latest"]);
  const [balance, nativeUsd, noted] = await Promise.all([d.evm.read(chain, "eth_getBalance", [w.address, "latest"]), d.nativeUsd(chain).catch(() => null), d.noted(w.id).catch(() => [] as string[])]);
  const own: WalletCoinRow = { token: "native", symbol: NATIVE_SYMBOL[chain] ?? "", decimals: 18, amount: word(balance).toString(), usd: coinUsd(word(balance), 18, nativeUsd) };
  const listed = d.listed(chain);
  const known = new Map(listed.map((c) => [c.token.toLowerCase(), c]));
  const tokens = [...new Set([...listed.map((c) => c.token.toLowerCase()), ...noted.map((t) => t.toLowerCase())])].slice(0, COINS_MAX);
  // each coin's balance (one read each, side by side); a coin that can't be read is left out
  const held = (await Promise.all(tokens.map(async (t) => [t, await read(t, callData("70a08231", w.address)).then(word, () => null)] as const))).filter((x): x is readonly [string, bigint] => typeof x[1] === "bigint" && x[1] > 0n);
  if (!held.length) return [own];
  const prices = PRICED.has(chain) && d.prices ? await d.prices(chain as "bsc" | "hood", held.map(([t]) => t)).catch(() => new Map<string, number>()) : new Map<string, number>();
  const coins = await Promise.all(held.map(async ([t, amount]): Promise<WalletCoinRow | null> => {
    const k = known.get(t);
    const [symbol, name, decimals] = k ? [k.symbol, null, k.decimals] : await Promise.all([read(t, callData("95d89b41")).then((h) => abiText(h, 12), () => null), read(t, callData("06fdde03")).then((h) => abiText(h), () => null), read(t, callData("313ce567")).then((h) => Number(word(h)), () => NaN)]);
    if (!(Number.isInteger(decimals) && decimals >= 0 && decimals <= 36)) return null;
    return { token: t, symbol: plainSymbol(symbol) ?? "", ...(name ? { name } : {}), decimals, amount: amount.toString(), usd: coinUsd(amount, decimals, prices.get(t)) };
  }));
  return [own, ...coins.filter((c): c is WalletCoinRow => c !== null)];
}

// Every coin and network the ledger knows, joined from 1Click's coin list (symbols, decimals, prices) and the deposit
// bridge's table (which network each coin arrives on, minimums, withdraw fees).
//
// How a coin leaves the ledger decides what the app may offer (Security's rules, 25 Oct):
//   near  a coin native to NEAR (wrap.near, native USDC, USDT …): sent to a NEAR account with a plain ft_withdraw
//   poa   a bridged *.omft.near coin: sent home with ft_withdraw to the token itself, memo "WITHDRAW_TO:<address>"
//   hot   a HOT-bridge coin (nep245:v2_1.omni.hot.tg:…): not sent out in V1 (two steps, or no refund)
//   omni  an Omni-bridge coin (*.omdep.near, *.factory.bridge.near): not sent out in V1 (no refund)
//   other any other kind of token id: not sent out
// Every one of them can be received and converted.
import { nep141Contract } from "@zerofee/core/intents";
import { fromUnits } from "./amount.ts";
import type { BridgeToken, OneClickToken } from "./apis.ts";
import type { Chain, Token } from "./types.ts";

export type Route = "near" | "poa" | "hot" | "omni" | "other";

export interface Coin extends Token {
  route: Route;
  bridged: boolean;
  /** The bridge's row for this coin on its home network, if it can arrive there. Amounts in the smallest unit. */
  bridge?: { chain: string; minDeposit: bigint; minWithdraw: bigint; withdrawFee: bigint };
}

export interface Network extends Chain {
  /** The bridge's id for this network ("sol:mainnet", "eth:4663"); none for NEAR, where coins go to the account itself. */
  bridgeChain?: string;
  /** The network's own coin, as a ledger token id ("near" for NEAR itself). */
  nativeTokenId: string;
}

/** The token id ZeroFee uses for NEAR held on the account itself (not wrapped, not in the ledger). */
export const NATIVE_NEAR = "near";
export const WRAPPED_NEAR = "nep141:wrap.near";
export const NEAR_DECIMALS = 24;

/** 1Click's network id → the deposit bridge's id for it. A network missing here can't be received from. */
const BRIDGE_CHAIN: Record<string, string> = {
  eth: "eth:1", base: "eth:8453", arb: "eth:42161", op: "eth:10", pol: "eth:137", bsc: "eth:56", gnosis: "eth:100",
  avax: "eth:43114", bera: "eth:80094", monad: "eth:143", xlayer: "eth:196", plasma: "eth:9745", scroll: "eth:534352",
  hood: "eth:4663", sol: "sol:mainnet", btc: "btc:mainnet", zec: "zec:mainnet", doge: "doge:mainnet", ltc: "ltc:mainnet",
  bch: "bch:mainnet", dash: "dash:mainnet", xrp: "xrp:mainnet", tron: "tron:mainnet", ton: "ton:mainnet",
  stellar: "stellar:mainnet", cardano: "cardano:mainnet", aptos: "aptos:mainnet", sui: "sui:mainnet", aleo: "aleo:mainnet",
  movement: "movement:mainnet", fogo: "fogo:mainnet", starknet: "starknet:mainnet", hypercore: "hypercore:mainnet",
};

/** Names people know. A network without one stays off screen until it has one (no codes on screen). */
const CHAIN_NAMES: Record<string, string> = {
  near: "NEAR", eth: "Ethereum", base: "Base", arb: "Arbitrum", op: "Optimism", pol: "Polygon", bsc: "BNB Chain",
  gnosis: "Gnosis", avax: "Avalanche", bera: "Berachain", monad: "Monad", xlayer: "X Layer", plasma: "Plasma",
  scroll: "Scroll", hood: "Robinhood Chain", sol: "Solana", btc: "Bitcoin", zec: "Zcash", doge: "Dogecoin", ltc: "Litecoin",
  bch: "Bitcoin Cash", dash: "Dash", xrp: "XRP Ledger", tron: "TRON", ton: "TON", stellar: "Stellar", cardano: "Cardano",
  aptos: "Aptos", sui: "Sui", aleo: "Aleo", movement: "Movement", fogo: "Fogo", starknet: "Starknet", hypercore: "Hyperliquid",
  abs: "Abstract",
};

/** The "Send from" picker's first rows; the rest follow by name. */
const FIRST = ["near", "eth", "base", "sol", "btc", "arb", "bsc", "tron", "hood"];

const COIN_NAMES: Record<string, string> = {
  NEAR: "NEAR", wNEAR: "NEAR", USDC: "USD Coin", USDT: "Tether", ETH: "Ether", WETH: "Wrapped Ether", BTC: "Bitcoin",
  WBTC: "Wrapped Bitcoin", SOL: "Solana", BNB: "BNB", TRX: "TRON", XRP: "XRP", DOGE: "Dogecoin", ZEC: "Zcash",
  LTC: "Litecoin", BCH: "Bitcoin Cash", ADA: "Cardano", APT: "Aptos", SUI: "Sui", XLM: "Stellar", AVAX: "Avalanche",
  POL: "Polygon", DAI: "Dai", xDAI: "xDAI", USDG: "Global Dollar", USDe: "Ethena USDe",
};

export function routeOf(tokenId: string): Route {
  if (tokenId.startsWith("nep245:v2_1.omni.hot.tg:")) return "hot";
  const contract = nep141Contract(tokenId);
  if (!contract) return "other";
  if (contract.endsWith(".omft.near")) return "poa";
  if (contract.endsWith(".omdep.near") || contract.endsWith(".bridge.near")) return "omni";
  return "near";
}

/** wrap.near is NEAR to a person: one coin, one name. */
const shownSymbol = (assetId: string, symbol: string) => (assetId === WRAPPED_NEAR ? "NEAR" : symbol);

export class Catalogue {
  readonly coins = new Map<string, Coin>();
  readonly networks: Network[] = [];
  /** The prices were read from 1Click just now; false when they are the ones kept on the device or shipped with the app
   *  (B28 R3): shown, never used to let money move (a cap is checked at a price read now). */
  pricesLive = true;
  /** Coins priced just now even when the list is a kept one (NEAR, at the core's own snapshot: withPrice). */
  livePrices: ReadonlySet<string> = new Set();

  /** Security review H1: whether this coin's price was read just now. A kept price is shown, never used to size money. */
  priceLive(tokenId: string): boolean {
    return this.pricesLive || this.livePrices.has(tokenId);
  }

  constructor(tokens: OneClickToken[], bridgeRows: BridgeToken[]) {
    const rows = new Map<string, BridgeToken>();
    for (const r of bridgeRows) if (typeof r?.intents_token_id === "string" && typeof r.defuse_asset_identifier === "string") rows.set(`${r.intents_token_id} ${r.defuse_asset_identifier.split(":").slice(0, 2).join(":")}`, r);

    for (const t of tokens) {
      // Every row is checked before any of it is used (audit W-5): a bad one is dropped, so a bad decimals never reaches
      // amount math and a wrong type never reaches the screen.
      if (!goodToken(t)) continue;
      const route = routeOf(t.assetId);
      const home = t.blockchain === "near" ? "near:mainnet" : BRIDGE_CHAIN[t.blockchain];
      const row = home ? rows.get(`${t.assetId} ${home}`) : undefined;
      const symbol = shownSymbol(t.assetId, t.symbol);
      this.coins.set(t.assetId, {
        assetId: t.assetId,
        chain: t.blockchain,
        symbol,
        decimals: t.decimals,
        contract: t.contractAddress ?? null,
        priceUsd: priceText(t.price),
        name: COIN_NAMES[symbol] ?? symbol,
        icon: symbol.toLowerCase(),
        route,
        bridged: !(t.blockchain === "near" && route === "near"),
        bridge: row && home !== "near:mainnet" && goodBridgeRow(row)
          ? { chain: home!, minDeposit: BigInt(row.min_deposit_amount), minWithdraw: BigInt(row.min_withdrawal_amount), withdrawFee: BigInt(row.withdrawal_fee) }
          : undefined,
      });
    }

    const ids = new Set([...this.coins.values()].map((c) => c.chain));
    for (const id of ids) {
      const name = CHAIN_NAMES[id];
      if (!name) continue;
      if (id === "near") {
        const coins = [NATIVE_NEAR, ...[...this.coins.values()].filter((c) => c.chain === "near" && c.route === "near").map((c) => c.assetId)];
        this.networks.push({ id, name, icon: id, nativeSymbol: "NEAR", nativeTokenId: NATIVE_NEAR, coins });
        continue;
      }
      // Receivable only if the bridge takes the network's own coin there.
      const natives = [...this.coins.values()].filter((c) => c.chain === id && c.contract === null && c.bridge && !/deprecated/i.test(c.symbol));
      const native = natives[0];
      if (!native?.bridge) continue;
      this.networks.push({
        id,
        name,
        icon: id,
        nativeSymbol: native.symbol,
        minDeposit: fromUnits(native.bridge.minDeposit, native.decimals),
        bridgeChain: native.bridge.chain,
        nativeTokenId: native.assetId,
        coins: [...this.coins.values()].filter((c) => c.chain === id && c.bridge).map((c) => c.assetId),
      });
    }
    const rank = (id: string) => (FIRST.includes(id) ? FIRST.indexOf(id) : FIRST.length);
    this.networks.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  }

  coin(tokenId: string): Coin | undefined {
    return this.coins.get(tokenId);
  }

  /** The same list with one coin at another price (grade 02h, H1: NEAR at the core's one snapshot, so Wallet, Send's
   *  review and the approval sheet say the same dollars). This list is left as it is; no price, no change. */
  withPrice(tokenId: string, usd: number | null | undefined): Catalogue {
    const coin = this.coins.get(tokenId);
    const priceUsd = priceText(usd);
    if (!coin || priceUsd === undefined || priceUsd === coin.priceUsd) return this;
    const copy: Catalogue = Object.create(Catalogue.prototype);
    Object.assign(copy, this, { coins: new Map(this.coins).set(tokenId, { ...coin, priceUsd }), livePrices: new Set([...this.livePrices, tokenId]) });
    return copy;
  }

  network(id: string): Network | undefined {
    return this.networks.find((n) => n.id === id);
  }

  /** The list as ledger.tokens gives it: 1Click's coins, with names and logo keys. */
  tokens(): Token[] {
    return [...this.coins.values()].map(({ assetId, chain, symbol, decimals, contract, priceUsd, name, icon }) => ({ assetId, chain, symbol, decimals, contract, priceUsd, name, icon }));
  }

  /**
   * Where a brand-new account's first NEAR can come from (M7): every network with a name people know, Add money's
   * order, each with every coin 1Click quotes there. NEAR's own wNEAR is what's being bought, so it isn't offered.
   */
  startNetworks(): { id: string; name: string; icon: string; coins: Token[] }[] {
    const rank = (id: string) => (FIRST.includes(id) ? FIRST.indexOf(id) : FIRST.length);
    const ids = [...new Set([...this.coins.values()].map((c) => c.chain))].filter((id) => CHAIN_NAMES[id]);
    return ids
      .sort((a, b) => rank(a) - rank(b) || CHAIN_NAMES[a].localeCompare(CHAIN_NAMES[b]))
      .map((id) => ({ id, name: CHAIN_NAMES[id], icon: id, coins: this.tokens().filter((t) => t.chain === id && t.assetId !== WRAPPED_NEAR) }))
      .filter((n) => n.coins.length > 0);
  }

  /** The list as ledger.chains gives it. */
  chains(): Chain[] {
    return this.networks.map(({ id, name, icon, nativeSymbol, minDeposit, coins }) => ({ id, name, icon, nativeSymbol, ...(minDeposit === undefined ? {} : { minDeposit }), coins }));
  }
}

/**
 * The most decimals a coin may have (audit W-5). The ledger's coins use 6 to 24 (NEAR's own coins use 24; 1Click's list,
 * 25 Oct: 6, 7, 8, 9, 12, 18, 24); more than 30 is a broken row, never a coin.
 */
export const MAX_COIN_DECIMALS = 30;
/** A symbol: 1 to 40 characters, none of them a control or invisible formatting character ("BTC(OMNI)" is fine). */
const SYMBOL = /^[^\p{C}]{1,40}$/u;

/** A /tokens row whose every field the catalogue uses has the right type and a sane value. */
function goodToken(t: unknown): t is OneClickToken {
  if (!t || typeof t !== "object") return false;
  const r = t as Record<string, unknown>;
  return typeof r.assetId === "string" && r.assetId.length > 0 && r.assetId.length <= 200
    && typeof r.blockchain === "string" && r.blockchain.length > 0
    && typeof r.symbol === "string" && SYMBOL.test(r.symbol)
    && Number.isInteger(r.decimals) && (r.decimals as number) >= 0 && (r.decimals as number) <= MAX_COIN_DECIMALS
    && (r.contractAddress === undefined || r.contractAddress === null || typeof r.contractAddress === "string");
}

/** The bridge's minimums and fee are whole numbers of the coin's smallest unit, at most a u128 (39 digits). */
const AMOUNT = /^(0|[1-9]\d{0,38})$/;
const goodBridgeRow = (r: BridgeToken) => [r.min_deposit_amount, r.min_withdrawal_amount, r.withdrawal_fee].every((v) => typeof v === "string" && AMOUNT.test(v));

/** A price as a plain decimal ("0.0000001", never "1e-7"), or nothing when it isn't a positive number. */
export function priceText(n: unknown): string | undefined {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return undefined;
  const s = n.toFixed(12).replace(/\.?0+$/, "");
  return /^\d+(\.\d+)?$/.test(s) && /[1-9]/.test(s) ? s : undefined;
}

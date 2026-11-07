// Sample data only: a ChainEngine with no chain behind it, for the shell's sample trading wallets (?demo and the screens
// preview, which carry the shell's "Sample data" marker). Quotes come from the live market price; nothing is signed or
// sent; a trade "confirms" about 0.4 s after it is sent. The real engines are sol/chain.ts and evm/.
import { TradeError } from "./errors.ts";
import { isSampleTrap } from "./market/demo-traps.ts";
import { usdToRaw } from "./slippage.ts";
import type { Amount, ChainEngine, ChainId, CoinMeta, Fill, Prepared, Side, TxStatus } from "./types.ts";

/** A sample transaction's hash: the shell's sample bytes carry their own number. */
const sampleHash = (signedTx: string): string => `sample-${atob(signedTx).split("-").pop()}`;
/** The MockBridge's made-up addresses (SAMPLE_SOL, SAMPLE_EVM: each fails its chain's own check): never a real wallet.
 *  MockBridge's SAMPLE_EVM, exactly, case and all: its lowercase form is a valid unchecksummed address a real wallet could
 *  have, so the match is never case-blind (security review ask, 3 Nov). */
export const SAMPLE_EVM_ADDRESS = "0xAb5e688E42cE07Fc83e0AD8ca0486b96a5D53e39";
export const isSampleAddress = (a: string): boolean => a === "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM" || a === SAMPLE_EVM_ADDRESS;

// NEAR coins are bought with Spending's own dollars (USDC on NEAR, 6 places): the sample's are $25
const NATIVE: Record<ChainId, { decimals: number; start: bigint }> = { sol: { decimals: 9, start: 1_420_000_000n }, bsc: { decimals: 18, start: 80_000_000_000_000_000n }, hood: { decimals: 18, start: 12_000_000_000_000_000n }, near: { decimals: 6, start: 25_000_000n } };
/** Each chain's sample wallet's opening money (smallest units). ?demo hands it to the shell's MockBridge (its float's
 *  `opening`), so the core's own balances say it too, and the engines read it through `moved` (`seeded`). */
export const SAMPLE_OPENING: Record<"sol" | "bsc" | "hood", string> = { sol: NATIVE.sol.start.toString(), bsc: NATIVE.bsc.start.toString(), hood: NATIVE.hood.start.toString() };

/**
 * The Sim's slow chain, for walks only (QA and 83, 7 Nov: the "not confirmed yet" card, its end on landing and
 * its proven expiry could not be reached, as every sample trade confirms in 0.4 s). "late": the tap's wait never hears it
 * (the card shows after GIVE_UP_MS), and the live re-check finds it landed SIM_RESOLVE_MS after its send. "absent": the
 * same, then the re-check proves it never landed (expired). Only in a build made with VITE_SIM_TRADE_MODES=1, where the
 * walk sets localStorage "zf.sim.trade"; in every other build (the phone's, the public site's, the Sim's) SIM_MODES is
 * false, so the switch is never read (demo-modes.test.ts), and the reader and its key are not in the bundle at all: the
 * flag is read as Vite's own literal and the reader is chosen at module level (the audit's MUST, 7 Nov; CRAWL.md's grep of a
 * normal build finds neither the key nor the flag's name).
 */
export type SimTradeMode = "late" | "absent";
// Vite puts a literal here at build time; under node (tests) there is no env, so it is off
export const SIM_MODES: boolean = import.meta.env?.VITE_SIM_TRADE_MODES === "1";
/** From the send: past the tap's wait (GIVE_UP_MS, 75 s), so the card shows first and a live round or two find it pending. */
export const SIM_RESOLVE_MS = 100_000;
/** The walk's switch, read on every look (so a walk can turn it on or off in one page). Exported for its test only. */
export function readSimTradeMode(): SimTradeMode | undefined {
  try {
    const v = (globalThis as { localStorage?: Storage }).localStorage?.getItem("zf.sim.trade");
    return v === "late" || v === "absent" ? v : undefined;
  } catch { return undefined; }
}
/** The switch as the engine reads it: the reader in a SIM_MODES build, nothing in every other (chosen here, at module
 *  level, so a normal build drops the reader and its key). */
export const simTradeMode: () => SimTradeMode | undefined = SIM_MODES ? readSimTradeMode : () => undefined;

/** Each sample wallet's money, for as long as the page lives (as MockBridge keeps its own): every engine made for the same
 *  wallet reads and moves the same balances, so a Trade screen opened again, or the shell's reader, never sees a fresh start. */
interface SampleWallet { native: bigint; held: Map<string, bigint>; sent: Map<string, { p: Prepared; at: number; filled?: boolean }>; n: number; out?: Map<string, bigint> }
const WALLETS = new Map<string, SampleWallet>();
/** Tests start each case from the sample's opening balances. */
export const resetSampleWallets = (): void => WALLETS.clear();

/** The web demo keeps a session across a reload (grade 30 Oct, item 7): each sample wallet's coins are saved after every
 *  trade and read back here, so Trade's kept records and the coins a wallet holds still agree. Nothing on its way is kept
 *  (a sample trade confirms in under a second). A store that throws or holds garbage just starts from the opening. */
let keepSave: (() => void) | undefined;
export function keepSampleWallets(store: { getItem(key: string): string | null; setItem(key: string, value: string): void }, key: string): void {
  try {
    const raw = store.getItem(key);
    const saved = raw ? (JSON.parse(raw) as Record<string, { native: string; held: [string, string][]; n: number }>) : {};
    for (const [k, v] of Object.entries(saved)) WALLETS.set(k, { native: BigInt(v.native), held: new Map(v.held.map(([c, x]) => [c, BigInt(x)])), sent: new Map(), n: Number(v.n) || 0 });
  } catch {
    WALLETS.clear();
  }
  keepSave = () => {
    try {
      store.setItem(key, JSON.stringify(Object.fromEntries([...WALLETS].map(([k, w]) => [k, { native: w.native.toString(), held: [...w.held].map(([c, x]) => [c, x.toString()]), n: w.n }]))));
    } catch {
      // blocked: kept for this page only
    }
  };
}

/** `moved`: what the shell's float has moved into this sample wallet (MockBridge's subwallet.balances), so ?demo's one
 *  balance adds up: the sample's opening money plus what the float sent, less what was traded. */
/** `empty` (?demo&float=empty): the sample wallets start with nothing, so the one balance's set-up shows and can be walked. */
/** `noGas` (?demo&gas=none): a buy leaves the wallet none of its own coin, so the sale right after it has no fee of its own
 *  (the robot's route for "gas is funded inside the confirm"). */
/** `seeded`: the shell's MockBridge holds the opening money (SAMPLE_OPENING) and `moved` reads it, so this engine starts
 *  from nothing of its own: one ledger, never the opening counted twice. */
export function createDemoEngine(o: { chain: ChainId; owner: string; nativeUsd(): Promise<number>; meta(coin: string): Promise<CoinMeta | undefined>; now?(): number; moved?(): Promise<bigint>; empty?: boolean; noGas?: boolean; seeded?: boolean; mode?(): SimTradeMode | undefined }): ChainEngine {
  const now = o.now ?? Date.now;
  const mode = o.mode ?? (() => simTradeMode());
  const nd = NATIVE[o.chain].decimals;
  const key = `${o.chain}:${o.owner.toLowerCase()}`;
  const w = WALLETS.get(key) ?? WALLETS.set(key, { native: o.empty || o.seeded ? 0n : NATIVE[o.chain].start, held: new Map(), sent: new Map(), n: 0 }).get(key)!;
  const { held, sent } = w;
  // never below nothing: MockBridge's float can take back what it moved in although trades already spent some of it
  const have = async () => { const n = w.native + (await (o.moved?.() ?? Promise.resolve(0n)).catch(() => 0n)); return n > 0n ? n : 0n; };
  const scale = (x: number, d: number) => BigInt(Math.max(0, Math.floor(x * 10 ** Math.min(d, 15)))) * 10n ** BigInt(Math.max(0, d - 15));
  return {
    chain: o.chain, owner: o.owner,
    async prepare(side: Side, coin: string, amount: Amount): Promise<Prepared> {
      // a sample coin no one can sell back is refused at the quote, as the real engines' sell-back test does (the audit's note, 8 Nov:
      // the Sim's row Buy bought NOSELL; on chain the quote refuses it)
      if (side === "buy" && isSampleTrap(o.chain, coin)) throw new TradeError("unsellable", "This coin can't be sold back right now");
      const [meta, px, native] = await Promise.all([o.meta(coin), o.nativeUsd(), have()]);
      if (!meta?.priceUsd || !(px > 0)) throw new TradeError("unavailable", "No price for this coin yet");
      const d = meta.decimals ?? 6;
      const fee = usdToRaw(0.002, px, nd);
      let payRaw: bigint, getRaw: bigint, payUsd: number;
      if (side === "buy") {
        payRaw = "raw" in amount ? BigInt(amount.raw) : "usd" in amount ? usdToRaw(amount.usd, px, nd) : "max" in amount ? native - fee * 3n : 0n;
        if (payRaw <= 0n || payRaw + fee > native) throw new TradeError("funds", "Not enough for this buy and its fee", native === 0n ? "wallet-empty" : "sol-low");
        payUsd = (Number(payRaw) / 10 ** nd) * px;
        getRaw = scale((payUsd / meta.priceUsd) * 0.997, d);
      } else {
        const h = held.get(coin) ?? 0n;
        if (h === 0n) throw new TradeError("funds", "You don't hold any", "coin-low");
        payRaw = "raw" in amount ? BigInt(amount.raw) : "fraction" in amount ? (amount.fraction >= 1 ? h : (h * BigInt(Math.round(amount.fraction * 1e6))) / 1_000_000n) : h;
        if (payRaw <= 0n || payRaw > h) throw new TradeError("funds", "You don't hold that much", "coin-low");
        // a sale pays its network fee in the chain's own coin, before it gets any: none, and it can't go (as on chain)
        if (native < fee) throw new TradeError("funds", "Not enough for the network fee", "sol-low");
        payUsd = (Number(payRaw) / 10 ** d) * meta.priceUsd;
        getRaw = scale((payUsd / px) * 0.997, nd);
      }
      const getMin = (getRaw * 97n) / 100n;
      const checked = new Promise<void>((r) => setTimeout(r, 450));             // the sell-back check, drawn as the asleep pill
      return {
        key: `demo|${side}|${coin}|${payRaw}`, at: now(), ready: () => checked,
        steps: [{ id: "swap", tx: btoa(`sample-${o.chain}-${++w.n}`), lastValidBlockHeight: 1 }],
        quote: { side, chain: o.chain, coin, symbol: meta.symbol ?? "COIN", decimals: d, payRaw: payRaw.toString(), payUsd, getRaw: getRaw.toString(), getUsd: payUsd * 0.997, getMinRaw: getMin.toString(), feeRaw: fee.toString(), feeUsd: 0.002, route: "", slippageBps: 300, priceImpactPct: 0.05, expiresAt: now() + 20_000 },
      };
    },
    txHash: sampleHash,
    // a transfer out leaves the wallet when it is sent (amount and fee), as on chain
    // a sample send is on the sample chain at once: the first look after it finds it confirmed, so a money move feels as
    // quick as a fast chain's (grade 1 Nov, item 11: a buy took 2.8 s); a hash never sent here confirms 0.4 s after the
    // first look (a resumed trade)
    async send(signedTx) { const gone = w.out?.get(signedTx); if (gone !== undefined) { w.native -= gone; w.out!.delete(signedTx); keepSave?.(); } const h = sampleHash(signedTx); if (!sent.has(h)) sent.set(h, { p: undefined as never, at: now() - 400 }); return h; },
    async status(hash): Promise<TxStatus> {
      const s = [...sent.entries()].find(([h]) => h === hash)?.[1];
      if (!s) { sent.set(hash, { p: undefined as never, at: now() }); return "pending"; }
      if (mode()) return "pending";                                           // the Sim's slow chain: the tap's wait hears nothing
      return now() - s.at >= 400 ? "confirmed" : "pending";                    // about a Solana confirmation
    },
    // the live re-check (types.ts): as status(), or the Sim's slow chain's end once SIM_RESOLVE_MS has passed
    async recheck(hash): Promise<TxStatus> {
      const m = mode(), s = sent.get(hash);
      if (!m) return this.status(hash);
      if (!s) return "unknown";
      if (now() - s.at < SIM_RESOLVE_MS) return "pending";
      return m === "late" ? "confirmed" : "expired";
    },
    async fill(p, hash): Promise<Fill> {
      const q = p.quote;
      const fee = BigInt(q.feeRaw);
      if (q.side === "buy") {
        w.native -= BigInt(q.payRaw) + fee; held.set(q.coin, (held.get(q.coin) ?? 0n) + BigInt(q.getRaw));
        if (o.noGas) w.native -= await have();                               // the robot's no-gas route: nothing left for a fee
      }
      else { w.native += BigInt(q.getRaw) - fee; held.set(q.coin, (held.get(q.coin) ?? 0n) - BigInt(q.payRaw)); }
      keepSave?.();
      return { txHash: hash, got: q.getRaw, spent: q.payRaw, fee: fee.toString(), nativeAfter: (await have()).toString(), coinAfter: (held.get(q.coin) ?? 0n).toString() };
    },
    async holdings(coins) {
      return { native: (await have()).toString(), coins: (coins ?? [...held.keys()]).map((c) => ({ coin: c, raw: (held.get(c) ?? 0n).toString(), decimals: 6 })) };
    },
    async transfer(_to, raw) {
      const have_ = await have(), fee = 5_000n, lamports = raw === "all" ? have_ - fee : BigInt(raw);
      if (lamports <= 0n) throw new TradeError("funds", "Nothing to move", "wallet-empty");
      if (lamports + fee > have_) throw new TradeError("funds", "Not enough to move and pay the fee", "sol-low");
      const tx = btoa(`sample-${o.chain}-${++w.n}`);
      (w.out ??= new Map()).set(tx, lamports + fee);
      return { key: "demo|transfer", at: now(), ready: async () => {}, steps: [{ id: "swap", tx, lastValidBlockHeight: 1 }], quote: { side: "sell", chain: o.chain, coin: "w.native", symbol: "", decimals: nd, payRaw: lamports.toString(), payUsd: 0, getRaw: lamports.toString(), getUsd: 0, getMinRaw: lamports.toString(), feeRaw: fee.toString(), feeUsd: 0, route: "Transfer", slippageBps: 0, expiresAt: now() + 60_000 } };
    },
    poolChanged() {},
  };
}

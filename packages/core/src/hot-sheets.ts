// D143 refinement (review, 3 Nov, review H1): the approve sheet (one tap, never Face ID: `tap`) a hot key still shows
// when a request is outside the person's own flow: an unlisted site's own wallet, a check a site's request failed, a
// signature over the one cap, one with no price, or one only one server could test. The words are main's
// sheet words before D143, moved here unchanged in substance; loaded with the first such sheet (subwallets.ts), never in
// Home's first load.
import { checksumAddress, EVM_CHAIN_NAME, NATIVE, evmNative, evmPlain, unlimited, type EvmCall, type EvmSimulated, type EvmWalletChain } from "./evm.ts";
import type { EvmDecoded } from "./evm/decode.ts";
import { evmWords } from "./evm/decode.ts";
import { dollarWords, formatAmount, Unnamed } from "./format.ts";
import type { PlainWords } from "./signer.ts";
import { SOL } from "./solana.ts";
import type { Simulated } from "./solana.ts";
import { solCoinLeaving, solCoinRows, solNamedCoin, solWords, type SolDecoded } from "./sol/decode.ts";

const CHAIN_WORDS: Record<string, string> = { sol: "Solana", bsc: "BNB Chain", hood: "Robinhood Chain", eth: "Ethereum", base: "Base", gnosis: "Gnosis", arb: "Arbitrum" };
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
/** An address a site names (who gets paid or allowed): long enough that a look-alike doesn't pass at a glance. */
const long = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;
const sol = (lamports: bigint) => {
  const frac = (lamports % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${lamports / 1_000_000_000n}${frac ? `.${frac}` : ""} SOL`;
};
/** A coin's details only when its decimals are sane (0 to 30), audit W-8. */
const saneCoin = <C extends { decimals: number }>(c: C | undefined): C | undefined => (c && Number.isInteger(c.decimals) && c.decimals >= 0 && c.decimals <= 30 ? c : undefined);

export interface SheetWallet { label: string; kind: string; address: string; chain: string }
const isChainWallet = (w: SheetWallet) => (w.kind === "trade" || w.kind === "browser") && w.chain !== "near";
/** "From your Solana wallet 7xKX…": one wallet per chain (D55) has one name on every sheet; an older one says so. */
function fromLine(w: SheetWallet, older: boolean): string {
  const name = isChainWallet(w) ? `${older ? "older " : ""}${CHAIN_WORDS[w.chain] ?? w.chain} wallet` : w.kind === "site" ? w.label : w.label.toLowerCase();
  return `From your ${name} ${short(w.address)}`;
}
/** The most that leaves, in dollars at the core's own price ("up to about $30.00 (0.2 SOL), fees included"), or none. */
function leaves(out: bigint, decimals: number, priceUsd: number | null, coin: string): string | undefined {
  if (out <= 0n || !priceUsd || !(priceUsd > 0)) return undefined;
  return `up to ${dollarWords((Number(out) / 10 ** decimals) * priceUsd)} (${coin}), fees included`;
}
/** Why it asks, said first among the warnings: the person sees why this one wasn't silent. */
const whyWarning = (why: string | undefined): PlainWords["warnings"] => (why ? [{ kind: "effect-unknown", text: why }] : []);

/** A Solana transaction's sheet: the decoder's words, the site that asked, the wallet, what leaves and the coins' rows. */
export function solSheet(o: { w: SheetWallet; older: boolean; decoded: SolDecoded; sim: Simulated; out: bigint; unread: boolean; host?: string; asker?: string; why?: string; priceUsd: number | null; coin?: (mint: string) => { symbol: string; decimals: number } | undefined }): PlainWords {
  const { w, decoded, sim, out } = o;
  const unnamed = new Unnamed();
  // a coin ZeroFee lists, else its own symbol as the core read it from the chain (subwallets.ts sheetCoins), never the caller's
  const coin = o.coin ?? solNamedCoin;
  const words = solWords(decoded, coin, unnamed);
  const warnings: PlainWords["warnings"] = whyWarning(o.why);
  if (decoded.unknownPrograms.length) warnings.push({ kind: "unknown-contract", text: "It calls programs ZeroFee doesn't know." });
  if (!sim.ok) warnings.push({ kind: "simulation-disagrees", text: "A test run of it didn't go through. The real one likely won't either." });
  else if (!sim.agreed && sim.servers !== 1) warnings.push({ kind: "simulation-disagrees", text: "Two network servers tested this and got different results. It may not do what it says." });
  if (o.unread) warnings.push({ kind: "effect-unknown", text: "It touches more accounts than the test can read. This list might miss a coin it moves." });
  if (decoded.stakeHandovers.length) warnings.push({ kind: "key-change", text: "It hands control of a stake account to another address. Whoever has it can take the staked SOL." });
  // dollars only when SOL is all that can leave (security review 2 Nov)
  const onlySol = sim.ok && !o.unread && decoded.unknownPrograms.length === 0 && decoded.stakeHandovers.length === 0 && decoded.unreadTokenSteps === 0 && decoded.unreadSteps.length === 0 &&
    decoded.closedTo.every((to) => to === w.address) && !decoded.tokenMoves.some((m) => m.kind === "approve" || m.kind === "authority") &&
    !(sim.tokens ?? []).some((t) => t.mint !== SOL.wsol && t.after < t.before);
  const amount = onlySol ? leaves(out, 9, o.priceUsd, sol(out)) : undefined;
  const changed = (sim.tokens ?? []).filter((t) => t.before !== t.after && t.mint !== SOL.wsol);
  const coinRows = solCoinRows(changed, unnamed, coin);
  for (const text of solCoinLeaving(changed, unnamed)) warnings.push({ kind: "effect-unknown", text });
  return unnamed.withDetails({
    title: words.title,
    ...(amount ? { amount } : {}),
    lines: [...words.lines, ...(o.host ? [`Asked by ${o.host}`] : []), fromLine(w, o.older), ...(out > 0n ? [`Up to ${sol(out)} leaves the wallet, fees included.`] : []), ...(sim.ok && sim.servers === 1 ? ["Checked by one server."] : [])],
    warnings,
    effect: [{ token: "SOL", before: sol(sim.lamportsBefore), after: sol(sim.lamportsAfter) }, ...coinRows],
    ...(o.asker ? { asker: o.asker } : {}),
    // D143: a hot key's sheet is one tap; Face ID is only for money leaving the Safe
    tap: true,
  });
}

/** An EVM transaction's sheet: Trade's decoder's words for a decoded trade on BNB Chain or Robinhood Chain, else the
 *  shapes every chain shares (a send, a coin's transfer, an allowance) and anything else said plainly as unread. */
export async function evmSheet(o: { w: SheetWallet; older: boolean; chain: EvmWalletChain; call: EvmCall; sim: EvmSimulated; out: bigint; host?: string; asker?: string; why?: string; priceUsd: number | null; feeOk: boolean; token: (t: string) => Promise<{ symbol: string; decimals: number } | undefined>; decoded?: { d: EvmDecoded; infos: Map<string, { symbol: string; decimals: number } | undefined> } }): Promise<PlainWords> {
  const { w, chain, call, sim, out } = o;
  const warnings: PlainWords["warnings"] = whyWarning(o.why);
  if (!o.feeOk) warnings.push({ kind: "effect-unknown", text: "Its network fee is higher than ZeroFee pays on this chain." });
  let words: { title: string; lines: string[]; details?: PlainWords["details"] };
  let onlyNative: boolean;
  if (o.decoded && o.decoded.d.swaps.length) {
    const { d, infos } = o.decoded;
    words = evmWords(d, (a) => infos.get(a), { wallet: w.address, nowMs: Date.now() });
    if (d.unknownTarget) warnings.push({ kind: "unknown-contract", text: d.transfer ? "It sends coins out of this wallet." : "It goes to an app ZeroFee doesn't know." });
    onlyNative = sim.ok && !d.approve && !d.permit2 && d.swaps.every((x) => x.side === "buy") && !d.unknownTarget;
  } else {
    const p = evmPlain(call);
    const info = p.kind === "transfer" || p.kind === "approve" ? saneCoin(await o.token(p.token).catch(() => undefined)) : undefined;
    const unnamed = new Unnamed();
    const yours = (token: string) => (info ? `your ${info.symbol}` : unnamed.the(token));
    const amount = (n: bigint, token: string) => (info ? `${formatAmount(n, info.decimals)} ${info.symbol}` : unnamed.amount(n, token));
    const lines: string[] = [];
    let title: string;
    // the payee in full, EIP-55 (security review 2 Nov, Medium: a look-alike differs in the middle)
    if (p.kind === "send") {
      title = `Send ${evmNative(p.value, chain)}`;
      lines.push(`To ${checksumAddress(p.to)}`);
    } else if (p.kind === "transfer") {
      title = `Send ${amount(p.amount, p.token)}`;
      lines.push(`To ${checksumAddress(p.recipient)}`);
    } else if (p.kind === "approve") {
      const all = unlimited(p.amount.toString());
      title = p.amount === 0n ? `Stop ${long(p.spender)} spending ${yours(p.token)}` : `Allow ${long(p.spender)} to spend ${all ? `ALL of ${yours(p.token)}, with no limit` : `up to ${amount(p.amount, p.token)}`}`;
      if (all) warnings.push({ kind: "effect-unknown", text: "It lets that address take all of this coin from this wallet, now or later." });
    } else if (p.kind === "approveAll") {
      title = `Let ${long(p.operator)} take every item in the collection at ${long(p.collection)}`;
      warnings.push({ kind: "effect-unknown", text: "That address can take every item in this collection, now or later." });
    } else {
      title = `A request to an app on ${EVM_CHAIN_NAME[chain]}`;
      lines.push(`To ${long(p.to)}${p.selector ? `, instruction ${p.selector}` : ""}`);
      warnings.push({ kind: "unknown-contract", text: "ZeroFee can't read what this does. Only approve it if you trust the site that asked." });
    }
    if (p.kind !== "send" && p.value > 0n) lines.push(`It also sends ${evmNative(p.value, chain)}`);
    lines.push(`On ${EVM_CHAIN_NAME[chain]}`);
    words = unnamed.withDetails({ title, lines });
    onlyNative = p.kind === "send" && sim.ok;
  }
  if (!sim.ok) warnings.push({ kind: "simulation-disagrees", text: "A test run of it didn't go through. The real one likely won't either." });
  else if (!sim.agreed) warnings.push({ kind: "simulation-disagrees", text: "Only one network server checked this, or the two don't agree." });
  const amount = onlyNative ? leaves(out, 18, o.priceUsd, evmNative(out, chain)) : undefined;
  return {
    title: words.title,
    ...(amount ? { amount } : {}),
    lines: [...words.lines, ...(o.host ? [`Asked by ${o.host}`] : []), fromLine(w, o.older), `Up to ${evmNative(out, chain)} leaves the wallet, fees included.`],
    ...(words.details ? { details: words.details } : {}),
    warnings,
    effect: [{ token: NATIVE[chain], before: evmNative(sim.balance, chain).split(" ")[0]!, after: evmNative(sim.balance > out ? sim.balance - out : 0n, chain).split(" ")[0]! }],
    ...(o.asker ? { asker: o.asker } : {}),
    // D143: a hot key's sheet is one tap; Face ID is only for money leaving the Safe
    tap: true,
  };
}

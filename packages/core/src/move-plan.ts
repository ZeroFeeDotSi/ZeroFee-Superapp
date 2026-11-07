// A Move's ONE fill (QA's ruling, 7 Nov): its plan (the split, the leg check, the short landing) and its one
// sheet in the copy review's layout. Its own module, off Home's first load (the speed budget, 7 Nov): the core's plan (subwallets),
// the sheet's words (dev-signer hands moveFillBlock to intents.ts legsBlock) and the Sim load it when a Move does.
import { FILL_WORDS, LEG_WORDS, PRIVATE_BUFFER_USD, feeRow, fillStepUsd, privateRows, quoted, type MoveLeg, type OtherPart } from "./private-route.ts";
import { COSTS_MORE_HEAD, planLeastUsd, walletChainOf, walletLegLeastUsd } from "./float-floors.ts";

/**
 * The Move's one fill sheet in the copy review's layout (7 Nov), with the audit's SHOULD 4 (the rows add up): the headline is the person's
 * action ("Move $174.62 to your SOL and ETH (RH) wallets"); one sources line ("$89.62 from your Safe, $85.00 from Private.
 * $174.62 in all."; one source: "$174.62 from your Safe."); then the rows, destinations first: "Your SOL wallet gets ·
 * $89.62" for each part, "From your Safe · $200.00", "From Private · $10.00" (only when Private pays), "Stays in Private ·
 * about $X" (the fill's amountOut less every part it pays: a quote's figure, quoted) with its why line, and the fill's fee,
 * "Fee · about $0.25". The rows add up: From your Safe + From Private = what the wallets get + Stays + Fee. When the fee
 * eats into what the parts take, Private's own money covers it, and From Private says so ("about": from the quote).
 * `parts`: each wallet by Home's name with what Private pays it (`priv`) and what the fill pays it (`pay`); `safe`: the
 * bytes' amountIn; `brought`: the quote's amountOut (at most `safe`; absent, the Safe's figure). Pure: a table test.
 */
export const MOVE_WORDS = {
  why: (many: boolean) => (many ? "Your Safe sends a little more than the wallets get; the difference stays in Private." : FILL_WORDS.why),
  fee: (v: string) => `Fee · ${quoted(v)}`,
  one: (total: string, from: "your Safe" | "Private") => `${total} from ${from}.`,
  /** a wallet's row from its legs' signed quotes (the audit's ruling (c), 8 Nov; provisional words, to 53) */
  signed: (got: string, least: string) => `${quoted(got)}, at least ${least}`,
  /** a part with no signed quote yet in it: its least the plan's own floor, so "about" (the audit's SHOULD; provisional, to 53) */
  planned: (got: string, least: string) => `${quoted(got)}, at least ${quoted(least)}`,
  costsMore: COSTS_MORE_HEAD,
} as const;
/** "your SOL wallet" / "your SOL and ETH (RH) wallets" / "your SOL, ETH (RH) and NEAR wallets". */
export function walletsWords(names: readonly string[]): string {
  if (names.length === 1) return names[0]!;
  const bare = names.map((n) => n.replace(/^your /, "").replace(/ wallet$/, ""));
  return `your ${bare.length === 2 ? bare.join(" and ") : `${bare.slice(0, -1).join(", ")} and ${bare.at(-1)}`} wallets`;
}
/** `got`/`least` (the audit's ruling (c), 8 Nov): what the part's signed quotes give in cents, their amountOutUsd and their
 *  minAmountOut at that price (private-route.ts quoteGot), on a dollar sheet only. Words only: nothing signed reads them. */
export interface MoveSheetPart { wallet: string; priv: bigint; pay: bigint; got?: bigint; least?: bigint }
/** The plan's bound for these parts, in cents, as the Move page says it before any quote (move-split.ts costFacts with
 *  leastOf): "Arrives at least" (the floors' least of each, summed, rounded down) and "Fees at most" (what leaves less
 *  that), each part less its chain's network fee (float-floors NETWORK_FEE_USD). */
export function planBound(parts: readonly { wallet: string; v: bigint }[]): { least: bigint; mostFee: bigint } {
  const leaves = parts.reduce((n, p) => n + p.v, 0n);
  // a wallet the table doesn't name is held to a chain's bound (the most fee room), never the NEAR wallet's
  const least = BigInt(Math.floor(parts.reduce((n, p) => n + planLeastUsd(Number(p.v) / 100, walletChainOf(p.wallet) ?? "sol"), 0) * 100 + 1e-6));
  return { least, mostFee: leaves - least };
}
/** A wallet part of the same Move (C2): from one wallet to another, by Home's names, in the sheet's units. */
export interface MoveSheetOther { from: string; to: string; v: bigint }
/** The plan's order of wallets (the Move sheet's PLACES: SOL, ETH (RH), NEAR, BNB): one order on the plan, this sheet, the
 *  receipt and the job's row (QA's 04b, 7 Nov: the sheet said "NEAR and SOL", the plan "SOL and NEAR"). */
const PLAN_ORDER = ["SOL", "ETH (RH)", "NEAR", "BNB"];
const planRank = (wallet: string) => { const i = PLAN_ORDER.indexOf(wallet.replace(/^your /i, "").replace(/ wallet$/, "")); return i < 0 ? PLAN_ORDER.length : i; };
/** the copy review's words (7 Nov): the one quiet line under a Move sheet's rows, before "Anyone can see the Safe's part.", by its
 *  sources: Face ID approves only the Safe's part; a wallet's part and Private's send on their own. The Safe the only
 *  source: none. Pure: a table test. */
export const HOT_WORDS = { safe: "Face ID approves the Safe's part.", none: "No Face ID." } as const;
export function hotLine(wallets: readonly string[], priv: boolean, safe: boolean): string | null {
  const names = [...new Set(wallets.map((w) => w.replace(/^your /i, "").replace(/ wallet$/, "")))].sort((a, b) => planRank(a) - planRank(b));
  if (!names.length && !priv) return null;
  const who = names.length === 1 ? `Your ${names[0]} wallet` : names.length === 2 ? `Your ${names[0]} and ${names[1]} wallets` : names.length ? "Your wallets" : "";
  const one = names.length + (priv ? 1 : 0) === 1;
  return `${safe ? HOT_WORDS.safe : HOT_WORDS.none} ${who && priv ? `${who} and Private` : who || "Private"} ${one ? "sends on its own." : "send on their own."}`;
}
/**
 * QA's rule and the copy review's words (7 Nov, 04b graded C: two Safe figures, nine lines): the title, then the rows only:
 * destinations ("Your SOL wallet gets · $x", the plan's order), sources ("From your Safe · $150.00", the one figure it
 * signs; "From Private · $y"), the leftover ("Stays in Private · about $z", only above $0) and the fill's fee. No sources
 * sentence (its "$101.48 from your Safe" was a second Safe figure), no why sentence (the Stays row says it). The quiet
 * "Anyone can see the Safe's part." goes under the rows on every Move fill (the audit's MUST, 7 Nov): the Safe's leg 1 is a
 * public NEAR tx each time it signs, and with nothing staying its public figure is what the wallets get; the caller adds it.
 */
/** J2-1 (the copy review's final rows and the audit's ruling, 8 Nov): the core folds Private's share into the fill, so Private's rows are its
 *  NET change (private-route.ts privateRows): the fill brings more than the parts take, "Private keeps the rest · about
 *  $4.37" and no From Private row; Private pays out on net, "From Private · $Y" only. A Fee row on every sheet. The rows close on sight: From your Safe + From each wallet + From Private = what every wallet
 *  gets + Fee + what Private keeps (sums.net: Private's net change). */
export function moveSheet(
  parts: readonly MoveSheetPart[],
  safe: bigint,
  say: (v: bigint) => string,
  o: {
    brought?: bigint;
    others?: readonly MoveSheetOther[];
    /** a Swap of one part (J2-2): what the payout's signed quote gives, said "You get · about 1.42 SOL (about $298.50)",
     *  and its own fee (what it is paid less those dollars), joined to the Fee row */
    swapOut?: { words: string; fee: bigint };
    /** a Swap's plan has its own words (swap-corridor): its parts' quotes are said, never held to the Move's bound */
    swap?: boolean;
  } = {},
): {
  title: string;
  lines: string[];
  sums: {
    moved: bigint; fromSafe: bigint; fromPrivate: bigint; stays: bigint; fee: bigint; others: bigint; net: bigint;
    /** the signed quotes against the plan's bound (the audit's ruling (c)), when every part has them */
    signed?: { got: bigint; least: bigint; fee: bigint; plan: { least: bigint; mostFee: bigint }; costsMore: boolean };
  };
} {
  const brought = o.brought !== undefined && o.brought <= safe ? o.brought : safe;
  const moved = parts.reduce((n, p) => n + p.priv + p.pay, 0n);
  const paid = parts.reduce((n, p) => n + p.pay, 0n), own = parts.reduce((n, p) => n + p.priv, 0n);
  const short = paid > brought ? paid - brought : 0n, stays = brought > paid ? brought - paid : 0n, fee = safe - brought;
  const fromPrivate = own + short, fromSafe = moved - fromPrivate, net = brought - moved;
  // the Move's wallet parts (C2): each destination's row adds them, said "about" (a wallet's coin at its price; the Send
  // rule), and each source wallet has its own From row after the Safe's, in the plan's order
  const others = o.others ?? [];
  const gets = new Map<string, { v: bigint; about: boolean }>();
  for (const p of parts) gets.set(p.wallet, { v: (gets.get(p.wallet)?.v ?? 0n) + p.priv + p.pay, about: gets.get(p.wallet)?.about ?? false });
  for (const x of others) gets.set(x.to, { v: (gets.get(x.to)?.v ?? 0n) + x.v, about: true });
  const from = new Map<string, bigint>();
  for (const x of others) from.set(x.from, (from.get(x.from) ?? 0n) + x.v);
  const byPlan = (a: string, b: string) => planRank(a) - planRank(b);
  const wallets = [...gets.keys()].sort(byPlan);
  const otherSum = others.reduce((n, x) => n + x.v, 0n);
  // the audit's ruling (c), 8 Nov: every part with its signed quotes' dollars (a Move, never a Swap's own row): each wallet
  // gets "about" what they give, "at least" their minAmountOut; what they keep of the parts joins the Fee row; held to
  // the plan's bound, a quote past it heads the sheet. One part without them, or giving more than it is paid: as before
  const signed = !o.swapOut && parts.length > 0 && parts.every((p) => p.got !== undefined && p.least !== undefined && p.got >= 0n && p.least >= 0n && p.least <= p.got && p.got <= p.priv + p.pay);
  const byWallet = new Map<string, { got: bigint; least: bigint; v: bigint }>();
  if (signed) for (const p of parts) { const b = byWallet.get(p.wallet); byWallet.set(p.wallet, { got: (b?.got ?? 0n) + p.got!, least: (b?.least ?? 0n) + p.least!, v: (b?.v ?? 0n) + p.priv + p.pay }); }
  const gotSum = [...byWallet.values()].reduce((n, b) => n + b.got, 0n), leastSum = [...byWallet.values()].reduce((n, b) => n + b.least, 0n);
  const quoteFee = signed ? moved - gotSum : 0n;
  const plan = signed ? planBound([...byWallet].map(([wallet, b]) => ({ wallet, v: b.v }))) : null;
  const feeAll = fee + quoteFee + (o.swapOut && wallets.length === 1 && !others.length ? o.swapOut.fee : 0n);
  // each quote's least is rounded down on its own and the plan's once on the sum: a cent a quote of slack, never more
  const slack = BigInt(parts.reduce((n, p) => n + (p.priv > 0n ? 1 : 0) + (p.pay > 0n ? 1 : 0), 0));
  const costsMore = !!plan && o.swap !== true && (feeAll > plan.mostFee + slack || leastSum + slack < plan.least);
  // a wallet's part from another wallet has no signed quote yet (the audit's SHOULD, 8 Nov): its least is the plan's own floor
  // (walletLegLeastUsd, as the Move page works it), marked as the plan's: "at least about $Y"; on a dollar sheet only
  const chained = (name: string) => { const c = walletChainOf(name); return c !== null && c !== "near"; };
  const planLeast = (x: MoveSheetOther) => BigInt(Math.floor(walletLegLeastUsd(Number(x.v) / 100, chained(x.from), chained(x.to)) * 100 + 1e-6));
  const getsRow = (w: string): string => {
    const g = gets.get(w)!, b = byWallet.get(w), into = others.filter((x) => x.to === w);
    const intoLeast = into.reduce((n, x) => n + planLeast(x), 0n);
    const fillParts = parts.some((p) => p.wallet === w);
    if (b) {
      const v = g.v - b.v + b.got;
      return `${FILL_WORDS.gets(w)} · ${into.length ? MOVE_WORDS.planned(say(v), say(b.least + intoLeast)) : MOVE_WORDS.signed(say(v), say(b.least))}`;
    }
    if (signed && into.length && !fillParts) return `${FILL_WORDS.gets(w)} · ${MOVE_WORDS.planned(say(g.v), say(intoLeast))}`;
    return `${FILL_WORDS.gets(w)} · ${g.about ? quoted(say(g.v)) : say(g.v)}`;
  };
  const lines = [
    ...(costsMore ? [MOVE_WORDS.costsMore] : []),
    ...(o.swapOut && wallets.length === 1 && !others.length ? [`You get · ${o.swapOut.words}`] : wallets.map(getsRow)),
    `${LEG_WORDS.safe} · ${say(safe)}`,
    ...[...from.keys()].sort(byPlan).map((w) => `From ${w} · ${quoted(say(from.get(w)!))}`),
    // Private by its net change: what the fill brings less every part it pays and every part Private pays itself
    ...privateRows(net, say, { about: brought !== safe }),
    feeRow(feeAll, say),
    // the copy review's quiet line (7 Nov): what Face ID approves and what sends on its own, under the rows
    ...[hotLine([...from.keys()], fromPrivate > 0n, safe > 0n)].filter((l): l is string => !!l),
  ];
  return { title: `Move ${say(moved + otherSum)} to ${walletsWords(wallets)}`, lines, sums: { moved, fromSafe, fromPrivate, stays, fee, others: otherSum, net, ...(plan ? { signed: { got: gotSum, least: leastSum, fee: feeAll, plan, costsMore } } : {}) } };
}


/** The one fill's sheet from the core's own record (intents.ts legsBlock's facts, dev-signer's moveFill.parts): each
 *  part's wallet on the core's own list (an EVM address by any case), Private's and the fill's units in the fill's coin;
 *  the parts the fill pays never more than the bytes bring in. Null: not a sheet the core can stand behind (another
 *  coin, a part unnamed or not a figure, more paid than sent): the bytes' own words. A Swap of one part (the copy review's (c)): the
 *  call says so and the payment pays out another coin, one the core names. */
export function moveFillBlock(o: { parts: readonly MoveLeg[]; own: ReadonlyMap<string, string> | undefined; sameCoin: boolean; unit: (u: bigint) => bigint; say: (v: bigint) => string; safe: bigint; sent: bigint; brought: bigint; swap: boolean; origin: string; symbolOf: (tokenId: string) => string | undefined; swapOf: string; others?: readonly OtherPart[]; /** a coin amount in its own words ("1.4213 SOL"), as the sheet says coins */ coinSay?: (tokenId: string, units: string) => string | undefined; /** the fill's coin is dollars (the sheet's units cents): a Move's parts say their signed quotes' dollars */ dollar?: boolean }): { lines: string[]; title: string } | null {
  const isUnits = (v: unknown): v is string => typeof v === "string" && /^\d{1,40}$/.test(v);
  const nameOf = (a: string) => o.own?.get(a) ?? [...(o.own ?? new Map<string, string>())].find(([k]) => /^0x/i.test(a) && k.toLowerCase() === a.toLowerCase())?.[1];
  const parts = o.parts.map((p) => ({ wallet: p.own ? nameOf(p.recipient) : undefined, priv: isUnits(p.units) ? o.unit(BigInt(p.units)) : -1n, pay: isUnits(p.payUnits) ? o.unit(BigInt(p.payUnits)) : -1n, raw: isUnits(p.payUnits) ? BigInt(p.payUnits) : 0n, toTokenId: p.toTokenId }));
  if (!o.sameCoin || parts.some((p) => !p.wallet || p.priv < 0n || p.pay < 0n) || parts.reduce((n, p) => n + p.raw, 0n) > o.sent) return null;
  // the Move's wallet parts, in cents (a dollar fill only: legsBlock passes them so): every one by a wallet place and a
  // figure, or none said (C2: never a guess)
  const others = sheetOthers(o.others);
  const swapOut = swapOutOf(o, others.length);
  // the audit's ruling (c): a Move's parts on a dollar sheet carry their signed quotes' dollars (subwallets planLeg, quoteGot)
  const cents = (v: unknown) => (isUnits(v) ? BigInt(v) : undefined);
  const signed = o.dollar === true ? o.parts.map((p) => ({ got: cents(p.gotCents), least: cents(p.leastCents) })) : [];
  const sheet = moveSheet(parts.map((p, i) => ({ wallet: p.wallet!, priv: p.priv, pay: p.pay, ...(signed[i]?.got !== undefined && signed[i]?.least !== undefined ? { got: signed[i]!.got!, least: signed[i]!.least! } : {}) })), o.safe, o.say, { brought: o.brought, ...(others.length ? { others } : {}), ...(swapOut ? { swapOut } : {}), ...(o.swap ? { swap: true } : {}) });
  const one = parts.length === 1 && !others.length ? parts[0]! : null;
  const outSym = one && o.swap && one.toTokenId && one.toTokenId !== o.origin ? o.symbolOf(one.toTokenId) : undefined;
  return { lines: sheet.lines, title: outSym ? `Swap ${o.say(sheet.sums.moved)}${o.swapOf} for ${outSym}` : sheet.title };
}

/** A Swap of one part on a dollar sheet (J2-2, the copy review's row): what the payout's signed quote gives (its amountOut in the coin's
 *  own words, its amountOutUsd), and its own fee, what it is paid less those dollars. None: the coin unnamed, no dollars,
 *  or more out than in (the gets row as before). Words only: nothing here is signed. */
function swapOutOf(o: { parts: readonly MoveLeg[]; swap: boolean; origin: string; swapOf: string; unit: (u: bigint) => bigint; say: (v: bigint) => string; coinSay?: (tokenId: string, units: string) => string | undefined }, others: number): { words: string; fee: bigint } | null {
  // one part the fill pays whole (one payout, its one quote); Private paying some of it itself is a second quote: none
  const p = o.parts.length === 1 && !others && o.parts[0]!.units === "0" ? o.parts[0]! : null;
  if (!p || !o.swap || !o.swapOf || !p.toTokenId || p.toTokenId === o.origin || !p.outUnits || !/^\d{1,40}$/.test(p.outUnits) || !p.outUsd || !/^\d{1,12}(\.\d+)?$/.test(p.outUsd) || !/^\d{1,40}$/.test(p.payUnits)) return null;
  const coin = o.coinSay?.(p.toTokenId, p.outUnits);
  const outC = BigInt(Math.floor(Number(p.outUsd) * 100 + 1e-6)), pay = o.unit(BigInt(p.payUnits));
  if (!coin || outC > pay) return null;
  return { words: `${quoted(coin)} (${quoted(o.say(outC))})`, fee: pay - outC };
}

/**
 * ONE fill for the whole Move (QA's ruling, 7 Nov, over the owner's "prompt, success, prompt": a Move to two
 * wallets where both parts needed the Safe raised two Safe sheets, $10 and $40). The split is the plan: worked out here
 * from the Move's own parts and Private's share, never from a page's sums, then kept for the Move's life (subwallets
 * keepMovePlan) so every leg is checked against it.
 * - The smallest parts first: Private pays each it can whole from its own share (a hot key, no sheet).
 * - Every part after that is paid by the ONE fill (`viaFill`, the whole part: a leg 2 joined to that fill), while
 *   Private's leftover plus the fill's step over them stays at or under PRIVATE_BUFFER_USD (the audit's R2; its leftover stays
 *   in Private). Past it, Private's leftover goes into the first of those parts (`fromPrivate` and `viaFill` both), so
 *   Private never ends above the buffer because of the Move (R2, as the ledger's fillUnits: the step only while the
 *   share at the start plus its extra stays under the buffer).
 * - `whole` (a site's top-up): Private short, the fill pays every part, Private's share stays.
 * - The fill: a whole step over what it pays (`step`), or exactly that when the step would pass the buffer or the Safe
 *   (`safeHas`) can't cover the step (the ledger's balance.low fallback).
 * - `inPrivate` (the audit's MUST, 7 Nov): what Private really holds of the coin, the core's own read. What of it isn't `share`
 *   (held for open Sends, or a page that said less) stays in Private, so it counts toward the buffer in every R2 check.
 * In the coin's units; `step(u)` the whole step over u in units (u itself when there's no price), `usd(u)` units in dollars.
 * Pure: the ledger, the core's plan and the Sim meet in a table test.
 */
export interface MoveSplit { parts: { part: number; at: number; fromPrivate: bigint; viaFill: bigint }[]; short: bigint; fill: bigint }
export function moveSplit(parts: readonly bigint[], share: bigint, o: { whole?: boolean; safeHas?: bigint; inPrivate?: bigint; step: (u: bigint) => bigint; usd: (u: bigint) => number }): MoveSplit {
  const order = parts.map((_, i) => i).sort((a, b) => (parts[a]! < parts[b]! ? -1 : parts[a]! > parts[b]! ? 1 : a - b));
  const out: MoveSplit["parts"] = parts.map((_, i) => ({ part: i, at: order.indexOf(i), fromPrivate: 0n, viaFill: 0n }));
  const sum = parts.reduce((n, u) => n + u, 0n);
  let left = share < 0n ? 0n : share;
  // what stays in Private whatever the Move does: what it really holds beyond the share the Move may use
  const idle = o.inPrivate !== undefined && o.inPrivate > left ? o.inPrivate - left : 0n;
  const rest: number[] = [];
  if (o.whole === true && sum > left) rest.push(...order);
  else for (const i of order) { if (!rest.length && left >= parts[i]!) { out[i]!.fromPrivate = parts[i]!; left -= parts[i]!; } else rest.push(i); }
  const restSum = rest.reduce((n, i) => n + parts[i]!, 0n);
  if (restSum <= 0n) return { parts: out, short: 0n, fill: 0n };
  const extra = (u: bigint) => { const s = o.step(u); return s > u ? o.usd(s - u) : 0; };
  const fold = o.whole === true || left === 0n || o.usd(left + idle) + extra(restSum) <= PRIVATE_BUFFER_USD;
  let short = restSum;
  if (fold) for (const i of rest) out[i]!.viaFill = parts[i]!;
  else {
    // past the buffer: Private's leftover goes into the first part the fill pays
    const first = rest[0]!;
    out[first]!.fromPrivate = left;
    out[first]!.viaFill = parts[first]! - left;
    for (const i of rest.slice(1)) out[i]!.viaFill = parts[i]!;
    short = restSum - left;
  }
  // the step's extra stays in Private: only while Private's share (at the start, when its leftover went in) plus it stays under the buffer
  const kept = fold ? left : share;
  const s = o.step(short);
  const fill = s > short && o.usd(kept + idle) + o.usd(s - short) <= PRIVATE_BUFFER_USD && (o.safeHas === undefined || s <= o.safeHas) ? s : short;
  return { parts: out, short, fill };
}
/** moveSplit in dollars (the Sim's figures): whole cents, the dollar step (fillStepUsd). */
export function moveSplitUsd(parts: readonly number[], share: number, o: { whole?: boolean; safeHas?: number } = {}): { parts: { part: number; at: number; fromPrivate: number; viaFill: number }[]; short: number; fill: number } {
  const c = (usd: number) => BigInt(Math.round(Math.max(0, usd) * 100));
  const d = (u: bigint) => Number(u) / 100;
  const r = moveSplit(parts.map(c), c(share), { ...(o.whole ? { whole: true } : {}), ...(o.safeHas !== undefined && Number.isFinite(o.safeHas) ? { safeHas: c(o.safeHas) } : {}), step: (u) => c(fillStepUsd(d(u))), usd: d });
  return { parts: r.parts.map((p) => ({ part: p.part, at: p.at, fromPrivate: d(p.fromPrivate), viaFill: d(p.viaFill) })), short: d(r.short), fill: d(r.fill) };
}
/** A Move's leg against its kept plan (the audit's condition 1, 7 Nov): the wallet must be one of the plan's, and the leg at
 *  most what the plan keeps for it (`kept`: by wallet). Null: it matches; else why it is refused, by name. Words
 *  provisional (to 53). */
export function planLegRefusal(kept: ReadonlyMap<string, bigint> | null, wallet: string, units: bigint): string | null {
  if (!kept) return "This phone no longer has this Move's plan, so ZeroFee stopped this. Nothing moved.";
  const k = kept.get(wallet);
  if (k === undefined) return "That wallet isn't in this Move's plan, so ZeroFee stopped this. Nothing moved.";
  if (units > k) return "That wallet would get more than this Move planned, so ZeroFee stopped this. Nothing moved.";
  return null;
}
/** Which of a fill's parts go once it landed (the audit's condition 3, 7 Nov): what landed (`landed`, leg 1's own amountOut)
 *  pays the parts that fit, the smallest first, never a part in pieces; the rest stay in Private. `legs`: each part's
 *  leg 2 in units. Answers the indexes that go. Pure: a table test. */
export function partsThatFit(landed: bigint, legs: readonly bigint[]): number[] {
  const order = legs.map((_, i) => i).sort((a, b) => (legs[a]! < legs[b]! ? -1 : legs[a]! > legs[b]! ? 1 : a - b));
  const go: number[] = [];
  let left = landed;
  for (const i of order) { if (legs[i]! > left) break; go.push(i); left -= legs[i]!; }
  return go;
}

/**
 * C2 (QA's headline rule, the audit's five conditions, 7 Nov): a Move's wallet parts (wallet to wallet, beside the
 * Safe's fill) on the Safe's one sheet. spending.topUp checks the page's parts against the engine's own read and keeps
 * them under the Move's key, caps each wallet leg by them and ends them on any end but a yes (spending-move.ts
 * confirmOthers, keepFor, legCap, endOthers: off Home's first load, so the store is one per JS realm by OTHERS_STORE,
 * never an import between the two). The sheet reads them only for the fill of that very key, bound to its first fill.
 * Words only: nothing here is signed.
 */
export const OTHERS_MS = 10 * 60_000;
export const OTHERS_STORE = Symbol.for("zerofee.move-others");
export type KeptOthers = { parts: OtherPart[]; atMs: number; dep?: string; used: Set<number> } | { ended: true; atMs: number };
const keptOthers = (): Map<string, KeptOthers> => ((globalThis as Record<symbol, Map<string, KeptOthers>>)[OTHERS_STORE] ??= new Map());
const WALLET_PLACE: Record<string, string> = { sol: "your SOL wallet", hood: "your ETH (RH) wallet", near: "your NEAR wallet", bsc: "your BNB wallet" };
const centsOk = (c: unknown): c is string => typeof c === "string" && /^\d{1,12}$/.test(c) && BigInt(c) > 0n;
/** The parts for the fill of this key only, bound to the first fill that reads them: never another fill's, never another key's. */
export function othersForSheet(job: string, dep: string, now = Date.now()): OtherPart[] | undefined {
  const k = keptOthers().get(job);
  if (!k || "ended" in k || now - k.atMs > OTHERS_MS) return undefined;
  if (k.dep !== undefined && k.dep !== dep) return undefined;
  k.dep = dep;
  return k.parts.map((p) => ({ ...p }));
}
/** The kept parts as the sheet's rows take them: Home's names, cents; one not a place or a figure: none. */
export function sheetOthers(raw: readonly OtherPart[] | undefined): MoveSheetOther[] {
  if (!raw?.length) return [];
  const out = raw.map((p) => ({ from: WALLET_PLACE[p.from], to: WALLET_PLACE[p.to], v: centsOk(p.cents) ? BigInt(p.cents) : -1n }));
  return out.every((p) => p.from && p.to && p.v > 0n) ? out.map((p) => ({ from: p.from!, to: p.to!, v: p.v })) : [];
}

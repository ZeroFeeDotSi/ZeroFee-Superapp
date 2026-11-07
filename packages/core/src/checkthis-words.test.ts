// "Check this", the Safe's fill sheet, in the copy review's words (7 Nov): (a) a Move of more parts says the whole of it in
// one line under the headline, from the plan the call carries, said only once the core finds its own leg in it; (b) the
// fill's rows, what the wallet gets, the Safe, what stays and why, never "Together"; (c) a Swap is titled as a Swap, and
// NEAR is never "wNEAR". Words only: nothing here changes what is signed (the same bytes, the same quotes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner } from "./dev-signer.ts";
import { INTENTS, PRIVATE_POCKET, TRADING_BALANCE } from "./intents.ts";
import type { OneClickLookup } from "./intents.ts";
import type { PrivateLegRecord } from "./private-route.ts";
import { FILL_WORDS, fillRows, moveAllLine, moveAllTitle, planOthers } from "./private-route.ts";
import type { PlainWords, TxRequest } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DEPOSIT = "1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c";
const POCKET = "a1".repeat(32), SOLW = "So1aWa11et1111111111111111111111111111111111";
const say = (c: bigint) => `$${(c / 100n).toLocaleString("en-US")}.${String(c % 100n).padStart(2, "0")}`;

test("the copy review's (a): the whole Move's line, a table: both sources, the total last; the Safe's part is the leg or the Safe's step when that is less; one part, or none: no line", () => {
  const rows: [bigint, bigint, bigint[], string | null][] = [
    // the copy review's own figures: the SOL wallet's leg $148.25 from a $150.00 step, Private pays the other $12.75
    [14825n, 15000n, [1275n], "$148.25 from your Safe, $12.75 from Private. $161.00 in all."],
    // the Safe's step less than the leg: Private pays the rest of the leg and the other parts
    [3000n, 2000n, [500n], "$20.00 from your Safe, $15.00 from Private. $35.00 in all."],
    [3000n, 3000n, [1000n, 250n], "$30.00 from your Safe, $12.50 from Private. $42.50 in all."],
    // a single-leg Move: no line
    [14825n, 15000n, [], null],
    [14825n, 15000n, [0n], null],
  ];
  for (const [typed, safe, others, want] of rows) assert.equal(moveAllLine(typed, safe, others, say), want, `${typed} ${safe} ${others}`);
  // J4: the headline, from the same figures (the copy review's J4 job: the SOL leg $112.96 from a $150 step, the ETH (RH) leg $22.04)
  const titles: [bigint, bigint, bigint[], string | null][] = [
    [11296n, 15000n, [2204n], "Your Safe adds $112.96 to this $135.00 Move"],
    [3000n, 2000n, [500n], "Your Safe adds $20.00 to this $35.00 Move"],
    [11296n, 15000n, [], null],
  ];
  for (const [typed, safe, others, want] of titles) assert.equal(moveAllTitle(typed, safe, others, say), want);
  assert.ok(!moveAllLine(14825n, 15000n, [1275n], say)!.includes("the rest of this Move"), "control: never \"the rest of this Move\"");
});

test("the copy review's (a), the core's check: the plan's other parts only once the core finds its own leg among them (the payment's signed amountIn is the asked share of a part, as safe-send's askedShare); else no line", () => {
  // the leg the core built: Private's own share `priv`, the payment `pay` = askedShare(min, part - priv, sent)
  const leg = (priv: bigint, pay: bigint, min: bigint, sent: bigint) => (part: bigint) => part > priv && (part - priv >= sent ? min : (min * (part - priv)) / sent) === pay;
  const exact = leg(0n, 148_250_000n, 150_000_000n, 150_000_000n);
  // a 1 % minimum: the payment is 99 % of the part's share of the step (146.7675 of 148.25)
  const spread = leg(0n, 146_767_500n, 148_500_000n, 150_000_000n);
  const rows: [string[] | undefined, (p: bigint) => boolean, bigint[] | null, string][] = [
    [["12750000", "148250000"], exact, [12_750_000n], "the copy review's Move: the other part"],
    [["148250000", "12750000", "5000000"], exact, [12_750_000n, 5_000_000n], "three parts"],
    [["12750000", "148250000"], spread, [12_750_000n], "a leg 1 with a spread still finds its part"],
    [["12750000", "148250000"], leg(0n, 140_000_000n, 150_000_000n, 150_000_000n), null, "control: no part is the leg the core built (an app's plan that isn't this Move)"],
    [["12750000", "999000000"], exact, null, "control: the leg's part not in the plan"],
    [undefined, exact, null, "no plan"],
    [["148250000"], exact, null, "one part: a single-leg Move"],
    [["1", "2", "3", "4", "148250000"], exact, null, "more than 4 parts"],
    [["12.75", "148250000"], exact, null, "a part that isn't units"],
    [["0", "148250000"], exact, null, "a part of nothing"],
  ];
  for (const [plan, isLeg, want, why] of rows) assert.deepEqual(planOthers(plan, isLeg), want, why);
  // two parts of the same figure: one is the leg, the other stays
  assert.deepEqual(planOthers(["148250000", "148250000"], exact), [148_250_000n]);
});

test("the copy review's (b): the fill's rows, a table, in this order: the wallet gets, From your Safe, Stays in Private and its why, only when a difference stays; never Together", () => {
  const rows: [bigint, bigint, string, string[]][] = [
    [14825n, 15000n, "your SOL wallet", ["Your SOL wallet gets · $148.25", "From your Safe · $150.00", "Private keeps the rest · about $1.75", "Fee · $0.00"]],
    [14825n, 14825n, "your ETH (RH) wallet", ["Your ETH (RH) wallet gets · $148.25", "From your Safe · $148.25", "Fee · $0.00"]],
    [500n, 1000n, "your NEAR wallet", ["Your NEAR wallet gets · $5.00", "From your Safe · $10.00", "Private keeps the rest · about $5.00", "Fee · $0.00"]],
    [500n, 1000n, "your Safe", ["Your Safe gets · $5.00", "From your Safe · $10.00", "Private keeps the rest · about $5.00", "Fee · $0.00"]],
    [500n, 1000n, "Private", ["Private gets · $5.00", "From your Safe · $10.00", "Private keeps the rest · about $5.00", "Fee · $0.00"]],
    // the Safe's step less than the leg: Private pays the rest of it (provisional row, after the Safe's)
    [3000n, 2000n, "your SOL wallet", ["Your SOL wallet gets · $30.00", "From your Safe · $20.00", "From Private · $10.00", "Fee · $0.00"]],
  ];
  for (const [typed, safe, wallet, want] of rows) {
    const got = fillRows(typed, safe, wallet, say);
    assert.deepEqual(got, want);
    assert.ok(!got.some((l) => /Together/.test(l)), "never Together");
  }
});

/** The real core's sheet (DevSigner.describe) for a Move's fill: the Safe's ft_withdraw of `units` into the pocket. */
function setup(o: { units: string; min?: string; out?: string; coin?: "usdc" | "near"; leg: PrivateLegRecord | null; own?: Map<string, string> }) {
  const chain = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  chain.fund("alice.near", key.publicKey);
  const token = o.coin === "near" ? "wrap.near" : USDC;
  const balances: Record<string, string> = { [`nep141:${USDC}`]: "900000000", "nep141:wrap.near": (100n * 10n ** 24n).toString() };
  chain.contract("intents.near", INTENTS.codeHashBase58, { mt_balance_of: ({ token_id }) => balances[String(token_id)] ?? "0" });
  chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  chain.contract("wrap.near", "wrap", { ft_metadata: () => ({ symbol: "wNEAR", decimals: 24 }) });
  chain.contract("sol.omft.near", "omft", { ft_metadata: () => ({ symbol: "SOL", decimals: 9 }) });
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const quote = { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({
    quoteRequest: { dry: false, originAsset: `nep141:${token}`, destinationAsset: `nep141:${token}`, recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS", depositType: "ORIGIN_CHAIN", deadline: soon },
    quote: { depositAddress: DEPOSIT, amountIn: o.units, minAmountOut: o.min ?? o.units, amountOut: o.out ?? o.units, deadline: soon },
  }) };
  const lookup: OneClickLookup = async (address) => (address === DEPOSIT ? quote : null);
  const shown: PlainWords[] = [];
  const own = o.own ?? new Map([[POCKET, PRIVATE_POCKET], [SOLW, "your SOL wallet"]]);
  const signer = new DevSigner({ accountId: "alice.near", chain, key, approve: async (w) => (shown.push(w), true), oneClick: lookup, quoteKey: TEST_QUOTE_KEY, privateLeg: async () => o.leg, ownWallets: async () => own });
  const ask = (extra: Partial<TxRequest>) => signer.describe({ receiverId: "intents.near", actions: [{ kind: "call", method: "ft_withdraw", args: { token, receiver_id: DEPOSIT, amount: o.units }, depositYocto: "1", gas: "30000000000000" }], why: "", from: "wallet", moveFill: true, ...extra } as TxRequest);
  return { ask };
}
const usdcLeg = (payUnits: string, extra: Partial<PrivateLegRecord> = {}): PrivateLegRecord => ({ tokenId: `nep141:${USDC}`, payUnits, recipient: SOLW, own: true, ...extra });

test("the copy review's (a) and (b) on the real core's sheet: a Move of two parts says the whole Move in one line under the headline, then the rows; one part, an app's plan the core can't find its leg in, or no plan: no line", async () => {
  const s = setup({ units: "150000000", leg: usdcLeg("148250000") });
  const two = await s.ask({ movePlan: ["12750000", "148250000"] });
  // J4 (7 Nov): the headline holds the Safe's share and the whole Move, both from the plan, never the leg's figure alone
  assert.equal(two.title, "Your Safe adds $148.25 to this $161.00 Move");
  assert.deepEqual(two.lines.slice(0, 6), [
    "$148.25 from your Safe, $12.75 from Private. $161.00 in all.",
    "Your SOL wallet gets · $148.25", "From your Safe · $150.00", "Private keeps the rest · about $1.75",
    "Fee · $0.00",
    "Anyone can see the Safe's part.",
  ], two.lines.join(" | "));
  assert.ok(!two.lines.some((l) => /Together|the rest of this Move|follows in a second step/.test(l)), two.lines.join(" | "));
  const one = await s.ask({});
  assert.equal(one.lines[0], "Your SOL wallet gets · $148.25", "control: no plan, no line");
  assert.equal(one.title, "Move $148.25 to your SOL wallet", "control: a one-leg Move keeps the leg's own title");
  const lie = await s.ask({ movePlan: ["12750000", "100000000"] });
  assert.equal(lie.lines[0], "Your SOL wallet gets · $148.25", "control: a plan whose parts aren't this leg: no line");
  const single = await s.ask({ movePlan: ["148250000"] });
  assert.equal(single.lines[0], "Your SOL wallet gets · $148.25", "control: a single-leg Move gets no line");
  // a leg 1 with a 1 % minimum: the payment is the part's asked share of it; the core still finds the part
  const spread = setup({ units: "150000000", min: "148500000", leg: usdcLeg("146767500") });
  const sp = await spread.ask({ movePlan: ["12750000", "148250000"] });
  assert.deepEqual(sp.lines.slice(0, 4), ["$146.76 from your Safe, $12.75 from Private. $159.51 in all.", "Your SOL wallet gets · $146.76", "From your Safe · $150.00", "Private keeps the rest · about $3.24"], sp.lines.join(" | "));
  // nothing stays: no Stays row, no why line
  const even = setup({ units: "148250000", leg: usdcLeg("148250000") });
  const ev = await even.ask({ movePlan: ["148250000", "12750000"] });
  assert.deepEqual(ev.lines.slice(0, 5), ["$148.25 from your Safe, $12.75 from Private. $161.00 in all.", "Your SOL wallet gets · $148.25", "From your Safe · $148.25", "Fee · $0.00", "Anyone can see the Safe's part."]);
  // what is signed never moves: the same bytes' figure, with or without the plan
  assert.equal(two.amount, one.amount);
});

test("the copy review's (c) on the real core's sheet: a Swap is titled as one, \"Swap $148.25 of USDC for SOL\", only when the core's own record pays out another coin; NEAR, never wNEAR, anywhere on a NEAR fill's sheet", async () => {
  const swap = setup({ units: "150000000", leg: usdcLeg("148250000", { toTokenId: "nep141:sol.omft.near" }) });
  assert.equal((await swap.ask({ moveSwap: true })).title, "Swap $148.25 of USDC for SOL");
  assert.equal((await swap.ask({ moveSwap: true, movePlan: ["12750000", "148250000"] })).title, "Your Safe adds $148.25 to this $161.00 Move", "a Move of more parts is titled by the whole, never by one leg");
  assert.equal((await swap.ask({})).title, "Move $148.25 to your SOL wallet", "control: no Swap marker, a Move");
  const same = setup({ units: "150000000", leg: usdcLeg("148250000", { toTokenId: `nep141:${USDC}`, recipient: "f1oat.near" }), own: new Map([[POCKET, PRIVATE_POCKET], ["f1oat.near", TRADING_BALANCE]]) });
  const nw = await same.ask({ moveSwap: true });
  assert.equal(nw.title, "Move $148.25 to your NEAR wallet", "control: the payment pays out the Safe's own coin, so no Swap");
  assert.equal(nw.lines[0], "Your NEAR wallet gets · $148.25");
  // the Safe's NEAR (wrap.near): every line says NEAR
  const N = 10n ** 24n;
  const near = setup({ units: (10n * N).toString(), coin: "near", leg: { tokenId: "nep141:wrap.near", payUnits: (9n * N).toString(), recipient: SOLW, own: true, toTokenId: "nep141:sol.omft.near" } });
  for (const extra of [{ moveSwap: true as const }, {}]) {
    const w = await near.ask(extra);
    const all = [w.title, ...w.lines, ...(w.details ?? []).flatMap((d) => [d.label, ...d.lines])].join(" | ");
    assert.ok(!/wNEAR/.test(all), all);
    assert.ok(/NEAR/.test(all), all);
  }
  assert.equal((await near.ask({ moveSwap: true })).title, "Swap 9 NEAR for SOL");
});

test("the audit's MUST (7 Nov): \"Stays in Private\" on a Move is what Private will really hold, the fill's quoted amountOut less the leg, never the Safe's figure less the leg; a quote's figure, so about (the copy review's one rule)", async () => {
  // the rows, a table: what the fill brings
  const rows: [bigint | undefined, string[]][] = [
    [14970n, ["Your SOL wallet gets · $148.25", "From your Safe · $150.00", "Private keeps the rest · about $1.45", "Fee · about $0.30"]],
    // the fee eats more than the step's extra: Private pays the difference on net (J2-1: From Private, about)
    [14800n, ["Your SOL wallet gets · $148.25", "From your Safe · $150.00", "From Private · about $0.25", "Fee · about $2.00"]],
    // control: a fill that lands whole (the Sim's), the Safe's figure
    [undefined, ["Your SOL wallet gets · $148.25", "From your Safe · $150.00", "Private keeps the rest · about $1.75", "Fee · $0.00"]],
  ];
  for (const [brought, want] of rows) assert.deepEqual(fillRows(14825n, 15000n, "your SOL wallet", say, brought !== undefined ? { brought } : {}), want, `${brought}`);
  // the real core: a $150.00 fill whose quote brings $149.70 (a $0.30 fee); the leg $148.25
  const stays = async (o: { out: string; min: string }) => (await setup({ units: "150000000", ...o, leg: usdcLeg("148250000") }).ask({})).lines.find((l) => l.startsWith("Private keeps the rest")) ?? null;
  assert.equal(await stays({ out: "149700000", min: "149700000" }), "Private keeps the rest · about $1.45", "the quote's amountOut less the leg");
  assert.equal(await stays({ out: "149700000", min: "148200000" }), "Private keeps the rest · about $1.45", "a lower minimum: the same figure");
  assert.equal(await stays({ out: "148000000", min: "147000000" }), null, "the fee is more than the step's extra: nothing stays");
  assert.equal(await stays({ out: "150000000", min: "150000000" }), "Private keeps the rest · about $1.75", "control: no fee, the step's extra");
  // what is signed never moves: the same bytes' figure with or without a fee in the quote
  const a = await setup({ units: "150000000", out: "149700000", min: "148200000", leg: usdcLeg("148250000") }).ask({});
  const b = await setup({ units: "150000000", leg: usdcLeg("148250000") }).ask({});
  assert.equal(a.amount, b.amount);
  assert.equal(a.lines[1], "From your Safe · $150.00");
});

test("the copy review's one rule (7 Nov), a table over Send, Swap and Move: \"about\" before every figure that comes from a quote (Stays in Private, They get and its dollars, Fees), never before one typed or held by the ledger (the Safe's bytes, the leg, Private's share)", async () => {
  const { sendFillWords } = await import("./send-fill.ts");
  const { quoted } = await import("./private-route.ts");
  assert.equal(quoted("$10.10"), "about $10.10");
  const FROM_QUOTE = new Set(["Private keeps the rest", "They get", "Fees"]);
  const check = (lines: readonly string[], why: string) => {
    for (const l of lines) {
      const m = /^(.+?) · (.+)$/.exec(l);
      if (!m) continue;
      // J2-2: the Fee row is a quote's figure, about; none taken says $0.00 plainly
      assert.equal(m[2]!.startsWith("about "), FROM_QUOTE.has(m[1]!) || (m[1] === "Fee" && m[2] !== "$0.00"), `${why}: ${l}`);
      if (m[1] === "They get") assert.match(m[2]!, /\(about \$[\d,]+\.\d{2}\)$/, `${why}: its dollars too: ${l}`);
    }
  };
  // Move and Swap (the same fill rows): the leg, the Safe, Private's part, what stays
  check(fillRows(14825n, 15000n, "your SOL wallet", say, { brought: 14970n }), "Move, Safe over the leg");
  check(fillRows(3000n, 2000n, "your SOL wallet", say), "Move, Private pays part of the leg");
  const move = await setup({ units: "150000000", out: "149700000", min: "148200000", leg: usdcLeg("148250000") }).ask({ movePlan: ["12750000", "148250000"] });
  check(move.lines, "Move, the real core");
  const swap = await setup({ units: "150000000", out: "149700000", leg: usdcLeg("148250000", { toTokenId: "nep141:sol.omft.near" }) }).ask({ moveSwap: true });
  assert.equal(swap.title, "Swap $148.25 of USDC for SOL", "the Swap's title is the typed figure: no about");
  check(swap.lines, "Swap, the real core");
  // the Send: the Safe's bytes no about; what stays, what they get and its dollars, the fees: about
  const USDC_ID = `nep141:${USDC}`, SOL_ID = "nep141:sol.omft.near";
  const facts = { tokens: new Map([[USDC, { symbol: "USDC", decimals: 6 }], ["sol.omft.near", { symbol: "SOL", decimals: 9 }]]) } as never;
  const send = sendFillWords({ originAsset: USDC_ID, destinationAsset: USDC_ID, amountIn: "30000000", amountOut: "29700000" } as never, { originAsset: USDC_ID, amountIn: "20000000", destinationAsset: SOL_ID, recipient: "payee.test", recipientType: "DESTINATION_CHAIN", amountOutUsd: "19.40" } as never, facts)!;
  assert.deepEqual(send.lines.slice(0, 2), ["From your Safe · $30.00", "Private keeps the rest · about $9.70"], "the copy review's: the rest says about");
  check(send.lines, "Send");
  assert.equal(send.title, "Send $20.00 to payee.test", "the typed figure: no about (J2-2: a short name in the title)");
});

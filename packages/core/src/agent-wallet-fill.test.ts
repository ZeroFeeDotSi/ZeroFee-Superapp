// Filling AgentZero's wallet and emptying it (agent-wallet.ts, AGENTZERO-WALLET.md §2, L6; D152: a plain NEAR account):
// any coin reaches it through Home's own Move or Top up into the NEAR wallet, then the core's one NEAR wallet → AgentZero
// move, plain USDC withdrawn to its own account (and $0.30 as NEAR for its fees while its NEAR is low); empty goes to the
// Safe only; off behind AGENTZERO_WALLET, and the fill leg only in the $1 proof build (HOME_PROOF, D125).
// Controls (§9): fill a recipient other than agentAddress, drop pocket-moves' "pays your Safe" check, or open the fill in
// a release build, and the tests below go red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { AGENT_USDC } from "./agent-route.ts";
import { FEES_ASSET, FEES_PRICE_LINE, FILL_FEES_MICROS, FILL_LEAST_PERCENT, FILL_MIN_USD, FILL_NOT_OPEN, agentAddress, fillMinMicros, walletBalance, walletDo, walletOn } from "./agent-wallet.ts";
import { USDC_CONTRACT } from "./agent-pay.ts";
import { agentNear } from "./testing/agent-near.ts";
import { HOME_LEAST_PERCENT } from "./float-floors.ts";
import { FLOAT_MIN_USD } from "./float.ts";
import { FLOAT_USDC, type FloatRelay } from "./float-moves.ts";
import { HOME_PROOF } from "./home-proof.ts";
import { HOT_ROOT, hotRoot } from "./hot-keys.ts";
import { nep413Hash } from "./private-pocket.ts";
import { base64, fromBase58, utf8 } from "./sol/bytes.ts";
import type { PlainWords } from "./signer.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const MAIN = "kim.near";
const THIEF = "ee".repeat(32);
const key = (n: number) => `agent-fill-key-${String(n).padStart(4, "0")}`;
/** A fill as AgentZero's wallet screen makes it on the person's tap: a one-time ticket for the amount, then the fill. */
const fillOf = async (w: { agentKit(): never }, from: unknown, amount: string, k: string, chain?: unknown) => {
  const raw = { ...(w.agentKit() as object), ...(chain ? { chain } : {}) } as never;
  const t = await walletDo(raw, "walletTicket", amount).catch(() => ({ ticket: undefined }));
  return walletDo(raw, "walletFill", from, amount, k, t.ticket);
};
const says = (re: RegExp) => (e: any) => re.test(String(e?.problem?.more ?? e?.message));

/** ZeroFee's relay in front of 1Click (fake): `lie` changes what 1Click signed. */
function relay(o: { lie?: (req: any) => any; outUsd?: (req: any) => string } = {}) {
  const asked: any[] = [];
  const submitted: any[] = [];
  const quotes = new Map<string, { req: any; deadline: string }>();
  const r: FloatRelay = {
    quote: async (req) => {
      asked.push(req);
      const depositAddress = (asked.length.toString(16) + "d".repeat(64)).slice(0, 64);
      const deadline = new Date(Date.parse(req.deadline) + 3 * 86_400_000).toISOString();
      quotes.set(depositAddress, { req, deadline });
      return { quote: { depositAddress, amountIn: req.amount, amountOut: req.amount, deadline }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async (signerId, depositAddress) => {
      const q = quotes.get(depositAddress)!;
      const message = JSON.stringify({ deadline: q.deadline, intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [`imt:${MINTER}:${q.req.originAsset}`]: q.req.amount } }], signer_id: signerId });
      return { intent: { standard: "nep413", payload: { message, nonce: base64(new Uint8Array(32).fill(7)), recipient: "intents.far" } } };
    },
    submitIntent: async (signed) => (submitted.push(signed), { intentHash: "h" }),
    status: async (depositAddress) => {
      const q = quotes.get(depositAddress);
      if (!q) return null;
      const req = o.lie ? o.lie(q.req) : q.req;
      const minAmountOut = ((BigInt(q.req.amount) * 995n) / 1000n).toString();
      // 1Click's own signed dollars out: the amount's worth, unless a test bends it
      const amountOutUsd = o.outUsd ? o.outUsd(q.req) : (Number(q.req.amount) / 1e6).toFixed(6);
      return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest: req, quote: { depositAddress, amountIn: q.req.amount, amountOut: q.req.amount, minAmountOut, amountOutUsd, deadline: q.deadline } }) };
    },
  };
  return { r, asked, submitted };
}

/** 1Click's account read for AgentZero's wallet (its balance): `usdc` micro-dollars. */
const oneClick = (usdc: string) => (async (url: string) => (url.endsWith("/auth/authenticate") ? new Response(JSON.stringify({ accessToken: "s" }), { status: 201 }) : new Response(JSON.stringify({ balances: [{ tokenId: AGENT_USDC, available: usdc }] }), { status: 200 }))) as unknown as typeof fetch;

async function setup(o: { on?: boolean; proof?: boolean; lie?: (req: any) => any; answer?: boolean; usdc?: string; outUsd?: (req: any) => string } = {}) {
  const shown: PlainWords[] = [];
  const fake = relay({ lie: o.lie, ...(o.outUsd ? { outUsd: o.outUsd } : {}) });
  const vault = new MemoryVault();
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(5)));
  const w = new SubWallets({
    vault, sol: {} as never, evm: {} as never, floatRelay: fake.r, mainAccount: async () => MAIN,
    usdPrice: async () => 150, approve: async (words) => (shown.push(words), o.answer ?? true), emit: () => {}, quoteKey: TEST_QUOTE_KEY,
    intentsSalt: async () => "0a0b0c0d", oneClickFetch: oneClick(o.usdc ?? "7500000"),
    agentWallet: { on: o.on ?? true, proof: o.proof ?? true },
  });
  const float = await w.create("trade", "near");
  await vault.put("float-move-log", utf8(JSON.stringify({ base: { [FLOAT_USDC]: "50000000" }, kept: [] })));
  return { w, vault, float, shown, agent: await agentAddress(vault), ...fake };
}

test("Fund AgentZero from the NEAR wallet (D152): plain USDC withdrawn to AgentZero's own NEAR account, EXACT_INPUT, after the sheet; the first fill also carries $0.30 as NEAR for its fees", async () => {
  const { w, float, agent, asked, submitted, shown } = await setup();
  const near = agentNear({ exists: false });
  const m = await fillOf(w, "near", "20000000", key(1), near.chain);
  assert.ok(!("declined" in m));
  assert.deepEqual([m.kind, m.chain, m.perps], ["out", undefined, undefined], "a move out to no chain wallet and not Perps: AgentZero's fill");
  assert.deepEqual(shown.map((s) => s.title), ["Fund AgentZero's wallet"]);
  assert.match(shown[0]!.lines[0]!, /\$20\.00 moves from your NEAR wallet to AgentZero/);
  assert.match(shown[0]!.lines[1]!, /\$0\.30 of it is NEAR, for AgentZero's sending fees/);
  const [q, fees] = asked;
  assert.deepEqual(
    [q.originAsset, q.depositType, q.destinationAsset, q.swapType, q.amount, q.recipient, q.recipientType, q.refundTo, q.refundType, q.confidentiality],
    [FLOAT_USDC, "CONFIDENTIAL_INTENTS", AGENT_USDC, "EXACT_INPUT", (20_000_000n - FILL_FEES_MICROS).toString(), agent, "DESTINATION_CHAIN", float.address, "CONFIDENTIAL_INTENTS", "basic"],
  );
  assert.deepEqual([fees.destinationAsset, fees.amount, fees.recipient, fees.recipientType], [FEES_ASSET, FILL_FEES_MICROS.toString(), agent, "DESTINATION_CHAIN"]);
  // signed as the NEAR wallet (the float), the one transfer to the deposit address
  const s = submitted[0];
  assert.equal(JSON.parse(s.payload.message).signer_id, float.address);
  assert.ok(ed25519.verify(fromBase58(s.signature.slice(8)), nep413Hash(s.payload), fromBase58(s.public_key.slice(8))));
  // the NEAR wallet's own count goes down by what it signed away
  assert.equal((await w.floatBalance()).tokens.find((t) => t.tokenId === FLOAT_USDC)?.amount, "30000000");
  // asking again with the same key is the same move, never a second one
  const again = await fillOf(w, "near", "20000000", key(1), near.chain);
  assert.equal(!("declined" in again) && again.id, m.id);
  assert.equal(asked.length, 2);
  // control: with enough NEAR for its fees, one leg: all of it as USDC
  const full = await setup();
  await fillOf(full.w, "near", "20000000", key(21), agentNear({ nearYocto: 10n ** 23n }).chain);
  assert.deepEqual(full.asked.map((x) => [x.destinationAsset, x.amount]), [[AGENT_USDC, "20000000"]]);
  assert.equal(full.shown[0]!.lines.length, 2, "no fees line");
});

test("a fill whose signed quote pays anyone but AgentZero's wallet is refused; nothing is signed", async () => {
  const { w, submitted } = await setup({ lie: (req) => ({ ...req, recipient: THIEF }) });
  await assert.rejects(fillOf(w, "near", "20000000", key(2)), says(/wallet ZeroFee picked/));
  assert.equal(submitted.length, 0);
});

test("off (the flag), in a release build (no $1 proof yet), from another place, or declined: nothing is asked and nothing moves", async () => {
  assert.equal(HOME_PROOF, false, "under node, as in a release build, the proof build is off");
  const off = await setup({ on: false });
  await assert.rejects(fillOf(off.w, "near", "20000000", key(3)), says(/isn't open yet/));
  await assert.rejects(walletDo(off.w.agentKit(), "walletEmpty", key(3)), says(/isn't open yet/));
  await assert.rejects(walletDo(off.w.agentKit(), "walletRead"), says(/isn't open yet/));
  assert.equal(walletOn(off.w.agentKit()), false);
  // a release build: the NEAR wallet → AgentZero leg is a move between two wallets (like E5), shut until the $1 test
  const release = await setup({ proof: false });
  await assert.rejects(fillOf(release.w, "near", "20000000", key(4)), (e: any) => e?.problem?.code === "agentzero.fill.not-open" && e.problem.whatHappened === FILL_NOT_OPEN);
  assert.equal(FILL_NOT_OPEN, "Filling AgentZero opens after its $1 test.");
  // the Safe and the chain wallets reach AgentZero only through Home's Top up / Move into the NEAR wallet first
  const other = await setup();
  for (const from of ["safe", "sol", "hood", "bsc"]) await assert.rejects(fillOf(other.w, from, "20000000", key(5)), says(/NEAR wallet first/), from);
  const no = await setup({ answer: false });
  assert.deepEqual(await fillOf(no.w, "near", "20000000", key(6)), { declined: true });
  for (const s of [off, release, other, no]) assert.equal(s.asked.length, 0);
  assert.equal(release.shown.length + other.shown.length, 0, "no sheet for a fill that can't go");
});

test("a SubWallets made as the release app makes it (no proof option) refuses the fill even with the wallet on", async () => {
  const s = await setup();
  const vault = new MemoryVault();
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(5)));
  const w = new SubWallets({ vault, sol: {} as never, evm: {} as never, floatRelay: s.r, approve: async () => true, emit: () => {}, agentWallet: { on: true } });
  await assert.rejects(fillOf(w, "near", "20000000", key(11)), (e: any) => e?.problem?.code === "agentzero.fill.not-open");
});

test("the flag's default is on (product decision, 3 Nov); explicitly off, a SubWallets refuses every AgentZero wallet door", async () => {
  const vault = new MemoryVault();
  const w = new SubWallets({ vault, sol: {} as never, evm: {} as never, approve: async () => true, emit: () => {} });
  assert.equal(walletOn(w.agentKit()), true);
  // a release build without the test proof flag: the fill is refused by name, nothing moves (HOME_PROOF off under node)
  await assert.rejects(fillOf(w, "near", "20000000", key(7)), (e: any) => e?.problem?.code === "agentzero.fill.not-open" && e.problem.whatHappened === FILL_NOT_OPEN);
  const off = new SubWallets({ vault, sol: {} as never, evm: {} as never, approve: async () => true, emit: () => {}, agentWallet: { on: false } });
  assert.equal(walletOn(off.agentKit()), false);
  await assert.rejects(fillOf(off, "near", "20000000", key(7)), says(/isn't open yet/));
});

test("Move all to my Safe (D152, SR3 L14): privately, one 1Click quote home into the Safe (the core's own main account), then a plain transfer to its deposit address only; the Safe is named in no public transfer", async () => {
  const { w, shown, asked } = await setup();
  const near = agentNear({ usdcMicros: 7_500_000n });
  const m = await walletDo({ ...(w.agentKit() as object), chain: near.chain } as never, "walletEmpty", key(8));
  assert.ok(!("declined" in m));
  assert.deepEqual(shown.map((s) => s.title), ["Move AgentZero's money to your Safe"]);
  assert.match(shown[0]!.lines[0]!, /\$7\.50 moves to your Safe\. Anyone can see the two are linked\./);
  assert.ok(shown[0]!.lines.includes("Your Safe gets about $7.50"), shown[0]!.lines.join(" | "));
  assert.ok(shown[0]!.lines.includes("NEAR Intents and the network keep this. ZeroFee takes nothing."), shown[0]!.lines.join(" | "));
  assert.deepEqual([asked[0].recipient, asked[0].recipientType, asked[0].depositType], [MAIN, "INTENTS", "ORIGIN_CHAIN"]);
  const tx = near.sent[0]!.tx;
  assert.equal(tx.receiverId, USDC_CONTRACT);
  const sent = new TextDecoder().decode((tx.actions[0] as { args: Uint8Array }).args);
  assert.ok(!sent.includes(MAIN), "the Safe isn't named in the public transfer");
  // no Safe on this phone yet: refused, nothing sent
  const noSafe = new SubWallets({ vault: new MemoryVault(), sol: {} as never, evm: {} as never, approve: async () => true, emit: () => {}, agentWallet: { on: true } });
  const n2 = agentNear({ usdcMicros: 7_500_000n });
  await assert.rejects(walletDo({ ...(noSafe.agentKit() as object), chain: n2.chain } as never, "walletEmpty", key(9)), says(/no Safe/));
  assert.equal(n2.sent.length, 0);
});

test("SR3 L12: the fees leg moves only at a fair price: 1Click's own signed dollars out between half and twice its $0.30, else a plain line and nothing moves (the USDC leg stands)", async () => {
  for (const [name, out, moved] of [["half a cent of NEAR for $0.30", "0.005", false], ["$5 of NEAR for $0.30 (a mispriced quote)", "5.00", false], ["$0.29 of NEAR", "0.29", true]] as const) {
    const s = await setup({ outUsd: (req) => (req.destinationAsset === FEES_ASSET ? out : (Number(req.amount) / 1e6).toFixed(6)) });
    await fillOf(s.w, "near", "20000000", key(31), agentNear({ exists: false }).chain);
    assert.equal(s.submitted.length, moved ? 2 : 1, name);
  }
  assert.equal(FEES_PRICE_LINE, "AgentZero's fee money got a poor price, so it wasn't moved.");
});


test("the core's one door, account.agent.wallet: off, refused by name before D103's check; on, the check comes before a fill or an empty", async () => {
  const { pocketCall } = await import("./agent-pocket.ts");
  const calls: string[] = [];
  const near = agentNear({ usdcMicros: 7_500_000n, nearYocto: 10n ** 23n });
  const core = (w: SubWallets) => ({ wallets: w, chain: near.chain, strong: async () => void calls.push("strong") }) as never;
  const off = await setup({ on: false });
  await assert.rejects(pocketCall("account.agent.wallet", { do: "fill", from: "near", amount: "20000000", key: key(12) }, core(off.w)), says(/isn't open yet/));
  assert.deepEqual(calls, []);
  const on = await setup();
  assert.deepEqual(await pocketCall("account.agent.wallet", {}, core(on.w)), { address: on.agent, usdcMicros: "7500000", nearYocto: (10n ** 23n).toString(), feesLow: false, fillMinMicros: "2000000", fillFeesMicros: "0" });
  assert.deepEqual(calls, [], "a read asks for no check");
  const { ticket } = (await pocketCall("account.agent.wallet", { do: "ticket", amount: "20000000" }, core(on.w))) as { ticket: string };
  assert.deepEqual(calls, [], "a ticket asks for no check");
  await pocketCall("account.agent.wallet", { do: "fill", from: "near", amount: "20000000", key: key(12), ticket }, core(on.w));
  await pocketCall("account.agent.wallet", { do: "empty", key: key(13) }, core(on.w));
  assert.deepEqual(calls, ["strong", "strong"]);
  assert.deepEqual(on.shown.map((x) => x.title), ["Fund AgentZero's wallet", "Move AgentZero's money to your Safe"]);
  await assert.rejects(pocketCall("account.agent.wallet", { do: "send" }, core(on.w)));
});

test("the fill's floors are float.ts's and float-floors.ts's own (pinned in the lazy file so it imports neither)", () => {
  assert.equal(FILL_MIN_USD, FLOAT_MIN_USD);
  assert.equal(FILL_LEAST_PERCENT, HOME_LEAST_PERCENT);
});

test("SR2 L4: AgentZero's paying code reads nothing of the core's vault but its own \"agentzero:\" names and, through its key maker, the hot root", async () => {
  const s = await setup({ usdc: "7500000" });
  const names: string[] = [];
  const spy = { get: (n: string) => (names.push(n), s.vault.get(n)), put: (n: string, b: Uint8Array) => (names.push(n), s.vault.put(n, b)), delete: (n: string) => (names.push(n), s.vault.delete(n)) };
  const raw = { ...s.w.agentKit(), o: { ...s.w.agentKit().o, vault: spy } } as never;
  const TOKEN = `az1.${"A".repeat(22)}.${"b".repeat(43)}`;
  void TOKEN;
  const chained = { ...(raw as object), chain: agentNear({ usdcMicros: 7_500_000n }).chain } as never;
  await walletDo(chained, "walletRead");
  await walletDo(chained, "walletPay", { op: "month" }, async () => {});
  await walletDo(chained, "walletPay", { op: "reply", owedMicros: 5000, usage: { input_tokens: 1000, output_tokens: 50 }, model: "claude-opus-5-5", memo: `agentzero ${"ab".repeat(16)}`, reply: "0123456789abcdef" }, async () => {});
  await walletDo(chained, "walletEmpty", key(14)).catch(() => undefined);
  assert.ok(names.length > 0);
  const stray = names.filter((n) => n !== HOT_ROOT && !n.startsWith("agentzero:"));
  assert.deepEqual(stray, [], "only the hot root (for a key, through the key maker) and AgentZero's own names");
});

test("D143: a fill starts only from the person's tap: without a ticket, with a used one, another amount's or a stale one, refused and nothing asked", async () => {
  const s = await setup();
  const kit = () => s.w.agentKit() as never;
  await assert.rejects(walletDo(kit(), "walletFill", "near", "20000000", key(20)), says(/from its wallet screen/), "no ticket");
  await assert.rejects(walletDo(kit(), "walletFill", "near", "20000000", key(21), "f".repeat(32)), says(/from its wallet screen/), "a made-up ticket");
  const { ticket } = await walletDo(kit(), "walletTicket", "20000000");
  await assert.rejects(walletDo(kit(), "walletFill", "near", "30000000", key(22), ticket), says(/from its wallet screen/), "another amount (and the ticket is spent)");
  await assert.rejects(walletDo(kit(), "walletFill", "near", "20000000", key(23), ticket), says(/from its wallet screen/), "replayed");
  const t2 = (await walletDo(kit(), "walletTicket", "20000000")).ticket;
  const m = await walletDo(kit(), "walletFill", "near", "20000000", key(24), t2);
  assert.ok(!("declined" in m));
  await assert.rejects(walletDo(kit(), "walletFill", "near", "20000000", key(25), t2), says(/from its wallet screen/), "used once");
  const realNow = Date.now;
  try {
    const t3 = (await walletDo(kit(), "walletTicket", "20000000")).ticket;
    Date.now = () => realNow() + 61_000;
    await assert.rejects(walletDo(kit(), "walletFill", "near", "20000000", key(26), t3), says(/from its wallet screen/), "stale");
  } finally {
    Date.now = realNow;
  }
  // the one ticketed fill: its USDC leg and (no NEAR read here, so the first fill's) $0.30 fees leg, and nothing more
  assert.deepEqual(s.asked.map((q: any) => q.destinationAsset), [AGENT_USDC, FEES_ASSET], "only the one ticketed fill asked for quotes");
});

test("QA 5 Nov: the fill's floor is the core's own, read up front ($2.30 while AgentZero's NEAR is low), and a fill under it is refused by name, nothing asked", async () => {
  const s = await setup();
  const low = agentNear({ usdcMicros: 0n, nearYocto: 0n, exists: false }).chain;
  const kit = () => ({ ...(s.w.agentKit() as object), chain: low }) as never;
  // the read says the floor the fill will hold
  const r = await walletDo(kit(), "walletRead");
  assert.deepEqual([r.fillMinMicros, r.fillFeesMicros], ["2300000", "300000"]);
  assert.equal(r.fillMinMicros, fillMinMicros(true).toString(), "one figure: the read is the fill's own floor");
  // $2.00 with fees due: refused by name (never "This app asked for something it isn't allowed")
  const t = (await walletDo(kit(), "walletTicket", "2000000")).ticket;
  await assert.rejects(walletDo(kit(), "walletFill", "near", "2000000", key(40), t), (e: any) => e?.problem?.code === "agentzero.fill.min" && e.problem.whatHappened === "AgentZero needs at least $2.30 to add money. $0.30 of it pays its sending fees. Nothing moved.");
  assert.deepEqual(s.asked, [], "nothing asked of 1Click");
  assert.deepEqual(s.shown, [], "no sheet");
  // control: exactly the floor goes
  const t2 = (await walletDo(kit(), "walletTicket", "2300000")).ticket;
  const m = await walletDo(kit(), "walletFill", "near", "2300000", key(41), t2);
  assert.ok(!("declined" in m));
  assert.deepEqual(s.asked.map((q: any) => q.amount), ["2000000", "300000"]);
  // control: with NEAR for fees, the floor is $2.00 and its own words
  const full = agentNear({ usdcMicros: 0n, nearYocto: 10n ** 23n }).chain;
  const kit2 = () => ({ ...(s.w.agentKit() as object), chain: full }) as never;
  assert.deepEqual([(await walletDo(kit2(), "walletRead")).fillMinMicros, (await walletDo(kit2(), "walletRead")).fillFeesMicros], ["2000000", "0"]);
  const t3 = (await walletDo(kit2(), "walletTicket", "1990000")).ticket;
  await assert.rejects(walletDo(kit2(), "walletFill", "near", "1990000", key(42), t3), (e: any) => e?.problem?.code === "agentzero.fill.min" && /at least \$2\.00 to add money\. Less would mostly go on fees\. Nothing moved\.$/.test(e.problem.whatHappened));
});

test("QA 5 Nov: account.agent.balance, Home's AgentZero row: its USDC; none when the wallet is off or the words aren't here (control: on, it reads)", async () => {
  const near = agentNear({ usdcMicros: 1_990_000n }).chain;
  const on = await setup();
  assert.deepEqual(await walletBalance({ ...(on.w.agentKit() as object), chain: near } as never), { usdcMicros: "1990000" });
  const off = await setup({ on: false });
  assert.equal(await walletBalance({ ...(off.w.agentKit() as object), chain: near } as never), null, "off: no row");
  await on.vault.delete(HOT_ROOT);
  assert.equal(await walletBalance({ ...(on.w.agentKit() as object), chain: near } as never), null, "no words on this phone: no row");
  const { agentCall } = await import("./agent-door.ts");
  const again = await setup();
  const ctx = { ready: async () => undefined, subwallets: again.w, chain: near } as never;
  assert.deepEqual(await agentCall(ctx, "account.agent.balance", {}), { usdcMicros: "1990000" }, "the door answers it");
});

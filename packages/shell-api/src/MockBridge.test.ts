import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge, SAMPLE_CARD, SAMPLE_LAPTOP_CODE } from "./MockBridge.ts";
import { defaultBands } from "@zerofee/core/demo-core";
import { lines, plusUsd } from "@zerofee/wallet/app/format.ts";
import type { Balance } from "@zerofee/wallet/types.ts";

const USDC_NEAR_ID = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const problem = { code: "wallet.test", whatHappened: "Test.", money: { state: "not-involved" as const }, next: { kind: "nothing" as const, label: "OK" } };

test("answers the ledger with sample data", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const res = await mock.call<{ symbol: string; bridged: boolean }[]>("ledger.balances");
  assert.ok("ok" in res && res.ok.some((b) => b.symbol === "USDC" && !b.bridged));
});

test("a withdraw moves, then lands with an event", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 10 });
  const landed = new Promise((r) => mock.on("ledger.movementUpdated", r));
  const res = await mock.call<{ status: string }>("ledger.withdraw", { tokenId: "x", amount: "5", toAddress: "y", chain: "base" });
  assert.ok("ok" in res && res.ok.status === "moving");
  assert.equal(((await landed) as { movement: { status: string } }).movement.status, "done");
});

test("any method can be told to answer with a Problem, to preview error screens", async () => {
  const mock = createMockBridge({ latencyMs: 0, fail: { "ledger.withdraw": problem } });
  const res = await mock.call("ledger.withdraw", {});
  assert.ok("problem" in res && res.problem.code === "wallet.test");
});

test("signatures can be declined", async () => {
  const mock = createMockBridge({ latencyMs: 0, decline: true });
  const res = await mock.call<{ status: string }>("tx.request", { request: { receiverId: "a", actions: [], why: "w", from: "trade" } });
  assert.ok("ok" in res && res.ok.status === "declined");
});

test("device storage is kept apart per app", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  await mock.call("device.store.set", { app: "pay", key: "contacts", value: "[1]" });
  const own = await mock.call<{ value: string | null }>("device.store.get", { app: "pay", key: "contacts" });
  const other = await mock.call<{ value: string | null }>("device.store.get", { app: "trade", key: "contacts" });
  assert.ok("ok" in own && own.ok.value === "[1]");
  assert.ok("ok" in other && other.ok.value === null);
});

test("an unknown method is a Problem, never a crash", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const res = await mock.call("nope.nothing");
  assert.ok("problem" in res && res.problem.code === "mock.unknown");
});

test("ledger.tokens has Pay's shape, and quotePay echoes the payee with float-free amounts", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const tokens = await mock.call<{ assetId: string; decimals: number; contract: string | null }[]>("ledger.tokens");
  assert.ok("ok" in tokens && tokens.ok.every((t) => typeof t.decimals === "number" && "contract" in t));
  const to = { kind: "chain", chain: "base", address: "0x5a3e000000000000000000000000000000005a3e" };
  const q = await mock.call<{ to: unknown; amountIn: string; amountInExpected: string }>("ledger.quotePay", {
    fromTokenId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    toTokenId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", to, amountOut: "4.2",
  });
  assert.ok("ok" in q);
  assert.deepEqual(q.ok.to, to);
  assert.equal(q.ok.amountInExpected, "4.2084"); // 4.2 × 1.002
  assert.equal(q.ok.amountIn, "4.221");
});

test("callers can bring their own coin list", async () => {
  const mock = createMockBridge({ latencyMs: 0, tokens: [{ assetId: "a", chain: "c", symbol: "X", decimals: 2, contract: null }] });
  const res = await mock.call<{ assetId: string }[]>("ledger.tokens");
  assert.ok("ok" in res && res.ok.length === 1 && res.ok[0].assetId === "a");
});

test("a deposit address without a token is for the chain's own coin, and memo chains carry their memo", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const sol = await mock.call<{ token: string; note: string; memo?: string }>("ledger.depositAddress", { chain: "sol" });
  assert.ok("ok" in sol && sol.ok.token === "nep141:sol.omft.near" && sol.ok.note === "Send only on Solana." && !("memo" in sol.ok));
  const xlm = await mock.call<{ memo?: string; note: string }>("ledger.depositAddress", { chain: "stellar" });
  assert.ok("ok" in xlm && xlm.ok.memo === "5013" && /memo/.test(xlm.ok.note));
});

test("with holdSeconds, a signature is held: it shows in account.waiting, can't run early, and can be cancelled", async () => {
  const mock = createMockBridge({ latencyMs: 0, holdSeconds: 60 });
  const out = await mock.call<{ status: string; id: string }>("tx.request", { request: { receiverId: "kiosk.near", actions: [], why: "Pay Kiosk", from: "pay" } });
  assert.ok("ok" in out && out.ok.status === "waiting");
  const id = "ok" in out ? out.ok.id : "";
  const list = await mock.call<{ id: string; title: string; ready: boolean }[]>("account.waiting");
  assert.ok("ok" in list && list.ok.length === 1 && list.ok[0].title === "Pay Kiosk" && !list.ok[0].ready);
  const early = await mock.call("account.waiting.run", { id });
  assert.ok("problem" in early && early.problem.code === "security.waiting.not-yet");
  const cancel = await mock.call<{ status: string }>("account.waiting.cancel", { id });
  assert.ok("ok" in cancel && cancel.ok.status === "done");
  const after = await mock.call<unknown[]>("account.waiting");
  assert.ok("ok" in after && after.ok.length === 0);
});

test("every balance row says where it's held, and one USDC row is in the account itself (D14)", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const res = await mock.call<{ symbol: string; held: string }[]>("ledger.balances");
  assert.ok("ok" in res && res.ok.every((b) => b.held === "ledger" || b.held === "account"));
  assert.ok("ok" in res && res.ok.some((b) => b.symbol === "USDC" && b.held === "account"));
});

test("the sample holds only listed, priced coins (no unlisted row on the demo's Home); each chain says what it credits", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const bal = await mock.call<{ symbol: string; listed: boolean; icon: string; usd: string | null }[]>("ledger.balances");
  assert.ok("ok" in bal && bal.ok.length > 0 && bal.ok.every((b) => b.listed && b.icon !== "" && b.usd !== null));
  const chains = await mock.call<{ id: string; coins: string[] }[]>("ledger.chains");
  assert.ok("ok" in chains && chains.ok.find((c) => c.id === "sol")?.coins.includes("nep141:sol.omft.near"));
});

test("linking the extension: a code from the phone, then the sealed QR adds the laptop wallet; expired and wrong are Problems", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const start = await mock.call<{ code: string; expiresAtIso: string }>("subwallet.linkStart", { kind: "extension" });
  assert.ok("ok" in start && start.ok.code.length === 11 && Date.parse(start.ok.expiresAtIso) > Date.now());
  const ok = await mock.call<{ kind: string }[]>("subwallet.import", { kind: "extension", sealed: "qr-text" });
  assert.ok("ok" in ok && ok.ok[0].kind === "extension");
  const listed = await mock.call<{ kind: string }[]>("subwallet.list", { kind: "extension" });
  assert.ok("ok" in listed && listed.ok.length === 1);
  for (const [sealed, code] of [["expired", "security.link.expired"], ["wrong", "security.link.wrong"]]) {
    const res = await mock.call("subwallet.import", { kind: "extension", sealed });
    assert.ok("problem" in res && res.problem.code === code);
  }
});

test("with holdSeconds, a ledger payment is held too: status waiting, a held id, and nothing settles", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, holdSeconds: 60 });
  const res = await mock.call<{ status: string; held: { id: string } }>("ledger.transfer", { amount: "5", toAccountId: "sam.near" });
  assert.ok("ok" in res && res.ok.status === "waiting" && res.ok.held.id.startsWith("held-"));
  await new Promise((r) => setTimeout(r, 20));
  const act = await mock.call<{ status: string }[]>("ledger.activity");
  assert.ok("ok" in act && act.ok[0].status === "waiting");
  const waiting = await mock.call<unknown[]>("account.waiting");
  assert.ok("ok" in waiting && waiting.ok.length === 1);
});

test("a send that lands lowers the balance: the coin's row and the one total; a held one doesn't until it is paid", async () => {
  type Row = { tokenId: string; held: string; amount: string; usd: string | null };
  const total = (rows: Row[]) => rows.reduce((t, r) => t + Number(r.usd ?? 0), 0);
  const usdcRow = (rows: Row[]) => rows.find((r) => r.tokenId === USDC_NEAR_ID && r.held === "ledger")!;
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5 });
  const before = await mock.call<Row[]>("ledger.balances");
  assert.ok("ok" in before);
  const landed = new Promise((r) => mock.on("ledger.movementUpdated", r));
  await mock.call("ledger.transfer", { tokenId: USDC_NEAR_ID, amount: "25", toAccountId: "alice.near" });
  await landed;
  const after = await mock.call<Row[]>("ledger.balances");
  assert.ok("ok" in after);
  assert.equal(usdcRow(after.ok).amount, String(Number(usdcRow(before.ok).amount) - 25), "USDC down 25");
  assert.equal(Math.round((total(before.ok) - total(after.ok)) * 100) / 100, 25, "the total down $25");
  // SOL out (a withdraw): the SOL row and its dollars follow
  const solBefore = before.ok.find((r) => r.tokenId === "nep141:sol.omft.near")!;
  const landed2 = new Promise((r) => mock.on("ledger.movementUpdated", r));
  await mock.call("ledger.withdraw", { tokenId: "nep141:sol.omft.near", amount: "1", toAddress: "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY", chain: "sol" });
  await landed2;
  const sol = (await mock.call<Row[]>("ledger.balances") as { ok: Row[] }).ok.find((r) => r.tokenId === "nep141:sol.omft.near")!;
  assert.equal(Number(sol.amount), Number((Number(solBefore.amount) - 1).toFixed(9)));
  assert.ok(Number(sol.usd) < Number(solBefore.usd));
  // held: nothing leaves while it waits
  const held = createMockBridge({ latencyMs: 0, settleMs: 5, holdSeconds: 60 });
  await held.call("ledger.transfer", { tokenId: USDC_NEAR_ID, amount: "25", toAccountId: "alice.near" });
  await new Promise((r) => setTimeout(r, 20));
  const still = await held.call<Row[]>("ledger.balances");
  assert.ok("ok" in still);
  assert.equal(usdcRow(still.ok).amount, usdcRow(before.ok).amount, "a held send hasn't left");
});

test("card.check says yes to the one sample Gnosis Pay card account and no to anything else", async () => {
  assert.match(SAMPLE_CARD, /^0x[0-9a-f]{40}$/, "a real EVM address shape, or Pay's own check refuses it first");
  const mock = createMockBridge({ latencyMs: 0 });
  const yes = await mock.call<{ isCard: boolean }>("card.check", { product: "gnosis-pay", address: SAMPLE_CARD.toUpperCase() });
  assert.ok("ok" in yes && yes.ok.isCard);
  const no = await mock.call<{ isCard: boolean; why: string }>("card.check", { product: "gnosis-pay", address: "0x5a3e000000000000000000000000000000005a3e" });
  assert.ok("ok" in no && !no.ok.isCard && no.ok.why.length > 0);
});

test("card.balance: the sample card holds some EURe, any other address none, and a non-address is refused", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const card = await mock.call<{ amount: string; symbol: string; readAtIso: string }>("card.balance", { address: SAMPLE_CARD });
  assert.ok("ok" in card && card.ok.amount === "248.5" && card.ok.symbol === "EURe" && !Number.isNaN(Date.parse(card.ok.readAtIso)));
  const other = await mock.call<{ amount: string }>("card.balance", { address: "0x5a3e000000000000000000000000000000005a3e" });
  assert.ok("ok" in other && other.ok.amount === "0");
  const bad = await mock.call("card.balance", { address: "0x12" });
  assert.ok("problem" in bad && bad.problem.code === "security.request.invalid");
});

test("an account runs no sample code; a transfer's msg and memo reach its movement", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5 });
  const person = await mock.call<{ code: string | null }>("ledger.recipientInfo", { accountId: "sam.near" });
  assert.ok("ok" in person && person.ok.code === null);
  const landed = new Promise((r) => mock.on("ledger.movementUpdated", r));
  const msg = JSON.stringify({ ref: "1" });
  await mock.call("ledger.transfer", { tokenId: "nep141:usdc", amount: "30", toAccountId: "pot.sample.testnet", memo: "Dinner", msg });
  const { movement } = (await landed) as { movement: { status: string; msg?: string; memo?: string } };
  assert.equal(movement.status, "done");
  assert.equal(movement.msg, msg);
  assert.equal(movement.memo, "Dinner");
});

test("a transfer-and-call ends refunded when its sample receiver sends it straight back", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5 });
  mock.on<{ amount: string; refund: boolean }>("sample.transferCall", (call) => {
    if (call.amount !== "30") call.refund = true;
  });
  const ends = async (amount: string) => {
    const landed = new Promise((r) => mock.on("ledger.movementUpdated", r));
    await mock.call("ledger.transfer", { tokenId: "nep141:usdc", amount, toAccountId: "pot.sample.testnet", msg: JSON.stringify({ ref: "1" }) });
    return ((await landed) as { movement: { status: string } }).movement.status;
  };
  assert.equal(await ends("29"), "refunded");
  assert.equal(await ends("30"), "done");
});

test("a held request's status: waiting while listed, then how it ended, with account.waiting.ended fired here", async () => {
  const mock = createMockBridge({ latencyMs: 0, holdSeconds: 0.01 });
  const out = await mock.call<{ status: string; id: string }>("tx.request", { request: { receiverId: "a", actions: [], why: "w", from: "earn" } });
  assert.ok("ok" in out && out.ok.status === "waiting");
  const id = out.ok.id;
  const before = await mock.call<{ state: string }>("account.waiting.status", { id });
  assert.ok("ok" in before && before.ok.state === "waiting");
  const unknown = await mock.call<{ state: string }>("account.waiting.status", { id: "never-held" });
  assert.ok("ok" in unknown && unknown.ok.state === "unknown");

  await new Promise((r) => setTimeout(r, 20));
  const ended = new Promise<{ id: string; ended: string }>((r) => mock.on("account.waiting.ended", r));
  const ran = await mock.call<{ status: string }>("account.waiting.run", { id });
  assert.ok("ok" in ran && ran.ok.status === "done");
  assert.deepEqual(await ended.then((e) => [e.id, e.ended]), [id, "ran"]);
  const after = await mock.call<{ state: string; explorerUrl?: string }>("account.waiting.status", { id });
  assert.ok("ok" in after && after.ok.state === "ran" && !/testnet/.test(after.ok.explorerUrl ?? ""), "a sample outcome links to no testnet explorer");
  const gone = await mock.call("account.waiting.run", { id });
  assert.ok("problem" in gone && gone.problem.code === "security.waiting.not-found");
});

test("a cancelled hold reads as cancelled afterwards", async () => {
  const mock = createMockBridge({ latencyMs: 0, holdSeconds: 60 });
  const out = await mock.call<{ id: string }>("tx.request", { request: { receiverId: "a", actions: [], why: "w", from: "pay" } });
  assert.ok("ok" in out);
  await mock.call("account.waiting.cancel", { id: out.ok.id });
  const after = await mock.call<{ state: string }>("account.waiting.status", { id: out.ok.id });
  assert.ok("ok" in after && after.ok.state === "cancelled");
});

test("with a sheet listening, a signature waits for approval.answer: yes signs, no declines, one sheet at a time", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const seen: { id: string; words: { title: string; hint?: string } }[] = [];
  mock.on<{ id: string; words: { title: string; hint?: string } }>("approval.needed", (p) => seen.push(p));
  const request = { receiverId: "shop.near", actions: [], why: "Pay the shop", from: "pay" };
  const first = mock.call<{ status: string }>("tx.request", { request });
  const second = mock.call<{ status: string }>("tx.request", { request: { ...request, why: "Second" } });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(seen.length, 1, "the second request waits its turn; it never replaces the words on screen");
  assert.equal(seen[0].words.title, "Pay the shop");
  await mock.call("approval.answer", { id: seen[0].id, approve: true });
  assert.ok("ok" in (await first) && (await first as { ok: { status: string } }).ok.status === "done");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(seen.length, 2);
  assert.equal(seen[1].words.title, "Second");
  await mock.call("approval.answer", { id: seen[1].id, approve: false });
  const s = await second;
  assert.ok("ok" in s && s.ok.status === "declined");
  const stale = await mock.call("approval.answer", { id: seen[1].id, approve: true });
  assert.ok("problem" in stale, "an answer for a sheet that's gone is refused");
});

test("a ledger movement declined on the sheet is a .declined Problem, and the movement never starts", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  mock.on<{ id: string; words: { hint?: string } }>("approval.needed", (p) => {
    assert.equal(p.words.hint, undefined, "no 'X asks.' line: with no words from the app, the attribution is dropped");
    void mock.call("approval.answer", { id: p.id, approve: false });
  });
  const res = await mock.call("ledger.transfer", { tokenId: "nep141:usdc", amount: "30", toAccountId: "sam.near", caller: "earn" });
  assert.ok("problem" in res && res.problem.code === "ledger.signature.declined");
  const activity = await mock.call<{ amount: string }[]>("ledger.activity", { limit: 50 });
  assert.ok("ok" in activity && !activity.ok.some((m) => m.amount === "30"));
});

test("sending or cancelling a held request asks the sheet with that request's own words; a no leaves it held", async () => {
  const mock = createMockBridge({ latencyMs: 0, holdSeconds: 60 });
  const titles: string[] = [];
  mock.on<{ id: string; words: { title: string } }>("approval.needed", (p) => {
    titles.push(p.words.title);
    void mock.call("approval.answer", { id: p.id, approve: titles.length !== 2 }); // yes to the hold, no to the first cancel, yes to the second
  });
  const out = await mock.call<{ id: string }>("tx.request", { request: { receiverId: "bob.near", actions: [], why: "Send 6 NEAR to bob.near", from: "wallet" } });
  assert.ok("ok" in out);
  const no = await mock.call<{ status: string }>("account.waiting.cancel", { id: out.ok.id });
  assert.ok("ok" in no && no.ok.status === "declined");
  assert.equal(titles[1], "Cancel: Send 6 NEAR to bob.near");
  const still = await mock.call<unknown[]>("account.waiting");
  assert.ok("ok" in still && still.ok.length === 1, "a declined cancel leaves it held");
  const yes = await mock.call<{ status: string }>("account.waiting.cancel", { id: out.ok.id });
  assert.ok("ok" in yes && yes.ok.status === "done");
  assert.deepEqual(titles, ["Send 6 NEAR to bob.near", "Cancel: Send 6 NEAR to bob.near", "Cancel: Send 6 NEAR to bob.near"]);
});

test("the Sim's Move as the core's fill sheet (the ruling, the audit and the copy review, 5 Nov; the copy review's rows, 7 Nov): \"Move $30.00 to your SOL wallet\", then what the wallet gets, what the Safe signs and Private's part, never Together; Private empty, the wallet gets, the Safe's step and what stays with its why; Private covering it, no sheet (no Face ID)", async () => {
  const split = (lines: string[]) => lines.filter((l) => /^(Your \S+.* gets|From Private|From your Safe|Private keeps the rest|Stays in Private|Together) · /.test(l));
  const sheetOf = async (privateUsdc: string, usd: number) => {
    const mock = createMockBridge({ latencyMs: 0, settleMs: 5, safeFillOpen: true, ...(privateUsdc ? { hiddenStart: { usdc: privateUsdc, near: "0" } } : {}) });
    const seen: string[][] = [];
    mock.on<{ id: string; words: { title: string; lines: string[] } }>("approval.needed", (a) => { seen.push([a.words.title, ...a.words.lines]); void mock.call("approval.answer", { id: a.id, approve: true }); });
    const r = await mock.call("ledger.moveFromPrivate", { parts: [{ wallet: "sw-trade-sol", usd }], app: "trade" });
    assert.ok("ok" in r, JSON.stringify(r));
    return seen;
  };
  // Private's share past the buffer (the ledger's foldsWhole false, the Sim's mirror, 7 Nov): Private pays its $495, the
  // Safe a $20 step over the $15 rest. the copy review's layout (7 Nov): the sources line, then the rows; Private's row is its own
  // $495, what the fill leaves ($5) its own row, so the rows add up (the audit's SHOULD 4; was "From Private · $490.00")
  const both = await sheetOf("495", 510);
  assert.equal(both.length, 1, "one sheet");
  assert.equal(both[0]![0], "Move $510.00 to your SOL wallet", "the typed figure and its wallet");
  // fix/move-row-truth (QA's rule and the copy review's words, 7 Nov): no sources line (a second Safe figure), the rows right under the title
  // J2-1 (8 Nov): Private's row is its NET change: $495 out, $5 of the fill kept, so "From Private · $490.00"; the sum
  // closes on sight: $20.00 + $490.00 = $510.00 + Fee $0.00
  // the audit's ruling (c), 8 Nov: the wallet's row is what its legs' quotes give (the Sim's simSwapCost, each leg on its own), at
  // least their minAmountOut; what they keep joins the Fee: $20.00 + $490.00 = $507.36 + Fee $2.64 (was "gets · $510.00", Fee $0.00)
  assert.deepEqual(split(both[0]!), ["Your SOL wallet gets · about $507.36, at least $502.28", "From your Safe · $20.00", "From Private · $490.00"]);
  assert.deepEqual(both[0]!.slice(1, 4), split(both[0]!), "the rows right under the title");
  // under the buffer the ledger folds the part whole into its fill (the audit's R2, one Face ID): $12.50 in Private, $30: a $40
  // step, Private's share staying (the old Sim: "From your Safe · $20.00", "From Private · $10.00")
  assert.deepEqual((await sheetOf("12.5", 30)).map(split), [["Your SOL wallet gets · about $29.58, at least $29.28", "From your Safe · $40.00", "Private keeps the rest · about $10.00"]]);
  assert.deepEqual(both[0]!.slice(4), ["Fee · about $2.64", "Face ID approves the Safe's part. Private sends on its own.", "Anyone can see the Safe's part."], "one leg: no second step, no why sentence; the Sim's fill lands whole, the legs' quotes keep $2.64 (J2-2: a Fee row on every sheet)");
  const empty = await sheetOf("", 6);
  // the audit's ruling (c) and MUST (8 Nov): the Sim's quote for $6.00 to the SOL wallet keeps $0.32, inside the plan's bound
  // (its percentage part and the SOL leg's $0.30 network fee): no head
  assert.deepEqual(empty.map((x) => [x[0], split(x), x[4], x[5]]), [["Move $6.00 to your SOL wallet", ["Your SOL wallet gets · about $5.68, at least $5.62", "From your Safe · $10.00", "Private keeps the rest · about $4.00"], "Fee · about $0.32", "Anyone can see the Safe's part."]], "Private empty: the wallet gets, the Safe's step, what stays, the quiet line");
  assert.deepEqual(await sheetOf("12.5", 6), [], "control: Private covers it, no sheet");
});

test("Sim re-check (QA, 5 Nov): the Sim's Move sheet says what Private really does. $50 with $15 in Private: From Private $10.00 and Private falls $10.00 (the sheet said $15); $9.74 with $5: Stays in Private $0.26 and Private rises $0.26 (the sheet said From Private $5); no Amount line over the block; the lines add up", async () => {
  const run = async (privateUsdc: string, usd: number) => {
    const mock = createMockBridge({ latencyMs: 0, settleMs: 5, safeFillOpen: true, hiddenStart: { usdc: privateUsdc, near: "0" } });
    const seen: { lines: string[]; amountSaid?: true }[] = [];
    mock.on<{ id: string; words: { lines: string[]; amountSaid?: true } }>("approval.needed", (a) => { seen.push(a.words); void mock.call("approval.answer", { id: a.id, approve: true }); });
    const priv = async () => { const r = await mock.call<{ rows: { usd: string | null }[] }>("ledger.private", {}); return "ok" in r ? Math.round(r.ok.rows.reduce((n, x) => n + Number(x.usd ?? 0), 0) * 100) : NaN; };
    const safeUsdc = async () => { const r = await mock.call<{ tokenId: string; held?: string; amount: string }[]>("ledger.balances", {}); return "ok" in r ? Math.round(Number(r.ok.find((b) => b.tokenId === "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" && b.held === "ledger")?.amount ?? 0) * 100) : NaN; };
    const before = await priv(), safeBefore = await safeUsdc();
    const r = await mock.call("ledger.moveFromPrivate", { parts: [{ wallet: "sw-trade-sol", usd }], app: "trade" });
    assert.ok("ok" in r, JSON.stringify(r));
    const safeOut = safeBefore - (await safeUsdc());
    return { safeOut, block: seen[0]!.lines.filter((l) => /^(Your \S+.* gets|From Private|From your Safe|Private keeps the rest|Stays in Private|Together) · /.test(l)), fee: seen[0]!.lines.find((l) => l.startsWith("Fee · ")), amountSaid: seen[0]!.amountSaid, change: (await priv()) - before };
  };
  // a row's first figure ("gets · about $9.40, at least $9.30": its $9.40)
  const c = (l?: string) => (l ? Math.round(Number(/\$([\d.]+)/.exec(l)![1]) * 100) : 0);
  // past the buffer (the Sim's mirror, 7 Nov: under it the ledger folds the part whole, so no From Private line)
  const big = await run("495", 510);
  // the copy review's layout (7 Nov): Private's own $495 and what the fill leaves, $5, each on its row; Private falls by their difference
  assert.deepEqual(big.block, ["Your SOL wallet gets · about $507.36, at least $502.28", "From your Safe · $20.00", "From Private · $490.00"]);
  assert.equal(big.change, c(big.block.find((l) => l.startsWith("Private keeps the rest"))) - c(big.block.find((l) => l.startsWith("From Private"))), "Private's row is its net change (J2-1)");
  assert.equal(big.change, -49000);
  assert.equal(big.amountSaid, true, "no Amount line: one amount, said once");
  assert.equal(big.safeOut, c(big.block.find((l) => l.startsWith("From your Safe"))), "83: the From your Safe line is what left the Safe");
  const small = await run("5", 9.74);
  // folded whole (the audit's R2): a $20 step over $9.74, Private's $5 staying
  assert.deepEqual(small.block, ["Your SOL wallet gets · about $9.40, at least $9.30", "From your Safe · $20.00", "Private keeps the rest · about $10.26"]);
  assert.equal(small.change, c(small.block.find((l) => l.startsWith("Private keeps the rest"))), "what Private keeps is what Private gained");
  assert.equal(small.change, 1026);
  assert.equal(small.safeOut, 2000, "83: the From your Safe line is what left the Safe");
  for (const { block: b, fee } of [big, small]) {
    const get = (k: string) => c(b.find((l) => l.startsWith(k)));
    // the audit's ruling (c): the wallet gets what its quotes give; what they keep is the Fee row's
    assert.equal(get("From Private") + get("From your Safe") - get("Private keeps the rest"), get("Your SOL wallet gets") + c(fee), "the lines add up in cents");
  }
});

test("askApproval: false, or nobody listening, signs at once", async () => {
  const off = createMockBridge({ latencyMs: 0, askApproval: false });
  off.on("approval.needed", () => assert.fail("asked although askApproval is false"));
  const a = await off.call<{ status: string }>("tx.request", { request: { receiverId: "a", actions: [], why: "w", from: "trade" } });
  assert.ok("ok" in a && a.ok.status === "done");
  const nobody = createMockBridge({ latencyMs: 0 });
  const b = await nobody.call<{ status: string }>("tx.request", { request: { receiverId: "a", actions: [], why: "w", from: "trade" } });
  assert.ok("ok" in b && b.ok.status === "done");
});

test("needsFunding: a mainnet account waits for its NEAR, then account.create returns the account", async () => {
  const need = String(37n * 10n ** 23n);
  const mock = createMockBridge({ latencyMs: 0, needsFunding: { needYocto: need, haveYocto: ["0", String(10n ** 24n)] } });
  const state = await mock.call<{ stage: string; account?: unknown }>("account.state");
  assert.ok("ok" in state && state.ok.stage === "needs-funding" && state.ok.account === undefined);
  const a = await mock.call<{ stage: string; fundAddress: string; needYocto: string; haveYocto: string }>("account.create");
  const b = await mock.call<{ stage: string; haveYocto: string }>("account.create");
  assert.ok("ok" in a && a.ok.stage === "needs-funding" && a.ok.needYocto === need && a.ok.haveYocto === "0" && /^[0-9A-F]{64}$/.test(a.ok.fundAddress));
  assert.ok("ok" in b && b.ok.stage === "needs-funding" && b.ok.haveYocto === String(10n ** 24n));
  const done = await mock.call<{ accountId: string }>("account.create");
  assert.ok("ok" in done && /\.testnet$/.test(done.ok.accountId));
  const after = await mock.call<{ stage: string }>("account.state");
  assert.ok("ok" in after && after.ok.stage === "ready");
});

test("subwallet.balances: the mock gives the core's own rows, symbols and decimals, chain by chain", async () => {
  const { SubWallets } = await import("@zerofee/core/subwallets");
  const { MemoryVault } = await import("@zerofee/core/vault");
  const zero = async (_chain: string, method: string) => (method === "eth_getBalance" ? "0x0" : `0x${"0".repeat(64)}`);
  const core = new SubWallets({ vault: new MemoryVault(), sol: { balance: async () => 0n } as never, evm: { read: zero } as never, approve: async () => false, emit: () => {} });
  const mock = createMockBridge({ latencyMs: 0 });
  for (const [kind, chain] of [["browser", "sol"], ["browser", "eth"], ["trade", "bsc"], ["browser", "base"], ["browser", "arb"], ["browser", "gnosis"]]) {
    const real = await core.balances((await core.create(kind, chain)).id);
    const made = await mock.call<{ id: string }>("subwallet.create", { kind, chain });
    assert.ok("ok" in made);
    const shown = await mock.call<typeof real>("subwallet.balances", { id: made.ok.id });
    assert.ok("ok" in shown, chain);
    assert.deepEqual(shown.ok, real, `${chain}: the same rows as the core`);
  }
  const none = await mock.call("subwallet.balances", { id: "nope" });
  assert.ok("problem" in none && none.problem.code === "security.subwallet.unknown");
});

test("protection in the demo: Save asks the sheet with the rules in words, then account.protection.get has them", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const asked: { words: { title: string; lines: string[] }; id: string }[] = [];
  mock.on<{ id: string; words: { title: string; lines: string[] } }>("approval.needed", (a) => {
    asked.push(a);
    void mock.call("approval.answer", { id: a.id, approve: true });
  });
  const before = await mock.call<{ bands: unknown[]; usd: unknown }>("account.protection.get");
  assert.ok("ok" in before);
  // The demo's account starts with what set-up writes for a new account (the core's own defaults), never a screen's.
  assert.deepEqual(before.ok.usd, defaultBands("mainnet"));
  assert.deepEqual(before.ok.usd, [{ upToUsd: 500, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 86_400 }]);
  const out = await mock.call<{ status: string }>("account.protection.set", { bands: [{ upToUsd: 1000, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 86400 }] });
  assert.ok("ok" in out && out.ok.status === "done");
  assert.equal(asked[0].words.title, "Save your protection rules");
  // In a browser the approval is the sheet's Approve, never "Face ID".
  assert.deepEqual(asked[0].words.lines.slice(0, 2), ["Up to $1,000: Your yes", "Anything bigger: Your yes, then a 1-day wait"], "the wait's length is part of what's approved");
  const got = await mock.call<{ bands: { up_to: unknown; level: unknown }[] }>("account.protection.get");
  assert.ok("ok" in got);
  assert.deepEqual(got.ok.bands.map((b) => b.level), ["FaceId", { Wait: { seconds: "86400" } }]);
});

test("the trading and fund sheets name the thing from the request, put Trade's words under it as a hint, and never show a raw address", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const seen: { title: string; lines: string[]; hint?: string }[] = [];
  mock.on<{ id: string; words: { title: string; lines: string[]; hint?: string } }>("approval.needed", (p) => {
    seen.push(p.words);
    void mock.call("approval.answer", { id: p.id, approve: true });
  });
  const list = await mock.call<{ id: string; address: string }[]>("subwallet.list", { kind: "trade" });
  assert.ok("ok" in list);
  const w = list.ok[0];

  // D143 (core approval-policy.ts): a chain wallet is a hot key, so its fast trading starts with no sheet
  const started = await mock.call("subwallet.session.start", { id: w.id, minutes: 15, why: "Buy $1.00 of DOPE" });
  assert.ok("ok" in started, JSON.stringify(started));
  assert.equal(seen.length, 0, "no sheet for a hot key's session");

  const label = "Move $3.00 of SOL to your Spending wallet on Solana";
  await mock.call("ledger.withdraw", { tokenId: "nep141:sol.omft.near", amount: "0.491787154", toAddress: w.address, chain: "sol", label });
  // The core's words (intents.test.ts): rounded DOWN to 4 digits with "about", the exact amount in a line, the address
  // one tap away.
  assert.equal(seen[0].title, "Move $50.04 (0.4917 SOL) to your Spending wallet on Solana"); // the title at most 4 decimals (QA, 5 Nov); the line below keeps every digit
  assert.equal(seen[0].hint, `Trade says: ${label}`);
  assert.deepEqual(seen[0].lines, ["Move 0.491787154 SOL from your Safe to your Spending wallet on Solana"]);

  const quote = await mock.call<{ id: string }>("ledger.quotePay", { fromTokenId: "nep141:sol.omft.near", toTokenId: "nep141:sol.omft.near", to: { kind: "chain", chain: "sol", address: w.address }, amountOut: "0.491787154" });
  assert.ok("ok" in quote);
  await mock.call("ledger.pay", { quoteId: quote.ok.id, label });
  assert.equal(seen[1].title, "Move $50.04 (0.4917 SOL) to your Spending wallet on Solana");
  assert.equal(seen[1].hint, `Trade says: ${label}`);
  assert.equal(seen[1].lines[0], "Send 0.491787154 SOL from your Safe to the swap service");
  assert.equal(seen[1].lines.at(-1), "If it can't, your SOL comes back to your Safe");

  // The address is one tap away, in full, once; never in the title or a line (mainnet rehearsal, 3 Nov: no raw "Details:").
  assert.equal(seen.length, 2);
  for (const words of seen) assert.ok(!words.title.includes(w.address) && !words.lines.some((l) => l.includes(w.address) || l.startsWith("Details:")) && JSON.stringify(words.details) === JSON.stringify([{ label: "The address in full", lines: [w.address] }]));
});

test("an app's words that are too long or carry control characters are dropped, and a sheet without them has no Trade line", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const seen: { title: string; hint?: string }[] = [];
  mock.on<{ id: string; words: { title: string; hint?: string } }>("approval.needed", (p) => {
    seen.push(p.words);
    void mock.call("approval.answer", { id: p.id, approve: true });
  });
  const list = await mock.call<{ id: string; address: string }[]>("subwallet.list", { kind: "trade" });
  assert.ok("ok" in list);
  assert.ok(list.ok[0]);
  // D143: a hot key's session has no sheet, so the words are tried on a sheet the Safe's own key still raises (a send out)
  const send = { tokenId: "nep141:sol.omft.near", amount: "0.491787154", toAddress: "ElsewhereAddr111", chain: "sol" };
  for (const label of [undefined, "x".repeat(81), "Buy\nsomething"]) await mock.call("ledger.withdraw", label === undefined ? send : { ...send, label });
  assert.equal(seen.length, 3);
  for (const s of seen) {
    assert.equal(s.title, "Send out $50.04 (0.4917 SOL) to sol");
    assert.equal(s.hint, undefined);
    assert.ok(!JSON.stringify(s).includes("ElsewhereAddr111"));
  }
  // control: short, one-line words ride under the title as Trade's
  await mock.call("ledger.withdraw", { ...send, label: "Buy $1.00 of DOPE" });
  assert.equal(seen[3]!.hint, "Trade says: Buy $1.00 of DOPE");
});

test("a round amount to your own wallet has no \"about\"; the title rounds down, never up", async () => {
  const { aboutAmount } = await import("./MockBridge.ts");
  assert.deepEqual(aboutAmount("10"), { exact: "10", title: "10" });
  assert.deepEqual(aboutAmount("0.4917"), { exact: "0.4917", title: "0.4917" });
  assert.equal(aboutAmount("0.499999").title, "about 0.4999");
  assert.equal(aboutAmount("12345.6").title, "about 12340");
  assert.equal(aboutAmount("0.50").exact, "0.5");
});

test("?demo has one account name: account.state and Wallet's NEAR address say the same id the screens use", async () => {
  const { SAMPLE_ACCOUNT_ID } = await import("./MockBridge.ts");
  const mock = createMockBridge({ latencyMs: 0 });
  const state = await mock.call<{ account: { accountId: string } }>("account.state");
  assert.ok("ok" in state);
  assert.equal(state.ok.account.accountId, SAMPLE_ACCOUNT_ID);
  assert.equal(SAMPLE_ACCOUNT_ID, "zf-sample000001.testnet");
});

test("D143: a session.start that carries the first trade asks nothing and echoes the bytes as signedTx; without it, only when it ends; never declined", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const seen: unknown[] = [];
  // every sheet would be answered no: a hot key's session never raises one, so it is never declined (core approval-policy.ts)
  mock.on<{ id: string; words: unknown }>("approval.needed", (p) => {
    seen.push(p.words);
    void mock.call("approval.answer", { id: p.id, approve: false });
  });
  const list = await mock.call<{ id: string }[]>("subwallet.list", { kind: "trade" });
  assert.ok("ok" in list);
  const id = list.ok[0].id;

  // Trade's own call (packages/trade service.ts): the dollar session with the first trade's bytes
  const first = await mock.call<{ endsAtIso: string; signedTx?: string }>("subwallet.session.start", { perTxUsd: 100, totalUsd: 500, minutes: 30, why: "Buy $1.00 of DOPE", id, firstTx: "AQIDBA==" });
  assert.ok("ok" in first, JSON.stringify(first));
  assert.equal(first.ok.signedTx, "AQIDBA==");
  assert.ok(Date.parse(first.ok.endsAtIso) > Date.now());
  // Without firstTx: only when it ends, and no signedTx
  const plain = await mock.call<{ endsAtIso: string; signedTx?: string }>("subwallet.session.start", { perTxUsd: 100, totalUsd: 500, minutes: 30 });
  assert.ok("ok" in plain, JSON.stringify(plain));
  assert.deepEqual(Object.keys(plain.ok), ["endsAtIso"]);
  assert.equal(seen.length, 0, "no sheet, so nothing to decline");
  // control: its caps still hold with no sheet (the core's $100 a trade, $500 in all)
  const over = await mock.call("subwallet.session.start", { perTxUsd: 101, totalUsd: 500, minutes: 30 });
  assert.ok("problem" in over && over.problem.code === "security.request.not-allowed", JSON.stringify(over));
});

test("the pay sheet has a fee line only when there is a fee: none for a same-coin pay, a convert or a withdraw, one for a pay that swaps", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const seen: { lines: string[] }[] = [];
  mock.on<{ id: string; words: { lines: string[] } }>("approval.needed", (p) => {
    seen.push(p.words);
    void mock.call("approval.answer", { id: p.id, approve: true });
  });
  const to = { kind: "chain", chain: "sol", address: "So1anaAddressForTheFeeTest11111111111111111111" };
  const quote = async (toTokenId: string) => {
    const q = await mock.call<{ id: string }>("ledger.quotePay", { fromTokenId: "nep141:sol.omft.near", toTokenId, to, amountOut: "1" });
    assert.ok("ok" in q);
    return q.ok.id;
  };
  await mock.call("ledger.pay", { quoteId: await quote("nep141:sol.omft.near") });
  await mock.call("ledger.pay", { quoteId: await quote("nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near") });
  await mock.call("ledger.convert", { fromTokenId: "nep141:sol.omft.near", toTokenId: "nep141:sol.omft.near", amount: "1" });
  assert.equal(seen.length, 3);
  assert.ok(!seen[0].lines.some((l) => l.startsWith("Fee")), "same-coin pay: no fee line");
  assert.deepEqual(seen[1].lines.filter((l) => l.startsWith("Fee")), ["Fee: under 1 cent."]);
  assert.ok(!seen[2].lines.some((l) => l.startsWith("Fee")), "convert: no fee line");
  assert.ok(!seen.some((s) => s.lines.includes("Fee: none.")));
});

test("a deposit address for USDC carries USDC's minimum, and a coin with none known carries none", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const usdc = await mock.call<{ minAmount: string }>("ledger.depositAddress", { chain: "base", token: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near" });
  assert.ok("ok" in usdc && usdc.ok.minAmount === "1");
  const other = await mock.call<{ minAmount: string }>("ledger.depositAddress", { chain: "base", token: "nep141:unknown" });
  assert.ok("ok" in other && other.ok.minAmount === "0");
});

test("Trade's float: one NEAR wallet, made once, and its fee guard", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const float = await mock.call<{ id: string; kind: string; chain: string; address: string; label: string }>("subwallet.create", { kind: "trade", chain: "near" });
  assert.ok("ok" in float);
  assert.deepEqual([float.ok.kind, float.ok.chain, float.ok.label], ["trade", "near", "Spending"]);
  assert.match(float.ok.address, /^[0-9A-F]{66}$/, "implicit-shaped, in capitals and 66 long: no NEAR account has capitals or more than 64 characters, so nothing sent to it lands, even lowercased");
  const again = await mock.call<{ id: string }>("subwallet.create", { kind: "trade", chain: "near" });
  assert.ok("ok" in again && again.ok.id === float.ok.id);
  const list = await mock.call<{ chain: string }[]>("subwallet.list", { kind: "trade" });
  assert.ok("ok" in list && list.ok.filter((w) => w.chain === "near").length === 1);
  assert.deepEqual(await mock.call("subwallet.float.limits"), { ok: { movesLeftToday: 20, perDay: 20, minUsd: 2, open: ["sol", "hood", "bsc"] } });
});

let keys = 0;
const key = () => `trade-job-${String(++keys).padStart(8, "0")}`;

test("Trade's float: a move's key makes a resume safe: the same key gives the same move, never a second one", async () => {
  const mock = createMockBridge({ latencyMs: 0, float: { moveMs: 50, startUsd: 50 } });
  const ask = { chain: "sol", slot: 0, amount: "100000000", key: key() };
  const first = await mock.call<{ id: string }>("subwallet.float.out", ask);
  const again = await mock.call<{ id: string }>("subwallet.float.out", ask);
  assert.ok("ok" in first && "ok" in again && again.ok.id === first.ok.id);
  const moves = await mock.call<unknown[]>("subwallet.float.moves");
  assert.ok("ok" in moves && moves.ok.length === 1, "one move");
  const changed = await mock.call("subwallet.float.out", { ...ask, amount: "200000000" });
  assert.ok("problem" in changed && changed.problem.code === "security.request.invalid", "a key reused for a different move is refused");
  const none = await mock.call("subwallet.float.out", { chain: "sol", slot: 0, amount: "100000000" });
  assert.ok("problem" in none && none.problem.code === "security.request.invalid", "every move has a key");
});

test("?demo&bnbclosed: float moves to and from BNB are refused as the core refuses a chain it doesn't move to yet; other chains still move", async () => {
  const mock = createMockBridge({ latencyMs: 0, tradeChains: ["sol", "hood", "bsc"], float: { moveMs: 50, startUsd: 50, bnbClosed: true } });
  const out = await mock.call("subwallet.float.out", { chain: "bsc", slot: 0, amount: "10000000000000000", key: key() });
  assert.ok("problem" in out && out.problem.code === "security.subwallet.refused", "BNB out is refused");
  assert.equal(out.problem.more, "BNB Chain opens once ZeroFee has tested it with real money.");
  assert.equal(out.problem.whatHappened, "This wallet can't approve this, so ZeroFee said no.");
  const back = await mock.call("subwallet.float.in", { chain: "bsc", slot: 0, amount: "all", key: key() });
  assert.ok("problem" in back && back.problem.code === "security.subwallet.refused", "BNB in is refused");
  const sol = await mock.call("subwallet.float.out", { chain: "sol", slot: 0, amount: "100000000", key: key() });
  assert.ok("ok" in sol, "Solana still moves");
  const open = createMockBridge({ latencyMs: 0, tradeChains: ["bsc"], float: { moveMs: 50, startUsd: 50 } });
  const bnb = await open.call("subwallet.float.out", { chain: "bsc", slot: 0, amount: "10000000000000000", key: key() });
  assert.ok("ok" in bnb, "without the flag BNB moves");
});

test("trading wallets: up to five per chain by slot; asking again gives the same one", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const zero = await mock.call<{ id: string; slot: number }>("subwallet.create", { kind: "trade", chain: "sol" });
  assert.ok("ok" in zero && zero.ok.id === "sw-trade-sol" && zero.ok.slot === 0, "no slot means slot 0, the one already there");
  const two = await mock.call<{ id: string; slot: number }>("subwallet.create", { kind: "trade", chain: "sol", slot: 2 });
  assert.ok("ok" in two && two.ok.slot === 2 && two.ok.id !== "sw-trade-sol");
  const again = await mock.call<{ id: string }>("subwallet.create", { kind: "trade", chain: "sol", slot: 2 });
  assert.ok("ok" in again && again.ok.id === two.ok.id);
  const sixth = await mock.call("subwallet.create", { kind: "trade", chain: "sol", slot: 5 });
  assert.ok("problem" in sixth && sixth.problem.code === "security.request.invalid");
});

test("Trade's float: Add, out to a wallet, back in, and home; every move ends somewhere and the guard counts it", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10 } });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const money = async () => ((await mock.call<{ usd: number }>("subwallet.float.balance")) as { ok: { usd: number } }).ok.usd;
  await mock.call("ledger.toTrading", { amount: "50" });
  await wait(20);
  assert.equal(await money(), 50);
  // 0.1 SOL at the demo's $150 is $15, and 2 % on top leaves the float.
  const out = await mock.call<{ id: string; status: string; where: string }>("subwallet.float.out", { chain: "sol", slot: 0, amount: "100000000", key: key() });
  assert.ok("ok" in out);
  assert.deepEqual([out.ok.status, out.ok.where], ["pending", "in-flight"]);
  assert.equal(await money(), 34.7);
  await wait(25);
  const done = await mock.call<{ status: string; where: string }>("subwallet.float.move", { id: out.ok.id });
  assert.deepEqual("ok" in done && [done.ok.status, done.ok.where], ["done", "chain"]);
  const rows = await mock.call<{ amount: string }[]>("subwallet.balances", { id: "sw-trade-sol" });
  assert.ok("ok" in rows && rows.ok[0].amount === "100000000");
  const back = await mock.call<{ id: string }>("subwallet.float.in", { chain: "sol", slot: 0, amount: "all", key: key() });
  assert.ok("ok" in back);
  await wait(25);
  assert.equal(await money(), 49.4);
  const home = await mock.call<{ id: string }>("subwallet.float.home", { amount: "all", key: key() });
  assert.ok("ok" in home);
  await wait(25);
  const ended = await mock.call<{ status: string; where: string }>("subwallet.float.move", { id: home.ok.id });
  assert.deepEqual("ok" in ended && [ended.ok.status, ended.ok.where], ["done", "main"]);
  assert.deepEqual(await mock.call("subwallet.float.limits"), { ok: { movesLeftToday: 17, perDay: 20, minUsd: 2, open: ["sol", "hood", "bsc"] } });
  const moves = await mock.call<{ kind: string }[]>("subwallet.float.moves");
  assert.deepEqual("ok" in moves && moves.ok.map((m) => m.kind), ["home", "in", "out"]);
});

test("float.home done: the main USDC row is credited, a trading movement from 'trading' goes moving to done, and the float is down", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 5, startUsd: 50 } });
  type Row = { tokenId: string; held: string; amount: string };
  const rows0 = await mock.call<Row[]>("ledger.balances");
  assert.ok("ok" in rows0);
  const usdc0 = Number(rows0.ok.find((b) => b.held === "ledger" && b.tokenId.startsWith("nep141:17208628"))!.amount);
  const ended = new Promise<{ movement: { kind: string; status: string; from: string; amount: string } }>((r) => mock.on("ledger.movementUpdated", r));
  const home = await mock.call("subwallet.float.home", { amount: "10000000", key: key() });
  assert.ok("ok" in home);
  const e = await ended;
  assert.deepEqual([e.movement.kind, e.movement.status, e.movement.from, e.movement.amount], ["trading", "done", "trading", "9.8"]);
  const rows1 = await mock.call<Row[]>("ledger.balances");
  assert.ok("ok" in rows1);
  assert.ok(Math.abs(Number(rows1.ok.find((b) => b.held === "ledger" && b.tokenId.startsWith("nep141:17208628"))!.amount) - usdc0 - 9.8) < 1e-9);
  const bal = await mock.call<{ usd: number }>("subwallet.float.balance");
  assert.ok("ok" in bal && Math.abs(bal.ok.usd - 40) < 0.01);
});

test("float=empty, set-up $15, Take out All (robot pass 9): the main USDC row gains exactly what arrived, in coins and dollars, and Wallet's total with it", async () => {
  // The robot's numbers: Balance $5,643.15 → $4,402.65 and "USD Coin $120.10 · 1,360.061663 USDC" after a Take out that
  // landed 14.461663 USDC. The row's dollars came back with 6 decimals ("1239.961663"), which Wallet's total (cents)
  // read as no dollars at all.
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 5 } });
  type Row = Balance;
  const usdcRow = async () => {
    const r = await mock.call<Row[]>("ledger.balances");
    assert.ok("ok" in r);
    return { rows: r.ok, row: r.ok.find((b) => b.held === "ledger" && b.tokenId.startsWith("nep141:17208628"))! };
  };
  const wallet = (rows: Row[]) => lines(rows, []);
  const usdcLine = (rows: Row[]) => wallet(rows).lines.find((l) => l.key === "listed:USDC")!;
  const start = await usdcRow();
  assert.deepEqual([start.row.amount, start.row.usd, usdcLine(start.rows).amount, usdcLine(start.rows).usd], ["1240.5", "1240.5", "1360.6", "1360.60"]);
  // Set-up's $15 (Trade's Add: dollars to the cent).
  const add = await mock.call("ledger.toTrading", { amount: "15.00" });
  assert.ok("ok" in add);
  await new Promise((r) => setTimeout(r, 20));
  const set = await usdcRow();
  assert.deepEqual([set.row.amount, set.row.usd], ["1225.5", "1225.5"]);
  const before = wallet(set.rows).totalUsd;
  // Take out All: the float's $14.756799 goes home; 2% stays with the mock, 14.461663 USDC lands.
  const bal = await mock.call<{ usd: number }>("subwallet.float.balance");
  assert.ok("ok" in bal && bal.ok.usd === 15);
  const ended = new Promise<{ movement: { amount: string; status: string } }>((r) => mock.on("ledger.movementUpdated", (e) => { if ((e as { movement: { from: string } }).movement.from === "trading") r(e as never); }));
  const home = await mock.call("subwallet.float.home", { amount: "14756799", key: key() });
  assert.ok("ok" in home);
  const e = await ended;
  assert.deepEqual([e.movement.status, e.movement.amount], ["done", "14.461663"]);
  const after = await usdcRow();
  assert.equal(after.row.amount, "1239.961663", "1225.5 + 14.461663, exactly");
  assert.equal(after.row.usd, "1239.96", "the same amount at $1, to the cent: dollars Wallet can add up");
  assert.deepEqual([usdcLine(after.rows).amount, usdcLine(after.rows).usd], ["1360.061663", "1360.06"]);
  assert.equal(wallet(after.rows).totalUsd, plusUsd(before, "14.46"), "Balance goes up by what arrived, never down by the row");
  const place = (rows: Row[]) => wallet(rows).lines.findIndex((l) => l.key === "listed:USDC");
  assert.equal(place(after.rows), place(set.rows), "USD Coin keeps its place in the list, never dropped to the bottom");
});

test("Trade's float: under $2 is refused, more than it holds is short, and a refunded move comes back to the float", async () => {
  const mock = createMockBridge({ latencyMs: 0, float: { moveMs: 5, outcome: "refunded", startUsd: 20 } });
  const tiny = await mock.call("subwallet.float.out", { chain: "sol", slot: 0, amount: "1000000", key: key() });
  assert.ok("problem" in tiny && tiny.problem.code === "security.request.not-allowed");
  const big = await mock.call("subwallet.float.out", { chain: "sol", slot: 0, amount: "1000000000", key: key() });
  assert.ok("problem" in big && big.problem.code === "security.float.short");
  const out = await mock.call<{ id: string }>("subwallet.float.out", { chain: "sol", slot: 0, amount: "100000000", key: key() });
  assert.ok("ok" in out);
  await new Promise((r) => setTimeout(r, 20));
  const m = await mock.call<{ status: string; where: string }>("subwallet.float.move", { id: out.ok.id });
  assert.deepEqual("ok" in m && [m.ok.status, m.ok.where], ["refunded", "float"]);
  assert.deepEqual(await mock.call("subwallet.float.balance").then((r) => ("ok" in r ? (r.ok as { usd: number }).usd : null)), 20);
});

test("Trade's float at the recorded market: a $200 move to Solana costs $200 plus the 2 % fee, no more", async () => {
  const { RECORDED } = await import("../../trade/src/market/recorded-data.ts");
  const cg = RECORDED.nativeUsd as Record<string, { usd: number }>;
  const price = { sol: cg.solana!.usd, bsc: cg.binancecoin!.usd, hood: cg.ethereum!.usd };
  assert.deepEqual(price, { sol: 101.67, bsc: 744.17, hood: 2347.2 }, "the prices ?demo passes (Screens.tsx RECORDED_COIN_USD)");
  const mock = createMockBridge({ latencyMs: 0, float: { moveMs: 5, startUsd: 500, priceUsd: (c) => price[c] } });
  const money = async () => ((await mock.call<{ usd: number }>("subwallet.float.balance")) as { ok: { usd: number } }).ok.usd;
  const lamports = Math.floor((200 / price.sol) * 1e9);
  const out = await mock.call<{ usd: number }>("subwallet.float.out", { chain: "sol", slot: 0, amount: String(lamports), key: key() });
  assert.ok("ok" in out);
  assert.ok(Math.abs(out.ok.usd - 200) < 0.01);
  assert.ok(Math.abs((await money()) - (500 - 204)) < 0.01, "down by $200 plus 2 %");
});

test("ledger.toTrading (the Add): a trading movement from USDC, moving then done, heard on ledger.movementUpdated, and the float holds it", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5 });
  const ended = new Promise<{ movement: { id: string; status: string; kind: string } }>((r) => mock.on("ledger.movementUpdated", r));
  const m = await mock.call<{ id: string; kind: string; status: string; from: string; to: string; amount: string }>("ledger.toTrading", { amount: "10", label: "Add $10.00 to Trading" });
  assert.ok("ok" in m);
  assert.deepEqual([m.ok.kind, m.ok.status, m.ok.to, m.ok.amount, m.ok.from.startsWith("nep141:")], ["trading", "moving", "trading", "10", true], "the real ledger's shape: kind trading, to trading, dollars as text");
  const usdc = await mock.call<{ tokenId: string; held: string; amount: string; usd: string }[]>("ledger.balances");
  assert.ok("ok" in usdc);
  const row = usdc.ok.find((b) => b.tokenId === m.ok.from && b.held === "ledger")!;
  assert.deepEqual([row.amount, row.usd], ["1230.5", "1230.5"], "the main balance is down by the Add while it's on its way, as on chain");
  const e = await ended;
  assert.deepEqual([e.movement.id, e.movement.kind, e.movement.status], [m.ok.id, "trading", "done"]);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(await mock.call("subwallet.float.balance").then((r) => ("ok" in r ? (r.ok as { usd: number }).usd : null)), 10);
  const bad = await mock.call("ledger.toTrading", { amount: "ten" });
  assert.ok("problem" in bad && bad.problem.code === "ledger.request.invalid");
});

test("ledger.toTrading paid with another coin (fd3620a): that much of the coin leaves the main balance, Trading gets its dollars, Movement.from is the coin", async () => {
  const NEAR = "nep141:wrap.near";
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5 });
  const bal = async (id: string) => { const r = await mock.call<{ tokenId: string; held: string; amount: string; usd: string }[]>("ledger.balances"); assert.ok("ok" in r); return r.ok.find((b) => b.tokenId === id && b.held === "ledger")!; };
  const m = await mock.call<{ kind: string; from: string; to: string; amount: string }>("ledger.toTrading", { amount: "10", tokenId: NEAR });
  assert.ok("ok" in m);
  assert.deepEqual([m.ok.kind, m.ok.from, m.ok.to, m.ok.amount], ["trading", NEAR, "trading", "10"]);
  const near = await bal(NEAR);
  assert.equal(near.amount, "302.4", "10 NEAR left (312.4 - 10)");
  assert.equal(near.usd, "1339.63", "the row's dollars follow at the sample price 4.43");
  assert.equal((await bal(USDC_NEAR_ID)).amount, "1240.5", "USDC untouched");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await mock.call("subwallet.float.balance").then((r) => ("ok" in r ? (r.ok as { usd: number }).usd : null)), 44.3, "Trading got what 10 NEAR is worth: 10 x 4.43");
});

test("ledger.toTrading paid with NEAR on the account (tokenId \"near\"): balances lists it held \"account\"; the Add takes it from that row only, Trading gets its dollars", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5 });
  const rows = async () => { const r = await mock.call<{ tokenId: string; held: string; amount: string; usd: string; symbol: string; listed: boolean }[]>("ledger.balances"); assert.ok("ok" in r); return r.ok; };
  const own = (await rows()).filter((b) => b.tokenId === "near");
  assert.deepEqual(own.map((b) => [b.symbol, b.held, b.listed, b.amount, b.usd]), [["NEAR", "account", true, "12.5", "55.37"]], "the account's own NEAR, spendable, priced as wNEAR");
  const m = await mock.call<{ kind: string; from: string; to: string; amount: string }>("ledger.toTrading", { amount: "10", tokenId: "near" });
  assert.ok("ok" in m);
  assert.deepEqual([m.ok.kind, m.ok.from, m.ok.to, m.ok.amount], ["trading", "near", "trading", "10"]);
  const after = await rows();
  assert.equal(after.find((b) => b.tokenId === "near")!.amount, "2.5", "12.5 - 10");
  assert.equal(after.find((b) => b.tokenId === "nep141:wrap.near" && b.held === "ledger")!.amount, "312.4", "wNEAR in NEAR Intents untouched");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await mock.call("subwallet.float.balance").then((r) => ("ok" in r ? (r.ok as { usd: number }).usd : null)), 44.3, "10 NEAR at 4.43");
  const over = await mock.call("ledger.toTrading", { amount: "3", tokenId: "near" });
  assert.ok("problem" in over && over.problem.code === "ledger.balance.low", "more than the account's NEAR: refused");
  assert.equal((await rows()).find((b) => b.tokenId === "near")!.amount, "2.5", "nothing moved");
});

test("ledger.toTrading with too little of the coin: refused with ledger.balance.low, nothing moved", async () => {
  const NEAR = "nep141:wrap.near";
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5 });
  const bad = await mock.call("ledger.toTrading", { amount: "400", tokenId: NEAR });
  assert.ok("problem" in bad && bad.problem.code === "ledger.balance.low");
  const none = await mock.call("ledger.toTrading", { amount: "1", tokenId: "nep141:doge.omft.near" });
  assert.ok("problem" in none && none.problem.code === "ledger.balance.low", "a coin the balance doesn't hold");
  await new Promise((r) => setTimeout(r, 20));
  const r = await mock.call<{ tokenId: string; held: string; amount: string }[]>("ledger.balances");
  assert.ok("ok" in r);
  assert.equal(r.ok.find((b) => b.tokenId === NEAR && b.held === "ledger")!.amount, "312.4");
  assert.equal(r.ok.find((b) => b.tokenId === USDC_NEAR_ID && b.held === "ledger")!.amount, "1240.5");
  assert.equal(await mock.call("subwallet.float.balance").then((x) => ("ok" in x ? (x.ok as { usd: number }).usd : null)), 0);
  const act = await mock.call<unknown[]>("ledger.activity", {});
  assert.ok("ok" in act && !act.ok.some((x) => (x as { kind: string }).kind === "trading"), "no movement recorded");
});

test("ledger.toTrading with USDC as the tokenId is the dollars path, unchanged", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5 });
  const m = await mock.call<{ from: string }>("ledger.toTrading", { amount: "10", tokenId: USDC_NEAR_ID });
  assert.ok("ok" in m && m.ok.from === USDC_NEAR_ID);
  const r = await mock.call<{ tokenId: string; held: string; amount: string }[]>("ledger.balances");
  assert.ok("ok" in r);
  assert.equal(r.ok.find((b) => b.tokenId === USDC_NEAR_ID && b.held === "ledger")!.amount, "1230.5");
  assert.equal(r.ok.find((b) => b.tokenId === "nep141:wrap.near")!.amount, "312.4");
});

test("a held Add paid with NEAR: named with the coin; released it takes the NEAR and the float gets the dollars; cancelled nothing moves", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, holdSeconds: 0.01 });
  const usd = async () => ((await mock.call<{ usd: number }>("subwallet.float.balance")) as { ok: { usd: number } }).ok.usd;
  const nearAmount = async () => { const r = await mock.call<{ tokenId: string; held: string; amount: string }[]>("ledger.balances"); return "ok" in r ? r.ok.find((b) => b.tokenId === "nep141:wrap.near" && b.held === "ledger")!.amount : ""; };
  const start = await usd();
  const mv = await mock.call<{ held: { id: string } }>("ledger.toTrading", { amount: "10", tokenId: "nep141:wrap.near" });
  assert.ok("ok" in mv);
  assert.equal(await nearAmount(), "312.4", "held: nothing has left yet");
  const w = await mock.call<{ id: string; title: string }[]>("account.waiting");
  assert.ok("ok" in w && w.ok.some((x) => x.title === "Top up Spending with 10 NEAR"));
  await new Promise((r) => setTimeout(r, 20));
  await mock.call("account.waiting.run", { id: mv.ok.held.id });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(await nearAmount(), "302.4");
  assert.equal(await usd(), start + 44.3);
  const c = await mock.call<{ held: { id: string } }>("ledger.toTrading", { amount: "10", tokenId: "nep141:wrap.near" });
  assert.ok("ok" in c);
  await new Promise((r) => setTimeout(r, 20));
  await mock.call("account.waiting.cancel", { id: c.ok.held.id });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(await nearAmount(), "302.4");
  assert.equal(await usd(), start + 44.3);
});

test("a laptop added in the demo is the second device: its sheet, then \"ask my laptop above $X\" cut into today's bands as the core does", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const asked: { words: { title: string; lines: string[] }; id: string }[] = [];
  mock.on<{ id: string; words: { title: string; lines: string[] } }>("approval.needed", (a) => {
    asked.push(a);
    void mock.call("approval.answer", { id: a.id, approve: true });
  });
  const roles = async () => {
    const s = await mock.call<{ account: { keys: { role: string }[] } }>("account.state");
    return "ok" in s ? s.ok.account.keys.map((k) => k.role) : [];
  };
  const early = await mock.call("account.secondDevice.setLimit", { usd: 1000 });
  assert.ok("problem" in early && early.problem.code === "security.request.not-allowed", "not before a laptop is added");
  assert.ok("ok" in (await mock.call("account.protection.set", { bands: [{ upToUsd: 1000, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 86400 }] })));
  const paired = await mock.call<{ status: string }>("account.secondDevice.pair", { qr: SAMPLE_LAPTOP_CODE });
  assert.ok("ok" in paired && paired.ok.status === "done");
  assert.equal(asked[1].words.title, "Add a second device");
  assert.deepEqual(await roles(), ["device", "recovery", "agent", "second-device"]);
  assert.deepEqual(await roles(), ["device", "recovery", "agent", "second-device"], "added once");

  const out = await mock.call<{ status: string }>("account.secondDevice.setLimit", { usd: 500 });
  assert.ok("ok" in out && out.ok.status === "done");
  assert.equal(asked[2].words.title, "Save your protection rules");
  assert.deepEqual(asked[2].words.lines.slice(0, 3), ["Up to $500: Your yes", "Up to $1,000: Your yes and your second device", "Anything bigger: Your yes, a 1-day wait and your second device"], "QA sd-security (j): one form, the yes never dropped");
  const got = await mock.call<{ bands: { level: unknown }[] }>("account.protection.get");
  assert.ok("ok" in got);
  assert.deepEqual(got.ok.bands.map((b) => b.level), ["FaceId", "Device", { Both: { seconds: "86400" } }], "under $500 one tap; above it the laptop too, the wait kept");
  // Another mock starts without the laptop: each demo has its own account.
  assert.deepEqual(await (async () => { const s = await createMockBridge({ latencyMs: 0 }).call<{ account: { keys: { role: string }[] } }>("account.state"); return "ok" in s ? s.ok.account.keys.map((k) => k.role) : []; })(), ["device", "recovery", "agent"]);
});

test("a held Add to Trading is named as one; released it finishes and the float has it; cancelled nothing moves", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, holdSeconds: 0.01 });
  const usd = async () => ((await mock.call<{ usd: number }>("subwallet.float.balance")) as { ok: { usd: number } }).ok.usd;
  const start = await usd();
  const mv = await mock.call<{ held: { id: string } }>("ledger.toTrading", { amount: "25" });
  assert.ok("ok" in mv);
  const w = await mock.call<{ id: string; title: string }[]>("account.waiting");
  assert.ok("ok" in w && w.ok.some((x) => x.title === "Top up Spending with $25"));
  await new Promise((r) => setTimeout(r, 20));
  const updates: string[] = [];
  mock.on("ledger.movementUpdated", (e: { movement: { status: string } }) => updates.push(e.movement.status));
  await mock.call("account.waiting.run", { id: mv.ok.held.id });
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(updates, ["moving", "done"]);
  assert.equal(await usd(), start + 25);

  const c = await mock.call<{ held: { id: string } }>("ledger.toTrading", { amount: "10" });
  assert.ok("ok" in c);
  await new Promise((r) => setTimeout(r, 20));
  await mock.call("account.waiting.cancel", { id: c.ok.held.id });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(await usd(), start + 25);
});

test("Trade's float: \"all\" takes home every coin, a chain's coin a refund left included (the core's AUD-CORE-2), each saying what settled", async () => {
  const { createFloatMock, FLOAT_USDC } = await import("./mock-float.ts");
  const f = createFloatMock({ moveMs: 5 }, () => [], () => false);
  const s = f.snapshot();
  f.restore({ ...s, held: [[FLOAT_USDC, "20000000"], ["nep141:sol.omft.near", "100000000"]] });
  const k = key();
  const home = f.answer("subwallet.float.home", { amount: "all", key: k }) as { id: string; sent: { tokenId: string } };
  assert.equal(home.sent.tokenId, FLOAT_USDC, "the answer is the USDC move");
  assert.deepEqual((f.answer("subwallet.float.moves", {}) as { sent: { tokenId: string } }[]).map((m) => m.sent.tokenId).sort(), ["nep141:sol.omft.near", FLOAT_USDC].sort());
  assert.deepEqual((f.answer("subwallet.float.balance", {}) as { tokens: unknown[] }).tokens, []);
  assert.equal((f.answer("subwallet.float.home", { amount: "all", key: k }) as { id: string }).id, home.id, "the same key: the same move");
  await new Promise((r) => setTimeout(r, 30));
  const ended = f.answer("subwallet.float.moves", {}) as { status: string; settled?: { amountOut?: string } }[];
  assert.ok(ended.every((m) => m.status === "done" && m.settled?.amountOut), JSON.stringify(ended));
});

test("every Approve sheet raised from a money sheet says that sheet's words, once (audit 2 Nov, S1): Swap and Move (Add); never Top up, an app's echo, the 30 minutes, an Amount line, an address or a long coin figure", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const seen: { title: string; lines: string[]; hint?: string; amount?: string }[] = [];
  mock.on<{ id: string; words: { title: string; lines: string[]; hint?: string; amount?: string } }>("approval.needed", (p) => {
    seen.push(p.words);
    void mock.call("approval.answer", { id: p.id, approve: true });
  });
  const out = await mock.call("ledger.toTrading", { amount: "0.474", tokenId: "nep141:wrap.near", label: "Top up 0.474 NEAR" });
  assert.ok("ok" in out, JSON.stringify(out));
  const w = seen[0]!;
  assert.match(w.title, /^Swap \$2\.\d\d \(0\.474 NEAR\) for USDC$/);
  assert.deepEqual(w.lines, [`From your Safe. At least 2.05 USDC lands in Spending.`, "If the swap fails, it comes back to Spending."]);
  // Move (Home's Move, a site's Add): the same coin into Spending
  await mock.call("ledger.toTrading", { amount: "3", label: "Add $3.00 to your pump.fun wallet" });
  assert.match(seen[1]!.title, /^Move \$3\.00 \(3(\.00)? USDC\) to your NEAR wallet$/);
  assert.deepEqual(seen[1]!.lines, ["From your Safe."]);
  const GONE = [/Top up/, /says:/, /30 minutes/, /\d\.\d{5,}/, /Fee:/, /[1-9A-HJ-NP-Za-km-z]{4}…[1-9A-HJ-NP-Za-km-z]{4}/];
  for (const s of seen) {
    assert.equal(s.amount, undefined, "no Amount line: the amount is in the title once");
    assert.equal(s.hint, undefined, "no app's echo");
    for (const gone of GONE) assert.doesNotMatch([s.title, ...s.lines].join(" | "), gone);
  }
  // (Move to your Safe, a site's Take out, has no sheet since D143: a site wallet is a hot key and the money only goes
  // home. Its no-sheet run is the take-out test below.)
  // control: the guard catches the old Top up sheet's words
  assert.match("Top up Spending with $3.00 (3.00 USDC) | Trade says: Add $3.00", GONE[0]!);
});

test("ST13 sample: ?gmgnbnb gives GMGN a BNB wallet with $2.40 that Take out moves home; without it there is none, and any other non-Solana site wallet is still refused", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 10, sampleGmgnBnbUsd: 2.4, float: { priceUsd: (c) => ({ sol: 150, bsc: 744.17, hood: 3000 })[c] } });
  const list = await mock.call<{ id: string; site?: string; chain: string }[]>("subwallet.list", { kind: "site" });
  assert.ok("ok" in list && list.ok.some((w) => w.id === "sw-site-gmgn-bsc" && w.site === "gmgn" && w.chain === "bsc"));
  const bal = await mock.call<{ token: string; amount: string; decimals: number }[]>("subwallet.balances", { id: "sw-site-gmgn-bsc" });
  assert.ok("ok" in bal);
  const usd = (Number(BigInt(bal.ok.find((r) => r.token === "native")!.amount) / 10n ** 9n) / 1e9) * 744.17;
  assert.ok(Math.abs(usd - 2.4) < 0.01, `holds $2.40 of BNB (${usd})`);
  const m = await mock.call<{ id: string; usd: number; chain: string }>("subwallet.site.moveBack", { id: "sw-site-gmgn-bsc", amount: "all", key: "sweep-test-key-0001" });
  assert.ok("ok" in m && m.ok.chain === "bsc" && m.ok.usd > 2.3, JSON.stringify(m));
  // control: GMGN's Base wallet (made as the core makes it) is refused, as the core refuses it
  await mock.call("subwallet.create", { kind: "site", siteId: "gmgn", chain: "base" });
  const base = await mock.call("subwallet.site.moveBack", { id: "sw-site-gmgn-base", amount: "all", key: "sweep-test-key-0002" });
  assert.ok("problem" in base && base.problem.code === "security.subwallet.refused" && /on Solana/.test(base.problem.more ?? ""));
  const plain = createMockBridge({ latencyMs: 0 });
  const none = await plain.call<{ id: string }[]>("subwallet.list", { kind: "site" });
  assert.ok("ok" in none && !none.ok.some((w) => w.id === "sw-site-gmgn-bsc"), "the plain demo has no BNB wallet");
});

test("the demo's every-site-wallet take-out: one call runs every leg with no sheet (D143: hot keys, money only going home); only Wallet's own tap", async () => {
  const opts = { latencyMs: 0, settleMs: 10, sampleGmgnBnbUsd: 2.4, float: { priceUsd: (c: "sol" | "bsc" | "hood") => ({ sol: 150, bsc: 744.17, hood: 3000 })[c] } };
  const legs = [{ id: "sw-site-gmgn-bsc", amount: "all", key: "sweepall-test-key-01" }];
  const mock = createMockBridge(opts);
  const sheets: unknown[] = [];
  mock.on<{ id: string; words: unknown }>("approval.needed", (p) => (sheets.push(p.words), void mock.call("approval.answer", { id: p.id, approve: false })));
  // a site's page (Browser) can't drive it: refused, nothing moved
  const refused = await mock.call("subwallet.site.moveBackAll", { legs, app: "browser" });
  assert.ok("problem" in refused && refused.problem.code === "security.request.not-allowed", "only Wallet's own tap");
  // control: Wallet's own tap runs every leg (the whole $2.40 was still there), and no sheet is raised (every sheet here
  // would be answered no)
  const r = await mock.call<{ id: string; move?: unknown }[]>("subwallet.site.moveBackAll", { legs, app: "wallet" });
  assert.ok("ok" in r && Array.isArray(r.ok) && r.ok.length === 1 && r.ok[0]!.move, JSON.stringify(r));
  assert.equal(sheets.length, 0, "no sheet for a take-out");
});

test("QA gate (3 Nov): Swap from Hidden, $25 of USDC → SOL in the demo: the quote's in-amount is USDC at the two prices (never the SOL out-figure), and the sheet says $25.00 from Hidden with the promise in SOL; no Safe, no Spending, no address (control: the old figure was 0.2469)", async () => {
  const mock = createMockBridge({ latencyMs: 0, hiddenStart: { usdc: "33.86", near: "0" } });
  const tokens = await mock.call<{ assetId: string; symbol: string; chain: string; priceUsd?: string }[]>("ledger.tokens");
  const sol = "ok" in tokens ? tokens.ok.find((t) => t.chain === "sol" && t.symbol === "SOL") : undefined;
  assert.ok(sol?.priceUsd, "the demo prices SOL");
  const out = (25 / Number(sol!.priceUsd)).toFixed(8);
  const q = await mock.call<{ id: string; amountIn: string; amountOut: string }>("ledger.quotePay", { fromTokenId: USDC_NEAR_ID, toTokenId: sol!.assetId, to: { kind: "chain", chain: "sol", address: "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM" }, amountOut: out, confidential: true });
  assert.ok("ok" in q);
  assert.ok(Math.abs(Number(q.ok.amountIn) - 25) < 0.01, `in-amount ${q.ok.amountIn} USDC, not the SOL figure ${out}`);
  assert.notEqual(q.ok.amountIn, q.ok.amountOut, "in and out are different fields");
  const seen: { title: string; lines: string[] }[] = [];
  mock.on<{ id: string; words: { title: string; lines: string[] } }>("approval.needed", (p) => { seen.push(p.words); void mock.call("approval.answer", { id: p.id, approve: true }); });
  const paid = await mock.call("ledger.pay", { quoteId: q.ok.id, confidential: true });
  assert.ok("ok" in paid, JSON.stringify(paid));
  const w = seen.at(-1)!;
  assert.match(w.title, /^Pay \$25\.00 .*from Private$/);
  assert.ok(w.lines.includes("It's paid from Private."));
  assert.match(w.lines[0]!, /promises at least 0\.2457\d* SOL to your SOL row\.$/);
  const all = [w.title, ...w.lines].join(" ");
  assert.ok(!/Safe|Spending|T3550|Details/.test(all), all);
  const pocket = await mock.call<{ rows: { tokenId: string; amount: string }[] }>("ledger.private");
  const left = "ok" in pocket ? Number(pocket.ok.rows.find((r) => r.tokenId === USDC_NEAR_ID)?.amount) : NaN;
  assert.ok(Math.abs(left - 8.86) < 0.02, `Hidden pays it: ${left} USDC left of 33.86`);
});

// QA's SHOULD (5 Nov): the Sim shows the core's outside-send sheet, so crawls see the step. A wallet's Send to
// an address that isn't one of the person's own asks (title, the full address, what they get, the fee); to their own
// wallet it goes on the tap. And Send's fee before the tap (ledger.sendFee) answers the sample's figure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "./MockBridge.ts";

const STRANGER = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";

test("the Sim: a wallet's Send to an outside address shows the outside sheet; a no sends nothing; to the person's own wallet, no sheet", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 10 });
  const seen: { id: string; words: { title: string; lines: string[] } }[] = [];
  let yes = false;
  mock.on<{ id: string; words: { title: string; lines: string[] } }>("approval.needed", (p) => { seen.push(p); void mock.call("approval.answer", { id: p.id, approve: yes }); });
  const send = (address: string) => mock.call("ledger.hiddenFromRow", { app: "wallet", chain: "sol", to: { kind: "chain", chain: "sol", address }, toTokenId: "nep141:sol.omft.near", amountIn: "0.03" });
  const no = await send(STRANGER);
  assert.ok("problem" in no && no.problem.code === "ledger.signature.declined", "declined: nothing sent");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.words.title, "Send from your SOL wallet");
  assert.equal(seen[0]!.words.lines[0], `To ${STRANGER}`, "the full address");
  assert.match(seen[0]!.words.lines[2] ?? "", /^Network fees · about \$\d+\.\d\d$/);
  yes = true;
  const went = await send(STRANGER);
  assert.ok(!("problem" in went && went.problem.code === "ledger.signature.declined"), "a yes goes on to the send (the Sim's empty wallet may then say it's short)");
  // control: the person's own other wallet (one the Sim made), no sheet
  const own = (await mock.call<{ kind: string; chain: string; address: string }[]>("subwallet.list")) as { ok?: { kind: string; chain: string; address: string }[] };
  const mine = own.ok?.find((w) => w.chain === "sol" && w.kind !== "trade")?.address ?? own.ok?.find((w) => w.chain === "sol")?.address;
  assert.ok(mine, "the Sim has a Solana wallet of the person's own");
  const before = seen.length;
  await send(mine!);
  assert.equal(seen.length, before, "their own wallet: no sheet");
});

test("the Sim: Send's fee before the tap is the sample's figure; nothing for a token or no amount", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const f = await mock.call<{ inUsd: string; outUsd: string } | null>("ledger.sendFee", { chain: "sol", to: { kind: "chain", chain: "sol", address: STRANGER }, amountIn: "0.03" });
  assert.ok("ok" in f && f.ok && Number(f.ok.outUsd) < Number(f.ok.inUsd));
  for (const p of [{ amountIn: "0" }, { amountIn: "1", coin: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near" }]) {
    const r = await mock.call("ledger.sendFee", { chain: "sol", to: { kind: "chain", chain: "sol", address: STRANGER }, ...p });
    assert.equal("ok" in r && r.ok, null, JSON.stringify(p));
  }
});

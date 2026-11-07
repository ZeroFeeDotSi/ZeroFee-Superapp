// the audit's way-home audit P2 (7 Nov): Private holds USDC $25.00 and NEAR $8.86, NEAR's quote is refused after USDC was
// signed and remembered: the job failed "NEAR Intents said no. Nothing moved." while $25.00 was on its way to the Safe.
// Now the refusal names what went and where the rest is. Fails on main: the core's words as they are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPrivate, homePartWent } from "./private-pay.ts";

const USDC = "nep141:usdc", NEAR = "nep141:wrap.near", ZEC = "nep141:zec";
const no = (state: "safe" | "unknown" = "safe") => ({ problem: { code: "ledger.private.refused", whatHappened: "NEAR Intents said no. Nothing moved.", money: { state, where: "in Private" }, next: { kind: "nothing" } } }) as never;
function rig(refuse: string, state: "safe" | "unknown" = "safe") {
  const kept: unknown[] = [];
  const x = {
    rows: [{ tokenId: USDC, amount: "25", symbol: "USDC", usd: "25.00" }, { tokenId: NEAR, amount: "2", symbol: "NEAR", usd: "8.86" }, { tokenId: ZEC, amount: "0.1", symbol: "ZEC", usd: "4.00" }],
    home: async (t: string) => (t === refuse ? no(state) : ({ ok: { id: `pm-${t.slice(-4)}`, status: "pending" } } as never)),
    status: () => "moving" as const, remember: async (m: unknown) => void kept.push(m), emit: () => {}, iso: () => "2026-11-08T00:00:00.000Z",
  };
  return { x, kept };
}
const problemOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as { problem: { code: string; whatHappened: string; money: { state: string }; next: { label?: string } } }).problem; } throw new Error("no refusal"); };

test("P2: USDC went, NEAR refused: never \"Nothing moved.\"; it names what went, what is still in Private, and why [before: the core's words]", async () => {
  const { x, kept } = rig(NEAR);
  const p = await problemOf(fromPrivate({}, "wallet", x));
  assert.equal(p.whatHappened, "$25.00 of USDC is on its way to your Safe. NEAR and ZEC are still in Private. NEAR Intents said no.");
  assert.doesNotMatch(p.whatHappened, /Nothing moved/);
  assert.equal(p.code, "ledger.private.home.part-went");
  assert.equal(p.money.state, "on-the-way");
  assert.equal(p.next.label, "Open Activity");
  assert.equal(kept.length, 1, "the coin that went stays remembered (its Activity row)");
});

test("P2: an unsure refusal never says where the rest is: Check Activity; two went; part of a coin by its own dollars", async () => {
  const { x } = rig(ZEC, "unknown");
  assert.equal((await problemOf(fromPrivate({}, "wallet", x))).whatHappened, "$25.00 of USDC and $8.86 of NEAR are on its way to your Safe. Check Activity for where this is. NEAR Intents said no.");
  const part = rig(NEAR);
  const p = await problemOf(fromPrivate({ upTo: { [USDC]: "10", [NEAR]: "2" } }, "wallet", { ...part.x, decimals: () => 0 }));
  assert.match(p.whatHappened, /^\$10\.00 of USDC is on its way to your Safe\. NEAR is still in Private\./);
});

test("P2 controls: the first coin refused: the core's own words, nothing moved; all went: no refusal", async () => {
  const first = rig(USDC);
  const p = await problemOf(fromPrivate({}, "wallet", first.x));
  assert.equal(p.whatHappened, "NEAR Intents said no. Nothing moved.");
  assert.equal(first.kept.length, 0);
  const all = rig("none");
  assert.equal((await fromPrivate({}, "wallet", all.x)).length, 3);
  assert.equal(homePartWent({ code: "x", whatHappened: "No price. Nothing was sent.", money: { state: "safe", where: "" }, next: { kind: "nothing" } }, ["5 USDC"], []).whatHappened, "5 USDC is on its way to your Safe. No price.", "no coin left: no rest line");
});

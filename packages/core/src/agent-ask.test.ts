// "Ask me above $X" (FLOW-V5 §5 item 1): over it, AgentZero's key doesn't pay; asking less often needs the core's sheet
// (and on the web D103's check); asking more often works at once. Each rule with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ASK_FIRST_CODE, askFirst, readAskAbove, setAskAbove } from "./agent-private.ts";
import { AGENT_USDC } from "./agent-route.ts";
import { MemoryVault } from "./vault.ts";

const USDC = { Ledger: { token_id: AGENT_USDC.replace(/^nep141:/, "") } };
const usd = (n: number) => String(Math.round(n * 1e6));
const asked = (re: RegExp) => (e: any) => e?.problem?.code === ASK_FIRST_CODE && re.test(String(e.problem.more));

function rig(answer = true) {
  const vault = new MemoryVault();
  const sheets: { title: string; lines: string[] }[] = [];
  let checks = 0;
  const d = { vault, approve: async (w: { title: string; lines: string[] }) => (sheets.push(w), answer), strong: async () => void checks++ };
  return { vault, sheets, d, checks: () => checks };
}

test("none set: AgentZero pays within its pocket money without asking (the chain's limit is the hard one)", async () => {
  const { vault } = rig();
  assert.equal(await readAskAbove(vault), null);
  await askFirst(vault, USDC, usd(500));
});

test("above $5: $5.00 pays, $5.01 asks first by name; $0 asks for every payment; a coin it can't price asks", async () => {
  const { vault, d } = rig();
  await setAskAbove(5, d);
  await askFirst(vault, USDC, usd(5));
  await assert.rejects(askFirst(vault, USDC, usd(5.01)), asked(/^It's over your \$5\. AgentZero asks you first\.$/));
  await assert.rejects(askFirst(vault, { Ledger: { token_id: "wrap.near" } }, "1"), asked(/over your \$5/));
  await setAskAbove(0, d);
  await assert.rejects(askFirst(vault, USDC, usd(0.01)), asked(/^AgentZero asks you first for every payment\.$/));
});

test("asking more often (lower, or from none) works at once with no sheet; asking less often (higher, or never) needs the sheet and the web's user check", async () => {
  const r = rig();
  assert.deepEqual(await setAskAbove(20, r.d), { askAboveUsd: 20 }, "from none: tighter");
  assert.deepEqual(await setAskAbove(5, r.d), { askAboveUsd: 5 });
  assert.equal(r.sheets.length, 0);
  assert.equal(r.checks(), 0);
  assert.deepEqual(await setAskAbove(20, r.d), { askAboveUsd: 20 });
  assert.equal(r.sheets.at(-1)!.title, "Let AgentZero pay more without asking");
  assert.deepEqual(r.sheets.at(-1)!.lines, ["AgentZero pays up to $20 without asking you.", "Above that, it asks you first."]);
  assert.deepEqual(await setAskAbove(null, r.d), { askAboveUsd: null });
  assert.equal(r.sheets.length, 2);
  assert.equal(r.checks(), 2);
  // a no on the sheet changes nothing
  const no = rig(false);
  await setAskAbove(1, no.d);
  assert.deepEqual(await setAskAbove(50, no.d), { declined: true });
  assert.equal(await readAskAbove(no.vault), 1);
  // the web's check refusing stops it before any sheet
  const web = rig();
  await setAskAbove(1, web.d);
  await assert.rejects(setAskAbove(9, { ...web.d, strong: async () => { throw new Error("no user check"); } }));
  assert.equal(web.sheets.length, 0);
  assert.equal(await readAskAbove(web.vault), 1);
});

test("only $0 to $1,000, or none", async () => {
  const { d } = rig();
  for (const bad of [-1, 1001, Number.NaN, "x", Number.POSITIVE_INFINITY]) await assert.rejects(setAskAbove(bad, d), (e: any) => e.problem.code === "security.request.invalid", String(bad));
});

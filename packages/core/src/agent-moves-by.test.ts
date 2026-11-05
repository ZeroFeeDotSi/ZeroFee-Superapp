// F5 (QA): only a move AgentZero's act door started is ever marked AgentZero's. The act door gets its wallets through
// actWallets (agent-pocket.ts), which marks each float move by its key before it runs; Trade's own calls and the
// person's Add never are. Controls both ways, on a real SubWallets and its float record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actWallets } from "./agent-pocket.ts";
import { FLOAT_USDC } from "./float-moves.ts";
import { utf8 } from "./sol/bytes.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";

const at = "2026-11-03T03:00:00.000Z";
const move = (id: string, kind: string) => ({ key: id.replace(/^f[ma]-/, ""), fields: "", move: { id, kind, status: "pending", where: "float", sent: { tokenId: FLOAT_USDC, amount: "1000000" }, expected: { tokenId: FLOAT_USDC, amount: "1" }, usd: 1, startedAtIso: at, updatedAtIso: at } });

test("F5: the act door's float moves say AgentZero; Trade's own move and the person's Add never do", async () => {
  const vault = new MemoryVault();
  const w = new SubWallets({ vault, sol: {} as never, evm: {} as never, usdPrice: async () => 150, approve: async () => true, emit: () => {} });
  await vault.put("float-move-log", utf8(JSON.stringify({ base: {}, kept: [move("fm-act-000000000001", "out"), move("fm-trade-0000000001", "out"), move("fa-add-00000000001", "in"), move("fm-act-000000000002", "home"), move("fm-act-000000000002-sol", "home")] })));
  const door = actWallets(w as never) as unknown as SubWallets;
  // the act door's calls (each refused later here: no relay; the mark comes first, from the door alone)
  await door.floatOut("sol", undefined, "1", "act-000000000001").catch(() => undefined);
  await door.floatHome("1000000", "act-000000000002").catch(() => undefined);
  // control: Trade's own call through SubWallets itself, with a key of the same shape
  await w.floatOut("sol", undefined, "1", "trade-0000000001").catch(() => undefined);
  const by = Object.fromEntries((await w.floatMoveList()).map((m) => [m.id, m.by ?? "person"]));
  assert.deepEqual(by, { "fm-act-000000000001": "agentzero", "fm-act-000000000002": "agentzero", "fm-act-000000000002-sol": "agentzero", "fm-trade-0000000001": "person", "fa-add-00000000001": "person" });
  assert.equal((await w.floatMove("fm-trade-0000000001")).by, undefined);
  assert.equal((await w.floatMove("fm-act-000000000001")).by, "agentzero");
});

test("F5: the act door is handed actWallets (and nothing else marks a move)", () => {
  const src = readFileSync(new URL("./agent-pocket.ts", import.meta.url), "utf8");
  assert.match(src, /k\.actCall\(method, p, \{[^}]*wallets: actWallets\(c\.wallets/);
  const callers = [...readFileSync(new URL("./subwallets.ts", import.meta.url), "utf8").matchAll(/markAgentMove\(/g)].length;
  assert.equal(callers, 1, "SubWallets only defines it");
});

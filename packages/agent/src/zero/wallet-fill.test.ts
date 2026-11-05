// The fill's only start (wallet-fill.ts, D143): the person's own tap. A fill without a trusted tap asks the core
// nothing; with one, a one-time ticket for that amount, then the fill. No chat tool, job, routine or act can reach the
// core's wallet door: the only AgentZero file that names it is wallet-fill.ts. Controls: let a chat or engine file name
// the door, or accept any tap, and these go red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { CHAT_TOOLS } from "../chat/tools.ts";
import { fillOnTap, fillTap } from "./wallet-fill.ts";

function bridge() {
  const calls: { method: string; p: Record<string, unknown> }[] = [];
  const b: Bridge = {
    async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      calls.push({ method, p });
      if (p.do === "ticket") return { ok: { ticket: "t".repeat(32) } as T };
      return { ok: { id: "fm-1" } as T };
    },
    on: () => () => {},
  };
  return { b, calls };
}

test("no trusted tap, no fill: the core is asked nothing", async () => {
  const { b, calls } = bridge();
  const r = await fillOnTap(b, { isTrusted: true, type: "click" }, "20000000", "fill-key-0000000001");
  assert.ok("problem" in r);
  assert.equal(calls.length, 0);
  assert.equal(fillTap({ isTrusted: true }, "20000000"), false, "a plain object is never a tap");
});

test("on the person's tap: a ticket for exactly that amount, then the fill with it", async () => {
  const { b, calls } = bridge();
  await fillOnTap(b, {}, "20000000", "fill-key-0000000002", () => true);
  assert.deepEqual(calls, [
    { method: "account.agent.wallet", p: { do: "ticket", amount: "20000000" } },
    { method: "account.agent.wallet", p: { do: "fill", from: "near", amount: "20000000", key: "fill-key-0000000002", ticket: "t".repeat(32) } },
  ]);
});

/** Every .ts/.tsx file under `dir`, tests aside. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

test("no chat tool, job, routine or act reaches the core's wallet door: only wallet-fill.ts names it, and no tool fills", () => {
  const root = new URL("..", import.meta.url).pathname;
  const naming = files(root).filter((f) => readFileSync(f, "utf8").includes("account.agent.wallet"));
  assert.deepEqual(naming.map((f) => f.slice(root.length)), ["zero/wallet-fill.ts"]);
  assert.ok(!CHAT_TOOLS.some((t) => /fill|fund|add money|top.?up/i.test(t.name)), "no tool fills AgentZero");
});

// QA 4 Nov (k-agentzero, 8716bd731): "Add $2.90" read "This part of the app isn't ready yet." three times, no sheet. The
// the test's account runs release 9 (no Agent), and the fill's check went through the Safe's contract (agentStrong →
// modulesSigner). Add money → AgentZero end to end, on the core's real door: the screen's tap, the ticket, the fill, the
// core's own sheet. Control: put agentStrong back on the wallet door and the first test goes red (the rules are read).
async function door(o: { verified?: boolean; phone?: boolean } = {}) {
  const [{ agentCall }, { SubWallets }, { MemoryVault }, { HOT_ROOT, hotRoot }, { agentNear }, { ProblemError }, { securityProblems }] = await Promise.all([
    import("@zerofee/core/agent-door"), import("@zerofee/core/subwallets"), import("@zerofee/core/vault"), import("@zerofee/core/hot-keys"),
    import("@zerofee/core/testing/agent-near"), import("@zerofee/core/problem"), import("@zerofee/core/security-problems"),
  ]);
  const vault = new MemoryVault();
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(5)));
  const sheets: { title: string }[] = [];
  const w = new SubWallets({ vault, sol: {}, evm: {}, approve: async (words: { title: string }) => (sheets.push(words), false), emit: () => {}, agentWallet: { on: true, proof: true } } as never);
  const seen = { rules: 0, verified: 0 };
  const ctx = {
    chain: agentNear({ exists: false }).chain, vault, subwallets: w, nativeSheet: o.phone ? async () => true : undefined,
    userVerified: o.phone ? undefined : async () => (seen.verified++, o.verified ?? true),
    relayBase: undefined, mailOpt: undefined, quoter: {}, quoteKey: undefined, oneClick: {}, approveOnSheet: async () => false, nativeUsd: async () => null,
    ready: async () => ({}), noteMine: () => {}, cancelWaiting: async () => ({}), stopped: () => false,
    // the test's account: release 9, no Agent (known-contracts withoutModules)
    modulesSigner: async () => { seen.rules++; throw new ProblemError(securityProblems.methodUnknown("This account's rules don't have AgentZero.")); },
  };
  const b: Bridge = {
    async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      try {
        return { ok: (await agentCall(ctx as never, method, p)) as T };
      } catch (e) {
        if (e instanceof ProblemError) return { problem: e.problem } as BridgeResult<T>;
        throw e;
      }
    },
    on: () => () => {},
  };
  return { b, sheets, seen };
}

test("Add $2.90 on a release-9 account (QA 4 Nov): the person's check, then the core's own Fund AgentZero sheet; the Safe's rules are never read", async () => {
  const { b, sheets, seen } = await door();
  const r = await fillOnTap(b, {}, "2900000", "fill-key-0000000010", () => true);
  assert.deepEqual(r, { ok: { declined: true } }, "the sheet opened and the person said no");
  assert.deepEqual(sheets.map((s) => s.title), ["Fund AgentZero's wallet"]);
  assert.deepEqual(seen, { rules: 0, verified: 1 });
  // on the phone the sheet is Face ID: no second check
  const phone = await door({ phone: true });
  assert.deepEqual(await fillOnTap(phone.b, {}, "2900000", "fill-key-0000000011", () => true), { ok: { declined: true } });
  assert.deepEqual([phone.sheets.length, phone.seen.rules, phone.seen.verified], [1, 0, 0]);
});

test("control: no fresh check of the person in a browser, no sheet and nothing moves (D103 still holds for the fill)", async () => {
  const { LOOSEN_FROM_PHONE } = await import("@zerofee/core/agent-private");
  const { b, sheets, seen } = await door({ verified: false });
  const r = await fillOnTap(b, {}, "2900000", "fill-key-0000000012", () => true);
  assert.ok("problem" in r);
  assert.equal(r.problem.more, LOOSEN_FROM_PHONE);
  assert.notEqual(r.problem.code, "security.method.unknown", "never the 'isn't ready yet' line");
  assert.deepEqual([sheets.length, seen.rules], [0, 0]);
});

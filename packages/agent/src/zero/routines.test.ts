// A-2, routines in plain words: read on this device (never by a model), shown back word for word, refused by name when
// they can't be bounded, and run by the engine's tick once per period under the act door (never from the Safe).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { readJob } from "./rulebox.ts";
import { RUNS_WHEN_OPEN, TELL_ONLY, readRoutine, routineDry, routineLines, routineScope, type RoutineTerms } from "./routines.ts";
import { KEYS, zeroEngine } from "./engine.ts";

const routineOf = (words: string): RoutineTerms => {
  const r = readRoutine(words);
  assert.ok(r && r.kind === "routine", `${words} → ${JSON.stringify(r)}`);
  return r.terms;
};
const cannot = (words: string, re: RegExp) => {
  const r = readRoutine(words);
  assert.ok(r && r.kind === "cannot" && re.test(r.line), `${words} → ${JSON.stringify(r)}`);
};

test("the plan's three examples round-trip into routines and are shown back word for word", async () => {
  const fri = routineOf("every Friday move profits above $100 to my Safe");
  assert.deepEqual([fri.when, fri.do, fri.limitUsd], [{ every: "week", day: 5 }, { act: "move", from: "spending", to: "safe", aboveUsd: 100 }, 50]);
  assert.deepEqual(routineLines(fri), [
    'You said: "every Friday move profits above $100 to my Safe"',
    "Here's what I'd do:",
    "1. Every Friday: AgentZero moves what's above $100 in your NEAR wallet to your Safe, at most $50 each time.",
    "1 step, $50 most each time.",
    "Never takes from your Safe.",
    "After today, AgentZero asks you to approve it again on the day.",
    RUNS_WHEN_OPEN,
  ]);
  const sol = routineOf("if SOL drops 20% tell me");
  assert.deepEqual([sol.when, sol.do, sol.limitUsd], [{ price: "SOL", dropPct: 20 }, { act: "tell" }, 0]);
  assert.deepEqual(routineLines(sol), ['You said: "if SOL drops 20% tell me"', "When SOL falls 20%: I'll only tell you. Nothing moves.", RUNS_WHEN_OPEN]);
  // "pay rent on the 1st" is a routine with nothing to bound it: it says what's missing.
  cannot("pay rent on the 1st", /Say who gets it and how much/);
  const rent = routineOf("pay $800 to kim.near on the 1st");
  assert.deepEqual([rent.when, rent.do], [{ every: "month", day: 1 }, { act: "pay", to: "kim.near", usd: 800 }]);
  assert.match(routineLines(rent)[2]!, /reminds you to pay \$800 to kim\.near\. You pay it with a tap\./);
  // Read by our own code: no model is asked (a fetch that would throw is never called).
  let asked = 0;
  const res = await readJob("every Friday move profits above $100 to my Safe", { relayBase: "https://relay.test", fetch: (async () => (asked++, { ok: false, status: 500, json: async () => ({}) })) as never, token: "t" });
  assert.equal(res.reading.kind, "routine");
  assert.equal(asked, 0);
  assert.equal(readRoutine("copy this wallet on pump.fun"), null, "control: not a routine, read as before");
});

test("anything it can't bound is refused by name", () => {
  cannot("every Friday move all my money to my Safe", /never moves all your money/);
  cannot("every Friday move money to my Safe", /Say how much to move/);
  cannot("every Monday move $500 to my Safe", /at most \$50 each time/);
  cannot("pay $5 every Monday", /Say who gets it and how much/);
  cannot("on the 31st pay $5 to kim.near", /1st to the 28th/);
  cannot("if SOL drops 20% move $5 to my Safe", /can only tell you/);
  cannot("every Friday buy BONK", /can tell you, move money from your NEAR wallet to your Safe, or remind you/);
});

test("a moving routine's one approval is the act door's scope: moves from Spending only, at most its limit, for today", () => {
  assert.deepEqual(routineScope(routineOf("every Friday move profits above $100 to my Safe")), { kinds: ["move"], places: ["spending"], payees: [], dayUsd: 50, minutes: 1440 });
  assert.equal(routineScope(routineOf("if SOL drops 20% tell me")), null, "a tell routine asks for nothing");
});

/** A fake core and device: what the engine asks for, and every act it sends. */
function world(o: { spendingUsd?: number; solPrice?: () => number; agentOn?: () => boolean; declineScope?: boolean } = {}) {
  const store = new Map<string, string>();
  const acts: Record<string, unknown>[] = [];
  const scopes: unknown[] = [];
  const bridge: Bridge = {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      const ok = (v: unknown) => ({ ok: v as T });
      switch (method) {
        case "device.store.get":
          return ok({ value: store.get(String(params.key)) ?? null });
        case "device.store.set":
          store.set(String(params.key), String(params.value));
          return ok({});
        case "account.agent.view":
          return ok(o.agentOn && !o.agentOn() ? null : { limitUsd: 20, spentTodayUsd: "0", sample: true, people: [] });
        case "spending.status":
          return ok({ loaded: true, totalUsd: String(o.spendingUsd ?? 160) });
        case "ledger.tokens":
          return ok([{ assetId: "nep141:sol.omft.near", priceUsd: String(o.solPrice ? o.solPrice() : 150) }]);
        case "account.agent.actScope":
          scopes.push(params.set);
          return ok(o.declineScope ? { declined: true } : { scope: params.set });
        case "account.agent.act":
          acts.push(params);
          return ok({ line: `Moved $${params.usd} from Spending to your Safe.`, usd: params.usd, done: {} });
        default:
          return { problem: { code: "test.unknown", whatHappened: method, money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } } as BridgeResult<T>;
      }
    },
    on: () => () => {},
  };
  return { bridge, store, acts, scopes };
}

const FRI = Date.parse("2026-11-06T10:00:00"); // a Friday

test("a weekly move runs on its day, once in its week, through the act door from Spending, never from the Safe; Stop ends it", async () => {
  let t = FRI;
  const w = world({ spendingUsd: 160 });
  const e = zeroEngine(w.bridge, { now: () => t });
  assert.deepEqual(await e.startRoutine(routineOf("every Friday move profits above $100 to my Safe")), { ok: true, line: "Your routine is on." });
  assert.equal(w.scopes.length, 1, "one approval: the act door's scope sheet");
  assert.equal(await e.runRoutines(), 1);
  assert.equal(w.acts.length, 1);
  assert.deepEqual([w.acts[0]!.kind, w.acts[0]!.from, w.acts[0]!.to, w.acts[0]!.usd], ["move", "spending", "safe", 50], "what's above $100 ($60), at most $50");
  assert.ok(w.acts.every((a) => a.from !== "safe"), "never from the Safe");
  t = FRI + 3 * 3_600_000;
  assert.equal(await e.runRoutines(), 0, "once in its week");
  t = FRI + 7 * 86_400_000;
  assert.equal(await e.runRoutines(), 1, "the next Friday again");
  assert.equal(w.acts.length, 2);
  const id = (JSON.parse(w.store.get(KEYS.routines)!) as { id: string }[])[0]!.id;
  await e.stopRoutine(id);
  t = FRI + 14 * 86_400_000;
  assert.equal(await e.runRoutines(), 0, "Stop ends it");
  assert.equal(w.acts.length, 2);
});

test("a moving routine starts only with its approval; a no starts nothing", async () => {
  const w = world({ declineScope: true });
  const e = zeroEngine(w.bridge, { now: () => FRI });
  assert.deepEqual(await e.startRoutine(routineOf("every Friday move $20 to my Safe")), { ok: false, line: "You said no. Nothing changed." });
  assert.equal(w.store.get(KEYS.routines) ?? "[]", "[]");
});

test("a price routine tells once when the price falls its drop from where it started, then measures from the new price; nothing moves", async () => {
  let price = 150;
  const w = world({ solPrice: () => price });
  const e = zeroEngine(w.bridge, { now: () => FRI });
  await e.startRoutine(routineOf("if SOL drops 20% tell me"));
  price = 125;
  assert.equal(await e.runRoutines(), 0, "down 17%: not yet");
  price = 120;
  assert.equal(await e.runRoutines(), 1);
  assert.match(e.snapshot().receipts[0]!.why.join(" "), /SOL fell 20%: from \$150 to \$120\./);
  assert.equal(await e.runRoutines(), 0, "measured from $120 now");
  assert.equal(w.acts.length, 0, "a tell routine moves nothing");
});

test("with AgentZero off, no routine runs", async () => {
  let on = true;
  const w = world({ agentOn: () => on });
  const e = zeroEngine(w.bridge, { now: () => FRI });
  await e.startRoutine(routineOf("every Friday move $20 to my Safe"));
  on = false;
  assert.equal(await e.runRoutines(), 0);
  assert.equal(w.acts.length, 0);
});

test("A-12 in routines: the routine's sheet carries its dry run, the most it costs equal to its limit; a tell routine has no money line", () => {
  const fri = routineOf("every Friday move profits above $100 to my Safe");
  const dry = routineDry(fri)!;
  assert.equal(dry.mostUsd, routineScope(fri)!.dayUsd, "the dry run's most is the scope's limit");
  assert.ok(dry.canApprove);
  for (const l of dry.lines) assert.ok(routineLines(fri).includes(l), l);
  const rent = routineOf("pay $800 to kim.near on the 1st");
  assert.equal(routineDry(rent)!.mostUsd, 800);
  assert.ok(routineLines(rent).includes("Never without your tap."));
  const sol = routineOf("if SOL drops 20% tell me");
  assert.equal(routineDry(sol), null);
  assert.ok(routineLines(sol).some((l) => l.endsWith(TELL_ONLY)));
  assert.ok(!routineLines(sol).some((l) => /\$|most|Here's what I'd do/.test(l)), "no money line");
});

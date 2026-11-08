// B28 (product decision, 2 Nov: a dead bridge blanked Social trading's Add): the ledger under every fault, for real. Each of
// 1Click, NEAR Intents' bridge, ZeroFee's quote relay and NEAR's nodes fails as it does in the wild (521, 429, a timeout),
// and each read a money sheet makes is checked: it answers when it doesn't need the failing service (R2: nothing waits on
// what it doesn't use; R3: the coin list paints from what the device kept, or the app's own), and when it does, it is a
// Problem naming that service, by name, with the money line, that the app retries by itself (R4, R5). The shell's table of
// what each method needs (shell-api faults.ts METHOD_NEEDS), which the sheets' half of the suite runs on, is checked here
// against the real ledger. Also: Welcome and set-up never call the bridge (the auditor's console).
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import type { Chain as Near } from "@zerofee/core/chain";
import { ProblemError } from "@zerofee/core/problem";
import { securityProblems } from "@zerofee/core/security-problems";
import { SERVICE_NAMES, problemLine, serviceProblem, type Service } from "@zerofee/core/services";
import { METHOD_NEEDS } from "@zerofee/shell-api/faults.ts";
import { DEPOSIT_BRIDGE, createApis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { fakeCore, fakeNear, replayFetch, type ReplayOptions } from "./testing/replay.ts";
import { SHEET_NEEDS } from "./app/services.ts";

const ME = "kid.near";
const RELAY = "https://relay.example";
const FAILURES = [521, 429, "timeout"] as const;
type Failure = (typeof FAILURES)[number];
const ran = async () => ({ kind: "ran" as const });

/** NEAR's nodes failing: every read throws what the core's RpcChain throws (unreachable, or slow for a timeout). */
function deadNear(chain: Near, failure: Failure): Near {
  return new Proxy(chain, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof v !== "function") return v;
      return () => Promise.reject(new ProblemError(failure === "timeout" ? securityProblems.readSlow() : securityProblems.nodesUnreachable()));
    },
  });
}

function ledgerWith(service: Service | null, failure: Failure) {
  const replay: ReplayOptions = { privateQuotes: `${RELAY}/v0` };
  if (service === "oneclick" || service === "bridge" || service === "relay") replay.fault = { service, failure };
  const fetch = replayFetch(replay);
  const near = fakeNear(ME, { nearYocto: 3n * 10n ** 24n });
  const ledger = createLedgerService({ bridge: fakeCore({ accountId: ME }), chain: service === "near" ? deadNear(near, failure) : near, apis: createApis(fetch), readCall: ran, privateQuotes: RELAY });
  return { ledger, fetch };
}

/** The reads money sheets make, each with what it needs (the coin list needs none: kept, or the app's own). */
const READS: { method: string; params?: Record<string, unknown>; needs: readonly Service[] }[] = [
  { method: "ledger.tokens", needs: [] },
  { method: "ledger.chains", needs: [] },
  { method: "ledger.balances", needs: METHOD_NEEDS["ledger.balances"]! },
  { method: "ledger.depositAddress", params: { chain: "near" }, needs: [] },
  { method: "ledger.depositAddress", params: { chain: "sol" }, needs: ["bridge"] },
];

const said: string[] = [];
for (const service of ["oneclick", "bridge", "relay", "near"] as const) {
  for (const failure of FAILURES) {
    test(`ledger, ${SERVICE_NAMES[service]} ${failure}: every read answers unless it needs ${SERVICE_NAMES[service]}; then a line naming it`, async () => {
      const { ledger } = ledgerWith(service, failure);
      for (const r of READS) {
        const out = await ledger.call(r.method, r.params);
        const label = `${r.method}${r.params ? ` ${JSON.stringify(r.params)}` : ""}`;
        if (!r.needs.includes(service)) {
          assert.ok("ok" in out, `${label} doesn't need ${service}, so it answers (got ${"problem" in out ? out.problem.whatHappened : ""})`);
          continue;
        }
        assert.ok("problem" in out, `${label} needs ${service}`);
        const p = out.problem;
        assert.equal(p.service, service, `${label}: the Problem names the service that failed`);
        assert.equal(p.next.kind, "retry", `${label}: the app reads it again by itself`);
        const line = problemLine(p);
        assert.ok(line.startsWith(SERVICE_NAMES[service]), `${label}: "${line}" opens with ${SERVICE_NAMES[service]}`);
        assert.match(line, /Your money is in your Safe\./, `${label}: the money line, always`);
        assert.doesNotMatch(line, /we can't reach|we couldn't|something went wrong|the service that holds/i);
        said.push(`${SERVICE_NAMES[service]} ${failure}: ${line}`);
      }
    });
  }
}

test("R6: ledger.services says which service is failing, from the relay's check and from what the ledger saw fail", async () => {
  const fetch = replayFetch({ privateQuotes: `${RELAY}/v0`, health: { bridge: "down", oneclick: "up" } });
  const ledger = createLedgerService({ bridge: fakeCore({ accountId: ME }), chain: fakeNear(ME, {}), apis: createApis(fetch), readCall: ran, privateQuotes: RELAY });
  const r = await ledger.call<Record<string, string>>("ledger.services");
  assert.ok("ok" in r);
  assert.deepEqual(r.ok, { bridge: "down" }, "only what is failing; up is said by saying nothing");
  // the relay itself down: said as the relay
  const dead = ledgerWith("relay", 521).ledger;
  const d = await dead.call<Record<string, string>>("ledger.services");
  assert.ok("ok" in d && d.ok.relay === "down");
  // a service the ledger saw fail, without the relay: NEAR, from a balance read
  const near = ledgerWith("near", 521).ledger;
  await near.call("ledger.balances");
  const n = await near.call<Record<string, string>>("ledger.services");
  assert.ok("ok" in n && n.ok.near === "down");
});

test("R2 + the auditor's console: Welcome's and set-up's reads never call the bridge; only another chain's address does", async () => {
  const { ledger, fetch } = ledgerWith(null, 521);
  for (const m of ["ledger.tokens", "ledger.chains", "ledger.startNetworks", "ledger.balances", "ledger.services"]) await ledger.call(m);
  await ledger.call("ledger.depositAddress", { chain: "near" });
  assert.equal(fetch.calls.filter((c) => c.url === DEPOSIT_BRIDGE).length, 0, "no bridge call for coins, networks, balances or NEAR's own address");
  await ledger.call("ledger.depositAddress", { chain: "sol" });
  assert.ok(fetch.calls.some((c) => c.url === DEPOSIT_BRIDGE), "control: Solana's address does ask the bridge");
});

test("R2 pins: each money sheet's needs, and the bridge only for another chain", () => {
  assert.deepEqual([...SHEET_NEEDS.add], [], "NEAR's own address is the account's name: nothing to wait on");
  assert.deepEqual([...SHEET_NEEDS.send], ["near", "oneclick", "relay", "confidential"], "every Send goes privately through NEAR on 1Click's quotes and settles on NEAR Intents (D128, review M3), through NEAR Confidential");
  // every money move goes through NEAR Confidential (the hard rule, 4 Nov): its sheet says so when it is down (audit 12's rig)
  for (const k of ["send", "swap", "move", "putaway", "siteadd", "takeout"] as const) assert.ok((SHEET_NEEDS[k] as readonly string[]).includes("confidential"), `${k} goes through NEAR Confidential`);
  for (const k of ["add", "send", "swap", "move", "putaway", "siteadd", "takeout"] as const) assert.ok(!(SHEET_NEEDS[k] as readonly string[]).includes("bridge"), `${k} never waits on the bridge`);
  for (const k of ["add", "send", "swap", "move", "putaway", "siteadd", "takeout"] as const) assert.ok(!(SHEET_NEEDS[k] as readonly string[]).includes("nearai"), `${k} never waits on NEAR AI Cloud`);
  assert.ok((SHEET_NEEDS.addOtherChain as readonly string[]).includes("bridge") && (SHEET_NEEDS.sendOtherChain as readonly string[]).includes("bridge"));
  assert.deepEqual([...METHOD_NEEDS["ledger.balances"]!], ["near"], "a balance waits on NEAR alone");
});

test("a dead bridge never holds the hub's Add: the balance read the core's Top up makes answers (the 19:41 page, reproduced and gone)", async () => {
  const { ledger } = ledgerWith("bridge", 521);
  const r = await ledger.call("ledger.balances");
  assert.ok("ok" in r, "ledger.balances with the bridge down");
});

test("security review H2: a kept coin list written over on the device can't change a coin's decimals; such a row is dropped", async () => {
  const core = fakeCore({ accountId: ME });
  const { SNAPSHOT_TOKENS } = await import("./catalogue-snapshot.ts");
  const usdc = SNAPSHOT_TOKENS.find((t) => t.symbol === "USDC" && t.blockchain === "near")!;
  const tampered = SNAPSHOT_TOKENS.map((t) => (t.assetId === usdc.assetId ? { ...t, decimals: t.decimals + 12 } : t));
  await core.call("device.store.set", { key: "coins-kept", value: JSON.stringify([...tampered, { assetId: "nep141:evil.near", decimals: 6, blockchain: "near", symbol: "USDC" }]) });
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, {}), apis: createApis(replayFetch({ fault: { service: "oneclick", failure: 521 } })), readCall: ran });
  const r = await ledger.call<{ assetId: string; decimals: number }[]>("ledger.tokens");
  assert.ok("ok" in r);
  assert.equal(r.ok.find((t) => t.assetId === usdc.assetId), undefined, "the row with other decimals is gone");
  assert.equal(r.ok.find((t) => t.assetId === "nep141:evil.near"), undefined, "a coin the app never shipped is gone");
  assert.ok(r.ok.length > 100, "control: the rest of the kept list still paints");
});

test("security review H1: balances priced from a kept list say so (priceKept); NEAR at the core's live price doesn't", async () => {
  const { ledger } = ledgerWith("oneclick", 521);
  const r = await ledger.call<{ tokenId: string; priceKept?: true }[]>("ledger.balances");
  assert.ok("ok" in r);
  const near = r.ok.find((b) => b.tokenId === "near");
  assert.ok(near, "NEAR on the account");
  // fakeCore answers account.nearPrice? then NEAR is live; if not, it is kept: either way the flag says which
  const price = await fakeCore({ accountId: ME }).call<{ usd: number | null }>("account.nearPrice");
  assert.equal(Boolean(near!.priceKept), !("ok" in price && price.ok?.usd));
  // control: with 1Click answering, nothing is marked kept
  const up = await ledgerWith(null, 521).ledger.call<{ tokenId: string; priceKept?: true }[]>("ledger.balances");
  assert.ok("ok" in up && up.ok.length > 0 && up.ok.every((b) => !b.priceKept));
});

test("security review M2 + bug 8: one source alone never says down nor holds the button; this phone and the relay together do; the line says waits only when the button waits; offline is only that", async () => {
  const { servicesLine } = await import("./app/services.ts");
  const relayOnly = servicesLine([{ service: "bridge", state: "down", seen: "relay" }], ["near", "bridge"], "Add", false);
  assert.deepEqual(relayOnly, { line: "NEAR Intents' bridge didn't answer. Add may take longer.", down: false });
  const phoneOnly = servicesLine([{ service: "near", state: "down", seen: "device" }], ["near"], "Send", false);
  assert.deepEqual(phoneOnly, { line: "NEAR didn't answer. Send may take longer.", down: false }, "the 10:13 line (one failed read) is no outage");
  // control: both sources agree, so it is down, and only then does the line say "waits" with the button held
  const both = servicesLine([{ service: "bridge", state: "down", seen: "both" }], ["near", "bridge"], "Add", false);
  // (changed pin, audit 11's B4, 8 Nov: what failed, where the money is, what to do; never "waits" when nothing waits)
  assert.deepEqual(both, { line: "NEAR Intents' bridge is down, so this can't go now. Your money stays where it is. It checks again by itself.", down: true });
  for (const r of [relayOnly, phoneOnly, both]) assert.equal(/can't go now/.test(r.line ?? ""), r.down, `the line and the button agree: ${r.line}`);
  assert.deepEqual(servicesLine([{ service: "bridge", state: "down", seen: "both" }], ["near"], "Send", false), { line: null, down: false }, "a sheet that doesn't use it says nothing");
  assert.deepEqual(servicesLine([{ service: "near", state: "down", seen: "both" }], ["near"], "Send", true), { line: "You're offline.", down: true }, "offline: that, and no service blamed");
});

test("bug 8: a service's 2-minute hold ends with any good answer from it, not only a balance read or a refresh (control: no answer, it holds)", async () => {
  const { watched } = await import("./ledger.ts");
  const told: string[] = [];
  const o = { n: 0, async read(x: number) { return x + this.n; }, async fails() { throw new Error("no"); }, plain: () => 7 };
  const w = watched(o, (m) => told.push(m));
  assert.equal(await w.read(2), 2, "the method runs on the object itself");
  await w.fails().catch(() => undefined);
  assert.equal(w.plain(), 7);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(told, ["read"], "a good answer is told; a failure and a plain value are not");
  // the ledger: NEAR fails one read (a payee's name), then another kind of NEAR read answers, and the line is gone
  let dead = true;
  const near = fakeNear(ME, { nearYocto: 3n * 10n ** 24n }, { "bob.near": { nearYocto: 1n } });
  const flaky = new Proxy(near, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof v !== "function") return v;
      return (...a: unknown[]) => (dead ? Promise.reject(new ProblemError(securityProblems.nodesUnreachable())) : v.apply(t, a));
    },
  }) as Near;
  const ledger = createLedgerService({ bridge: fakeCore({ accountId: ME }), chain: flaky, apis: createApis(replayFetch({})), readCall: ran });
  const nearRow = async () => {
    const s = await ledger.call<{ service: string }[]>("ledger.status");
    return "ok" in s && s.ok.some((r) => r.service === "near");
  };
  const failed = await ledger.call("ledger.recipientInfo", { accountId: "bob.near" });
  assert.ok("problem" in failed && failed.problem.service === "near");
  assert.ok(await nearRow(), "NEAR failing is held");
  await ledger.call("ledger.tokens");
  assert.ok(await nearRow(), "control: nothing from NEAR answered (a coin list isn't NEAR's), so it holds");
  dead = false;
  const r = await ledger.call("ledger.nearProfile", { caller: "chat", accountId: "bob.near" });
  assert.ok("ok" in r, "another NEAR read (Chat's profile read) answers");
  await new Promise((r) => setImmediate(r));
  assert.equal(await nearRow(), false, "NEAR answered, so NEAR isn't failing: no refresh needed");
});

test("control: a read that does wait on the failing service is caught (Solana's address, the bridge down)", async () => {
  const { ledger } = ledgerWith("bridge", 521);
  const r = await ledger.call("ledger.depositAddress", { chain: "sol" });
  assert.ok("problem" in r && r.problem.service === "bridge");
});

test.after(() => {
  if (process.env.B28_LEDGER_TABLE) writeFileSync(process.env.B28_LEDGER_TABLE, said.join("\n") + "\n");
});

test("oversight HIGH 1: a relay with no status table (404 on /v0/health, as the live one answers before its redeploy) is never said as the relay down", async () => {
  const base = replayFetch({ privateQuotes: `${RELAY}/v0` });
  const fetch404 = Object.assign(
    async (input: any, init?: any) => (String(typeof input === "string" ? input : input.url).endsWith("/v0/health") ? new Response("Not found", { status: 404 }) : base(input, init)),
    { calls: base.calls },
  ) as typeof base;
  const ledger = createLedgerService({ bridge: fakeCore({ accountId: ME }), chain: fakeNear(ME, {}), apis: createApis(fetch404), readCall: ran, privateQuotes: RELAY });
  const r = await ledger.call<Record<string, string>>("ledger.services");
  assert.ok("ok" in r);
  assert.equal(r.ok.relay, undefined, "a 404 is no table, not the relay failing");
  // control: a 5xx is still the relay down
  const fetch503 = Object.assign(
    async (input: any, init?: any) => (String(typeof input === "string" ? input : input.url).endsWith("/v0/health") ? new Response("", { status: 503 }) : base(input, init)),
    { calls: base.calls },
  ) as typeof base;
  const down = createLedgerService({ bridge: fakeCore({ accountId: ME }), chain: fakeNear(ME, {}), apis: createApis(fetch503), readCall: ran, privateQuotes: RELAY });
  const d = await down.call<Record<string, string>>("ledger.services");
  assert.ok("ok" in d && d.ok.relay === "down", "control: a 503 is the relay down");
});

test("oversight HIGH 1, the other shape: a 200 with no services table (an old relay, or a page) is no table, never the relay down", async () => {
  const base = replayFetch({ privateQuotes: `${RELAY}/v0` });
  const noTable = Object.assign(
    async (input: any, init?: any) => (String(typeof input === "string" ? input : input.url).endsWith("/v0/health") ? new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }) : base(input, init)),
    { calls: base.calls },
  ) as typeof base;
  const ledger = createLedgerService({ bridge: fakeCore({ accountId: ME }), chain: fakeNear(ME, {}), apis: createApis(noTable), readCall: ran, privateQuotes: RELAY });
  const r = await ledger.call<Record<string, string>>("ledger.services");
  assert.ok("ok" in r);
  assert.deepEqual(r.ok, {}, "nothing failing is said");
});

/** A ledger whose NEAR read fails on this phone, beside a relay whose own check says `relayNear` for NEAR. */
async function nearFailedBeside(relayNear: "slow" | "down") {
  const dead = new Proxy(fakeNear(ME, {}, { "bob.near": { nearYocto: 1n } }), {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      return typeof v === "function" ? () => Promise.reject(new ProblemError(securityProblems.nodesUnreachable())) : v;
    },
  }) as Near;
  const apis = { ...createApis(replayFetch({})), health: async () => [{ service: "near" as const, state: relayNear }] };
  const ledger = createLedgerService({ bridge: fakeCore({ accountId: ME }), chain: dead, apis, readCall: ran, privateQuotes: RELAY });
  await ledger.call("ledger.recipientInfo", { accountId: "bob.near" });
  const s = await ledger.call<{ service: string; state: string; seen?: string }[]>("ledger.status");
  assert.ok("ok" in s);
  return s.ok.find((x) => x.service === "near")!;
}

test("review M3: NEAR is an outage (Send held, the line says waits) only when this phone and the relay both say down; the relay's 'slow' (one node unhealthy) beside this phone's failure is no outage (control: both down)", async () => {
  const { servicesLine } = await import("./app/services.ts");
  const slowThere = await nearFailedBeside("slow");
  assert.equal(slowThere.seen, "device", "the relay says slow, this phone says down: they don't agree");
  const line = servicesLine([slowThere as never], SHEET_NEEDS.send, "Send", false);
  assert.deepEqual(line, { line: "NEAR didn't answer. Send may take longer.", down: false }, "button on, and the line never says waits");
  // control: both say down, so Send waits and says so
  const downThere = await nearFailedBeside("down");
  assert.equal(downThere.seen, "both");
  assert.deepEqual(servicesLine([downThere as never], SHEET_NEEDS.send, "Send", false), { line: "NEAR is down, so this can't go now. Your money stays in your Safe. It checks again by itself.", down: true });
  // rule 9a (product decision, 5 Nov): the relay's own slow (or busy) is never said; button on, the failover covers it
  assert.deepEqual(servicesLine([{ service: "near", state: "slow", seen: "relay" }], SHEET_NEEDS.send, "Send", false), { line: null, down: false });
  assert.deepEqual(servicesLine([{ service: "near", state: "busy", seen: "both" }], SHEET_NEEDS.send, "Send", false), { line: null, down: false });
});

/** A ledger whose private-balance read (the core's) fails naming `service`, beside a relay check saying it is down. */
async function readFailedBeside(service: Service) {
  const base = fakeCore({ accountId: ME });
  const bridge = {
    call: async (m: string, p?: Record<string, unknown>) =>
      m === "subwallet.list" ? { ok: [{ id: "p1", kind: "private", address: "a".repeat(64) }] }
      : m === "subwallet.private.balances" ? { problem: serviceProblem("security.oneclick.unreachable", service, "down") }
      : base.call(m, p),
    on: base.on.bind(base),
  } as typeof base;
  const apis = { ...createApis(replayFetch({})), health: async () => [{ service, state: "down" as const }] };
  const ledger = createLedgerService({ bridge, chain: fakeNear(ME, {}), apis, readCall: ran, privateQuotes: RELAY });
  const r = await ledger.call("ledger.private");
  assert.ok("problem" in r && r.problem.service === service, "the read failed, naming the service");
  const s = await ledger.call<{ service: string; state: string; seen?: string }[]>("ledger.status");
  assert.ok("ok" in s);
  return s.ok.find((x) => x.service === service)!;
}

test("review L7: 1Click (and the relay) are reached only through the relay, so the relay's check and this phone's failure are ONE vantage: never 'both', never 'waits' (control: NEAR, two vantages, is both)", async () => {
  const { servicesLine } = await import("./app/services.ts");
  const oneclick = await readFailedBeside("oneclick");
  assert.equal(oneclick.seen, "device", "a relay egress fault isn't two sources");
  assert.deepEqual(servicesLine([oneclick as never], SHEET_NEEDS.send, "Send", false), { line: "NEAR Intents didn't answer. Send may take longer.", down: false });
  // control: the very same path for NEAR, which the phone reads on its own nodes, is an outage when both say down
  const near = await readFailedBeside("near");
  assert.equal(near.seen, "both");
  assert.equal(servicesLine([near as never], SHEET_NEEDS.send, "Send", false).down, true);
});

test("B4 (audit 11): a Send stopped by a down service says what failed, where the money is and what to do [before: \"NEAR Intents is down. Send waits until it's back.\"]", async () => {
  const { servicesLine } = await import("./app/services.ts");
  assert.deepEqual(servicesLine([{ service: "oneclick", state: "down", seen: "both" }], ["near", "oneclick"], "Send", false), { line: "NEAR Intents is down, so this can't go now. Your money stays in your Safe. It checks again by itself.", down: true });
  assert.equal(servicesLine([{ service: "oneclick", state: "down", seen: "both" }], ["oneclick"], "Take out", false).line, "NEAR Intents is down, so this can't go now. Your money stays where it is. It checks again by itself.", "a Take out's money is in the site's wallet");
});

// AgentZero's sandbox (AGENTZERO-WALLET.md §1, §6, L8): with its own wallet on, its acts use only that wallet
// (ACT_PLACES = agent), its Solana trades run on its own leg (agent/sol), agent_pay is off for it, and AgentHost exposes
// one key. Off (the flag, today), everything acts exactly as before. Control (§9): re-add "sol" to AGENT_ACT_PLACES and
// the "refused by name" test goes red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { ACT_PLACES, AGENT_ACT_PLACES, act, actPlaces, actScope, type ActHost } from "./agent-act.ts";
import { AGENTZERO_WALLET, AGENT_USDC } from "./agent-route.ts";
import { AGENT_LEG, agentLegHost, pocketCall, type PocketHost } from "./agent-pocket.ts";
import { AGENT_PAY_OFF_LINE, agentPayOff, agentPayPlan } from "./agent-private.ts";
import { agentAddress, agentKey, agentKeyMaker } from "./agent-wallet.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";
import { HOT_ROOT, hotRoot, hotSecret } from "./hot-keys.ts";
import { nep413Hash } from "./private-pocket.ts";
import { base64, fromBase58 } from "./sol/bytes.ts";
import { solAddress } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";

const says = (re: RegExp) => (e: any) => re.test(String(e?.problem?.more ?? e?.message));
const ROOT = hotRoot(new Uint8Array(32).fill(5));
const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";

function host(wallet: boolean | undefined): ActHost {
  const vault = new MemoryVault();
  return {
    vault, approve: async () => true, strong: async () => {}, price: async () => 150, stops: () => 0, ...(wallet === undefined ? {} : { wallet }),
    wallets: { floatOut: async () => ({}), floatIn: async () => ({}), floatHome: async () => ({}), privateHome: async () => ({}), agentSwap: async () => ({}) },
  };
}
const scope = (places: string[]) => ({ set: { kinds: ["trade", "move", "swap"], places, payees: [], dayUsd: 20, minutes: 60 } });

test("its own wallet on: AgentZero's acts use only its wallet; an act from the SOL wallet, any person's wallet or the Safe is refused by name", async () => {
  assert.deepEqual([...actPlaces(true)], ["agent"]);
  const h = host(true);
  assert.ok("scope" in (await actScope(scope(["agent"]), h)));
  for (const from of ["sol", "hood", "near", "bsc", "spending", "hidden"]) {
    await assert.rejects(act({ kind: "trade", from, usd: 5, key: "act-key-0001", side: "buy", coin: "So11111111111111111111111111111111111111112" }, h), says(/uses only its own wallet/), from);
  }
  await assert.rejects(act({ kind: "move", from: "safe", to: "agent", usd: 5, key: "act-key-0002" }, h), says(/never takes money from your Safe/));
  await assert.rejects(act({ kind: "move", from: "agent", to: "sol", usd: 5, key: "act-key-0003" }, h), says(/uses only its own wallet/));
  // a job can't even be scoped to a person's wallet
  await assert.rejects(actScope(scope(["sol"]), host(true)));
  // a trade from its own wallet runs on its Solana leg (a ticket for the day's own signing)
  const t = await act({ kind: "trade", from: "agent", usd: 5, key: "act-key-0004", side: "buy", coin: "So11111111111111111111111111111111111111112" }, h);
  assert.equal((t.done as { go: boolean }).go, true);
});

test("the flag ships on (product decision, 3 Nov): the default host is sandboxed to AgentZero's own wallet; a person's wallet is refused by name", async () => {
  assert.equal(AGENTZERO_WALLET, true);
  const h = host(undefined); // the flag's own default
  assert.ok("scope" in (await actScope(scope(["agent"]), h)));
  await assert.rejects(actScope(scope(["sol"]), h));
  await assert.rejects(act({ kind: "trade", from: "sol", usd: 5, key: "act-key-0006", side: "buy", coin: "So11111111111111111111111111111111111111112" }, h), says(/uses only its own wallet/));
});

test("control, explicitly off: the places, the acts and the words are as before; 'agent' is no place", async () => {
  assert.deepEqual([...actPlaces(false)], [...ACT_PLACES]);
  const h = host(false);
  assert.ok("scope" in (await actScope(scope(["sol"]), h)));
  const t = await act({ kind: "trade", from: "sol", usd: 5, key: "act-key-0005", side: "buy", coin: "So11111111111111111111111111111111111111112" }, h);
  assert.equal((t.done as { go: boolean }).go, true);
  await assert.rejects(actScope(scope(["agent"]), host(false)));
});

test("agent_pay is off for AgentZero once its wallet is on (a payment, a private payment, a top-up); on by default (product decision, 3 Nov)", () => {
  for (const kind of ["pay", "pay-private", "top-up"]) {
    assert.equal(agentPayOff(kind, true), true, kind);
    assert.equal(agentPayOff(kind, false), false, kind);
    assert.equal(agentPayOff(kind), true, `${kind}: the flag's default (on)`);
  }
  assert.equal(agentPayOff("order", true), false, "a standing order isn't AgentZero's payment");
});

test("its Solana trading leg sits on agent/sol, from the words, never the SOL wallet; off, the SOL wallet as before", async () => {
  const make = async (on: boolean) => {
    const vault = new MemoryVault();
    await vault.put(HOT_ROOT, ROOT.slice());
    return new SubWallets({ vault, sol: {} as never, evm: {} as never, approve: async () => true, emit: () => {}, agentWallet: { on } } as never);
  };
  const pocketOf = async (w: SubWallets) => (await pocketCall("account.agent.pocket", {}, { wallets: w } as never)) as { id: string; address: string };
  const on = await make(true);
  const leg = await pocketOf(on);
  assert.deepEqual(leg, { id: AGENT_LEG, address: solAddress(hotSecret(ROOT, "agent", "sol")!) });
  assert.notEqual(leg.address, solAddress(hotSecret(ROOT, "trade", "sol")!));
  assert.ok(!(await on.list()).some((w) => w.address === leg.address), "never a wallet in the list (no Home row)");
  const off = await make(false);
  assert.equal((await pocketOf(off)).address, solAddress(hotSecret(ROOT, "trade", "sol")!));
  // the day's own host: its wallet and key are the leg's with the wallet on; SubWallets' own (the SOL wallet) off
  const base = { pocketId: async () => "trade-sol-abc", wallet: async (id: string) => ({ id, address: "SOLWALLET" }), secret: async () => new Uint8Array(32).fill(1), ownLink: async () => {} } as unknown as PocketHost;
  const h = agentLegHost(base, on.agentKit());
  assert.equal(await h.pocketId(), AGENT_LEG);
  assert.equal((await h.wallet(AGENT_LEG)).address, leg.address);
  assert.deepEqual(await h.secret({ id: AGENT_LEG, address: leg.address }), hotSecret(ROOT, "agent", "sol"));
  const h0 = agentLegHost(base, off.agentKit());
  assert.equal(await h0.pocketId(), "trade-sol-abc");
});

test("agent_pay is refused for AgentZero by the core's own plan, before anything is asked, once its wallet is on", async () => {
  let asked = 0;
  const d = { chain: { network: "mainnet" } as never, accountId: "kim.near", quoter: (async () => (asked++, {})) as never, wallet: true };
  for (const kind of ["pay", "pay-private", "top-up"]) await assert.rejects(agentPayPlan({ kind, payout: {}, to: "lee.near", amount: "1000000" }, d), says(/pays only from its own wallet/), kind);
  assert.equal(asked, 0);
  assert.equal(AGENT_PAY_OFF_LINE, "AgentZero pays only from its own wallet now. Nothing moved.");
});

test("D152: AgentZero's payer holds one key and signs one shape only: a plain USDC ft_transfer to ZeroFee's account pinned in this build (SR3)", async () => {
  const { AgentPay, ZEROFEE_RECEIVE: pinned } = await import("./agent-pay.ts");
  const { agentNear } = await import("./testing/agent-near.ts");
  assert.equal(pinned, "37764cf3c4418f8b0a963768bcaa1ddddc201cad32c040db2dfc919936465822", "step O1's address, pinned in the app build");
  const vault = new MemoryVault();
  await vault.put(HOT_ROOT, ROOT.slice());
  const near = agentNear();
  const made: string[] = [];
  const pay = new AgentPay({ vault: new MemoryVault(), chain: near.chain, key: () => (made.push("near"), agentKey(vault, "near")) });
  await pay.pay({ owedMicros: 5000, usage: { input_tokens: 1000, output_tokens: 50 }, model: "claude-opus-5-5", memo: `agentzero ${"cd".repeat(16)}`, reply: "0123456789abcdef" });
  assert.deepEqual(made, ["near"], "only AgentZero's own NEAR key, made once for the signature");
  const tx = near.sent[0]!.tx;
  assert.equal(tx.signerId, await agentAddress(vault));
  assert.equal(JSON.parse(new TextDecoder().decode((tx.actions[0] as { args: Uint8Array }).args)).receiver_id, pinned);
});

test("the sandbox's places never include a person's wallet or the Safe", () => {
  for (const p of ["sol", "hood", "near", "bsc", "spending", "hidden", "safe"]) assert.ok(!(AGENT_ACT_PLACES as readonly string[]).includes(p), p);
});

test("the core's act door takes the sandbox from AgentZero's own wallet's switch: on, a job on the SOL wallet is refused; off, as before", async () => {
  const make = (on: boolean) => {
    const vault = new MemoryVault();
    const w = new SubWallets({ vault, sol: {} as never, evm: {} as never, approve: async () => true, emit: () => {}, agentWallet: { on } } as never);
    return { wallets: w, vault, approve: async () => true, strong: async () => {}, stopped: () => false, price: async () => 150 } as never;
  };
  await assert.rejects(pocketCall("account.agent.actScope", scope(["sol"]), make(true)));
  assert.ok("scope" in ((await pocketCall("account.agent.actScope", scope(["agent"]), make(true))) as object));
  assert.ok("scope" in ((await pocketCall("account.agent.actScope", scope(["sol"]), make(false))) as object));
});

test("SR2 M3: with its own wallet on, the account's agent key signs nothing for AgentZero (pay, convert, a standing order); off, refused by the sandbox order (M13)", async () => {
  const { agentCall } = await import("./agent-door.ts");
  const ctx = (on?: boolean) => ({ subwallets: new SubWallets({ vault: new MemoryVault(), sol: {} as never, evm: {} as never, approve: async () => true, emit: () => {}, ...(on === undefined ? {} : { agentWallet: { on } }) } as never), modulesSigner: async () => { throw new Error("the account's key was asked for"); } }) as never;
  const said = (e: any) => String(e?.problem?.more ?? e?.message);
  for (const p of [{ kind: "pay", payout: "Near", to: "bob.near", amount: "1" }, { kind: "convert", fromToken: "nep141:wrap.near", toToken: AGENT_USDC, amount: "1" }, { kind: "order", id: "1" }]) {
    assert.equal(await agentCall(ctx(true), "account.agent.spend", p).then(() => "", said), "AgentZero pays only from its own wallet now. Nothing moved.", p.kind);
    assert.equal(await agentCall(ctx(false), "account.agent.spend", p).then(() => "", said), "AgentZero's own wallet isn't on yet, so it can't do this by itself. Nothing moved.", `${p.kind}: explicitly off: the sandbox order (M13)`);
  }
});

test("the old pocket's move to the SOL wallet names Solana when its nodes don't answer (securityProblems.chainUnreachable(\"sol\"))", async () => {
  const { pocketEmpty } = await import("./agent-pocket.ts");
  const { securityProblems } = await import("./security-problems.ts");
  const solana = securityProblems.chainUnreachable("sol");
  const k = (sol: Record<string, unknown>) => ({ from: "A".repeat(43), to: "B".repeat(43), sol: sol as never, approve: async () => true, secret: async () => new Uint8Array(32).fill(1), confirmed: async () => ({ status: "done" }) as never });
  const down = async () => { throw new Error("node down"); };
  const fine = { balance: async () => 1_000_000n, latestBlockhash: down, send: async () => true, status: async () => ["ok", "ok"] };
  for (const sol of [{}, { ...fine, balance: down }, fine]) {
    await assert.rejects(pocketEmpty(k(sol)), (e: any) => e?.problem?.code === solana.code && e.problem.whatHappened === solana.whatHappened && /Solana/.test(e.problem.whatHappened));
  }
});

test("set-up: with its own wallet on, the account's old AgentZero key is revoked (agent_revoke) on the person's sheet; none, nothing asked; off, refused before anything is read", async () => {
  const { agentCall } = await import("./agent-door.ts");
  const { ACCOUNT_POLICY } = await import("./known-contracts.ts");
  const make = (on: boolean | undefined, hasKey: boolean) => {
    const ran: string[] = [];
    const vault = new MemoryVault();
    const keys = hasKey ? [{ handle: "old-agent", permission: { kind: "function-call", receiverId: "kim.near", methods: ACCOUNT_POLICY.agentMethods, allowanceYocto: 1n } }] : [];
    const ctx = {
      subwallets: new SubWallets({ vault, sol: {} as never, evm: {} as never, approve: async () => true, emit: () => {}, ...(on === undefined ? {} : { agentWallet: { on } }) } as never),
      vault,
      chain: { commonBlock: async () => ({}), accessKeys: async () => keys },
      modulesSigner: async () => ({ accountId: "kim.near", run: async (_id: string, actions: { method: string }[]) => (ran.push(...actions.map((a) => a.method)), { status: "done" }) }),
      ready: async () => ({ accountId: "kim.near" }),
    };
    return { ctx: ctx as never, ran };
  };
  const on = make(true, true);
  assert.deepEqual(await agentCall(on.ctx, "account.agent.wallet", { do: "setup" }), { revoked: true, outcome: { status: "done" } });
  assert.deepEqual(on.ran, ["agent_revoke"]);
  const none = make(true, false);
  assert.deepEqual(await agentCall(none.ctx, "account.agent.wallet", { do: "setup" }), { revoked: false });
  assert.deepEqual(none.ran, []);
  // explicitly off: refused before anything is read
  const off = make(false, true);
  await assert.rejects(agentCall(off.ctx, "account.agent.wallet", { do: "setup" }), says(/isn't open yet/));
  assert.deepEqual(off.ran, []);
  // the flag's default (on, product decision, 3 Nov): the set-up runs, never refused as off
  const dflt = make(undefined, false);
  assert.deepEqual(await agentCall(dflt.ctx, "account.agent.wallet", { do: "setup" }), { revoked: false });
  // phone test, 4 Nov: a Safe whose rules have no AgentZero (modulesSigner refuses) holds no old key: set-up goes on
  const older = make(true, false) as { ctx: any; ran: string[] };
  older.ctx.modulesSigner = async () => { throw Object.assign(new Error("no AgentZero"), { problem: { code: "security.method.unknown", more: "This account's rules don't have AgentZero." } }); };
  assert.deepEqual(await agentCall(older.ctx, "account.agent.wallet", { do: "setup" }), { revoked: false });
  // control: an old key on the account still needs the rules' signer to revoke it
  const olderKey = make(true, true) as { ctx: any; ran: string[] };
  olderKey.ctx.modulesSigner = older.ctx.modulesSigner;
  await assert.rejects(agentCall(olderKey.ctx, "account.agent.wallet", { do: "setup" }), says(/don't have AgentZero/));
});

test("audit M13, the product sandbox order: with its own wallet off, every autonomous money door is refused by name; reading, ending and settings stay; on, none is refused by it", async () => {
  const { agentCall, SANDBOX_OFF_LINE } = await import("./agent-door.ts");
  assert.equal(SANDBOX_OFF_LINE, "AgentZero's own wallet isn't on yet, so it can't do this by itself. Nothing moved.");
  const ctx = (on?: boolean) => {
    const vault = new MemoryVault();
    void vault.put(HOT_ROOT, ROOT.slice());
    return {
      subwallets: new SubWallets({ vault, sol: {} as never, evm: {} as never, approve: async () => true, emit: () => {}, ...(on === undefined ? {} : { agentWallet: { on } }) } as never),
      vault, chain: { commonBlock: async () => ({}), view: async () => ({ paused: false }), accessKeys: async () => [] },
      ready: async () => ({}), modulesSigner: async () => { throw new Error("the account's key was asked for"); },
      approveOnSheet: async () => true, nativeUsd: async () => 150, stopped: () => false, userVerified: undefined, nativeSheet: async () => true,
    } as never;
  };
  const said = (e: any) => String(e?.problem?.more ?? e?.message);
  const run = (on: boolean | undefined, method: string, p: Record<string, unknown>) => agentCall(ctx(on), method, p).then(() => "ran", said);
  const autonomous: [string, Record<string, unknown>][] = [
    ["account.agent.act", { kind: "trade", from: "sol", usd: 5, key: "act-key-0001", side: "buy", coin: "So11111111111111111111111111111111111111112" }],
    ["account.agent.actScope", scope(["sol"])],
    ["account.agent.pocketSession", { perTxUsd: 5, totalUsd: 20, minutes: 60 }],
    ["account.agent.pocketSign", { tx: "AAAA" }],
    ["account.agent.spend", { kind: "pay", payout: "Near", to: "bob.near", amount: "1" }],
  ];
  for (const [m, p] of autonomous) assert.equal(await run(false, m, p), SANDBOX_OFF_LINE, `${m} with the wallet explicitly off`);
  // not autonomous: reading or ending a job's scope, reading "Ask me first", the end of a day, the pocket's address
  for (const [m, p] of [["account.agent.actScope", {}], ["account.agent.actScope", { end: true }], ["account.agent.askAbove", {}], ["account.agent.pocketEnd", {}]] as [string, Record<string, unknown>][]) {
    assert.notEqual(await run(undefined, m, p), SANDBOX_OFF_LINE, `${m} ${JSON.stringify(p)}`);
  }
  // on: the sandbox order lets each through to its own checks (the act on its own wallet; agent_pay refused by L8's M3)
  for (const [m, p] of autonomous) assert.notEqual(await run(true, m, p), SANDBOX_OFF_LINE, `${m} with the wallet on`);
  for (const [m, p] of autonomous) assert.notEqual(await run(undefined, m, p), SANDBOX_OFF_LINE, `${m} with the flag's default (on, product decision, 3 Nov)`);
  assert.ok("scope" in ((await agentCall(ctx(true), "account.agent.actScope", scope(["agent"]))) as object), "on: a job on AgentZero's own wallet");
});

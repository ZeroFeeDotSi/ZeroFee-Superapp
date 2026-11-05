// Bug report (5 Nov): neither AgentZero nor the person could sign in to pump.fun or GMGN from AgentZero's site window.
// QA's ruling: wallet mode there only with (a) the sign-in sites' exact hosts, (b) AgentZero's OWN wallet (its
// pocket), (c) sign-in messages only, any transaction through agent-act's caps and tickets, never the window, (d) each
// sign-in in Activity as AgentZero's. Same local stubs as signin-stub.test.ts (no live site, no bot check worked
// around): the REAL pinned provider.js in the page, the REAL engine, the REAL core's wallets. The host's words (`agent`,
// `tap`, `load`) are what PartnerWallet and IsolatedCore stamp on the phone (apps/ios/check/partner.swift checks those
// rules). Also QA's re-run room and QA's sheet for a sign-in text outside the allow-list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { SubWallets } from "../../../core/src/subwallets.ts";
import { MemoryVault } from "../../../core/src/vault.ts";
import type { SolChain } from "../../../core/src/solana.ts";
import { ProblemError } from "../../../core/src/problem.ts";
import { fromBase58 } from "../../../core/src/sol/bytes.ts";
import { AGENT_SIGN_IN_HOSTS } from "../../../core/src/site-wallets.ts";
import { SIGN_IN_RERUN_PER_HOUR } from "../../../core/src/sign-message.ts";
import { AGENT_ONLY_SIGNS_IN, AGENT_SITES, createWalletEngine } from "./engine.ts";
import { siteRules } from "../sites.ts";
import { agentSignInRow } from "../service.ts";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { agentZeroSteps } from "@zerofee/shell-api/agentzero-steps.ts";

const PROVIDER = readFileSync(new URL("../provider/provider.js", import.meta.url), "utf8");
const enc = new TextEncoder();
const forSite: Record<string, string> = { "pump.fun": "pump", "gmgn.ai": "gmgn" };

/** The device: the core's wallets behind the Browser's stamped bridge; every core call it saw, by name. */
async function device() {
  const store = new Map<string, string>();
  const wallets = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm: {} as never, approve: async () => false, emit: () => undefined });
  const calls: string[] = [];
  const made = new Map<string, Promise<{ id: string; address: string }>>();
  const bridge: Bridge = {
    async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      try {
        if (method === "device.store.get") return { ok: { value: store.get(String(p.key)) ?? null } as T };
        if (method === "device.store.set") return (store.set(String(p.key), String(p.value)), { ok: { ok: true } as T });
        if (method.startsWith("device.")) return { ok: { ok: true } as T };
        calls.push(method);
        if (method === "subwallet.site.forHost") {
          const host = new URL(String((p.site as { origin: string }).origin)).host;
          if (!made.has(host)) made.set(host, wallets.create("site", "sol", undefined, forSite[host]) as never);
          return { ok: (await made.get(host)) as T };
        }
        if (method === "subwallet.site.forAgent") return { ok: (await wallets.agentSiteFor(p.site, p.chain, "browser")) as T };
        if (method === "subwallet.signMessage") return { ok: (await wallets.signMessage(p.id, p.message, p.site, "Browser", "browser", p.agent, p.tap, p.load)) as T };
        if (method === "subwallet.signTx" || method === "subwallet.sign") return { ok: (await wallets.signTx(p.id, p.tx, p.why, undefined, "Browser", p.site, "browser")) as T };
        throw new Error(`not stubbed: ${method}`);
      } catch (e) {
        if (e instanceof ProblemError) return { problem: e.problem };
        throw e;
      }
    },
    on: () => () => undefined,
  };
  return { bridge, wallets, calls };
}

/** The stub site in a window: `agent` is AgentZero's own window (the host's word, from the compiled recipe); `host()`
 *  gives each request the host's touch and page load. */
function stubSite(host: string, engine: ReturnType<typeof createWalletEngine>, words: () => { agent?: boolean; tap?: boolean; load?: string } = () => ({})) {
  let id = 0;
  const window = new EventTarget() as EventTarget & Record<string, unknown>;
  window.webkit = { messageHandlers: { zerofeeWallet: { postMessage: async (m: { id: number; method: string; params: unknown }) => engine.handle({ ...m, id: ++id, origin: `https://${host}`, mainFrame: true, ...words() }) } } };
  window.top = window;
  const registered: any[] = [];
  window.addEventListener("wallet-standard:register-wallet", (e) => (e as unknown as { detail: (api: unknown) => void }).detail({ register: (w: unknown) => registered.push(w) }));
  vm.runInNewContext(PROVIDER, { window, CustomEvent, Event, btoa, atob, crypto, setTimeout, Uint8Array, ArrayBuffer, Error, JSON, Object, Promise, Map, Set, String, Number, Array, Boolean });
  const zf = () => {
    const w = registered.find((x) => x.name === "ZeroFee");
    assert.ok(w, `${host}: ZeroFee is in the site's wallet list`);
    return w;
  };
  return {
    connect: async (silent = false) => (await zf().features["standard:connect"].connect({ silent })).accounts as { address: string }[],
    signIn: async (text: string, account: { address: string }) => {
      const [out] = await zf().features["solana:signMessage"].signMessage({ account, message: enc.encode(text) });
      return out as { signature: Uint8Array };
    },
    /** The raw ask, as a page's script would make it: the engine's answer, untouched by provider.js. */
    raw: (method: string, params: unknown) => engine.handle({ id: ++id, method, params, origin: `https://${host}`, mainFrame: true, ...words() }),
  };
}

const gmgnText = (address: string, issued = new Date().toISOString()) =>
  `gmgn.ai wants you to sign in with your Solana account:\n${address}\n\nwallet_sign_statement\n\nURI: https://gmgn.ai\nVersion: 1\nChain ID: mainnet\nNonce: a1b2c3d4e5f6\nIssued At: ${issued}`;
const textFor = (host: string, address: string) => (host === "gmgn.ai" ? gmgnText(address) : `Sign in to pump.fun: ${Date.now()}`);
const agentWindow = () => ({ agent: true, tap: false, load: "agent-load-1" });

test("both sites sign in from AgentZero's window with AgentZero's own wallet: ZeroFee is in the wallet list, connect gives AgentZero's address, the sign-in verifies, Activity gets AgentZero's row (ruling a, b, d)", async () => {
  assert.deepEqual([...AGENT_SITES], [...AGENT_SIGN_IN_HOSTS], "the engine's and the core's sign-in sites are one list");
  for (const host of ["pump.fun", "gmgn.ai"]) {
    const d = await device();
    const rows: string[] = [];
    const engine = createWalletEngine({ bridge: d.bridge, site: siteRules({}), emit: () => undefined, askConnect: async () => assert.fail("no connect sheet in AgentZero's window"), agentSignedIn: (h, name) => rows.push(`${h}|${name}`) });
    const site = stubSite(host, engine, agentWindow);
    const [account] = await site.connect();
    const pocket = await d.wallets.agentSiteFor({ origin: `https://${host}` }, "sol", "browser");
    assert.equal(account?.address, pocket.address, `${host}: the address is AgentZero's pocket`);
    const text = textFor(host, account!.address);
    const { signature } = await site.signIn(text, account!);
    assert.ok(ed25519.verify(signature, enc.encode(text), fromBase58(pocket.address)), `${host}: AgentZero's pocket signed the site's exact words`);
    assert.deepEqual(rows, [`${host}|${host === "gmgn.ai" ? "GMGN" : "pump.fun"}`], "d: one AgentZero sign-in row");
    assert.equal(d.wallets.siteSignIns()[0]?.by, "agentzero", "d: the core's record says it was AgentZero's");
    // b: the person's wallets are never asked for, let alone offered
    assert.ok(!d.calls.includes("subwallet.site.forHost") && !d.calls.includes("subwallet.list"), `${host}: no person's wallet looked up (${d.calls.join(", ")})`);
  }
});

test("control (b): the person's own window on the same site still gets the person's own site wallet, a different address, never AgentZero's", async () => {
  const d = await device();
  const engine = createWalletEngine({ bridge: d.bridge, site: siteRules({}), emit: () => undefined, askConnect: async () => true });
  const [mine] = await stubSite("pump.fun", engine).connect();
  const [az] = await stubSite("pump.fun", engine, agentWindow).connect();
  assert.ok(mine?.address && az?.address && mine.address !== az.address, "two wallets: the person's and AgentZero's");
  assert.equal(az.address, (await d.wallets.agentSiteFor({ origin: "https://pump.fun" }, "sol", "browser")).address);
});

test("c: a transaction from AgentZero's window is refused in the engine, before the core (each kind); the core refuses the pocket for any transaction too (control: the sign-in still signs)", async () => {
  const d = await device();
  const engine = createWalletEngine({ bridge: d.bridge, site: siteRules({}), emit: () => undefined, askConnect: async () => true });
  const site = stubSite("pump.fun", engine, agentWindow);
  const [account] = await site.connect();
  for (const method of ["solana:signTransaction", "solana:signAndSendTransaction", "eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "eth_requestAccounts"]) {
    const r = await site.raw(method, { address: account!.address, transaction: "AAAA" });
    assert.ok("error" in r && r.error.code === 4200 && r.error.message === AGENT_ONLY_SIGNS_IN, `${method}: ${JSON.stringify(r)}`);
  }
  assert.ok(!d.calls.some((c) => c === "subwallet.signTx" || c === "subwallet.sign"), "the core never heard a transaction");
  // the core's own wall: the pocket signs no transaction for a page, whoever asks
  const pocket = await d.wallets.agentSiteFor({ origin: "https://pump.fun" }, "sol", "browser");
  await assert.rejects(d.wallets.signTx(pocket.id, "AAAA", "x", undefined, "Browser", { origin: "https://pump.fun" }, "browser"), (e: any) => e?.problem?.code === "security.subwallet.refused" && /AgentZero's pocket signs only for AgentZero's own trades/.test(e.problem.more));
  // control: the sign-in itself still goes
  const { signature } = await site.signIn(textFor("pump.fun", account!.address), account!);
  assert.equal(signature.length, 64);
});

test("b, in the core: AgentZero's window signs only with AgentZero's pocket (the person's site wallet is refused there), and the pocket never signs outside it (control: each in its own window signs)", async () => {
  const d = await device();
  const pocket = await d.wallets.agentSiteFor({ origin: "https://gmgn.ai" }, "sol", "browser");
  const persons = await d.wallets.create("site", "sol", undefined, "gmgn");
  const site = { origin: "https://gmgn.ai" };
  const b64 = (t: string) => Buffer.from(t).toString("base64");
  await assert.rejects(d.wallets.signMessage(persons.id, b64(gmgnText(persons.address)), site, "Browser", "browser", true, false, "L1"), (e: any) => /AgentZero's own wallet/.test(e?.problem?.more ?? ""));
  await assert.rejects(d.wallets.signMessage(pocket.id, b64(gmgnText(pocket.address)), site, "Browser", "browser"), (e: any) => /AgentZero's pocket signs only/.test(e?.problem?.more ?? ""), "without AgentZero's window, the pocket is refused");
  await assert.rejects(d.wallets.signMessage(pocket.id, b64(gmgnText(pocket.address)), site, "Chat", "chat", true), (e: any) => /Only AgentZero's own window/.test(e?.problem?.more ?? ""), "another app can't claim AgentZero's window");
  assert.ok((await d.wallets.signMessage(pocket.id, b64(gmgnText(pocket.address)), site, "Browser", "browser", true, false, "L1")).signedIn);
  assert.ok((await d.wallets.signMessage(persons.id, b64(gmgnText(persons.address)), site, "Browser", "browser")).signedIn, "control: the person's own window signs with theirs");
});

test("a: an unlisted host gets no wallet in AgentZero's window: the engine refuses it and the core never makes the pocket for it (control: pump.fun does)", async () => {
  const d = await device();
  const engine = createWalletEngine({ bridge: d.bridge, site: siteRules({}), emit: () => undefined, askConnect: async () => true });
  for (const host of ["jup.ag", "evil.example", "www.pump.fun"]) {
    const r = await stubSite(host, engine, agentWindow).raw("solana:connect", {});
    assert.ok("error" in r, `${host}: ${JSON.stringify(r)}`);
    await assert.rejects(d.wallets.agentSiteFor({ origin: `https://${host}` }, "sol", "browser"), (e: any) => e?.problem?.code === "security.subwallet.refused" || e?.problem?.code === "security.request.invalid");
  }
  assert.ok(!d.calls.includes("subwallet.site.forAgent") && !d.calls.includes("subwallet.site.forHost"), "nothing made for an unlisted host");
  await assert.rejects(d.wallets.agentSiteFor({ origin: "https://pump.fun" }, "sol", "trade"), (e: any) => e?.problem?.code === "security.request.not-allowed", "another app can't ask for it");
  assert.ok((await d.wallets.agentSiteFor({ origin: "https://pump.fun" }, "sol", "browser")).address);
});

test("QA (rule 8): a sign-in text outside the allow-list shows its own sheet, naming the site, saying nothing moved and where, with Back to the site; in AgentZero's window it names AgentZero's wallet (control: a known sign-in shows none)", async () => {
  for (const agent of [false, true]) {
    const d = await device();
    const shown: Problem[] = [];
    const engine = createWalletEngine({ bridge: d.bridge, site: siteRules({}), emit: () => undefined, askConnect: async () => true, problem: (p) => void shown.push(p) });
    const site = stubSite("pump.fun", engine, agent ? agentWindow : () => ({}));
    const [a] = await site.connect();
    await assert.rejects(site.signIn("Welcome! Sign to accept the pump.fun terms and continue.", a!));
    assert.equal(shown.length, 1, "never a silent refusal");
    const p = shown[0]!;
    assert.equal(p.code, "browser.signin.unknown");
    assert.equal(p.whatHappened, "pump.fun asked you to sign words that aren't a normal sign-in. ZeroFee didn't sign them.");
    assert.equal(p.money.state, "safe");
    assert.equal((p.money as { where: string }).where, agent ? "in AgentZero's wallet" : "still in your pump.fun wallet");
    assert.deepEqual(p.next, { kind: "nothing", label: "Back to pump.fun" });
    assert.match(p.more ?? "", /Nothing was signed\.$/);
    assert.doesNotMatch(JSON.stringify(p), /pocket/, "53: never 'pocket' to the person");
    // control: a known sign-in on a fresh device shows nothing
    const d2 = await device();
    const quiet: Problem[] = [];
    const s2 = stubSite("pump.fun", createWalletEngine({ bridge: d2.bridge, site: siteRules({}), emit: () => undefined, askConnect: async () => true, problem: (q) => void quiet.push(q) }), agent ? agentWindow : () => ({}));
    const [b] = await s2.connect();
    await s2.signIn(`Sign in to pump.fun: ${Date.now()}`, b!);
    assert.equal(quiet.length, 0);
  }
});

test("QA: a page spamming reconnects of an approved session hits its own cap (one per page load, 20 an hour) and the person's tap still signs; never uncapped", async () => {
  const real = Date.now;
  let now = real();
  Date.now = () => now;
  try {
    const d = await device();
    const pocket = await d.wallets.create("site", "sol", undefined, "gmgn");
    const site = { origin: "https://gmgn.ai" };
    const ask = (o: { tap: boolean; load?: string }) => d.wallets.signMessage(pocket.id, Buffer.from(gmgnText(pocket.address, new Date(now).toISOString())).toString("base64"), site, "Browser", "browser", undefined, o.tap, o.load);
    const tooSoon = (e: any) => /too soon/.test(e?.problem?.more ?? "");
    // the person signs in (a tap): the session is approved
    assert.ok((await ask({ tap: true, load: "L0" })).signedIn);
    // re-runs, no tap: one per page load
    now += 1_000;
    assert.ok((await ask({ tap: false, load: "L1" })).signedIn, "the re-run on a new page load signs (no 30 s gap for it)");
    await assert.rejects(ask({ tap: false, load: "L1" }), tooSoon, "a second on the same page load is refused");
    await assert.rejects(ask({ tap: false }), tooSoon, "no load named: no re-run room at all (never uncapped)");
    // a page that reloads to spam: 20 an hour, then refused
    for (let i = 2; i <= SIGN_IN_RERUN_PER_HOUR; i++) {
      now += 1_000;
      assert.ok((await ask({ tap: false, load: `L${i}` })).signedIn, `re-run ${i}`);
    }
    now += 1_000;
    await assert.rejects(ask({ tap: false, load: "L-spam" }), tooSoon, "the 21st re-run in the hour is refused");
    // the person's own tap still signs: the re-runs never drew on their six (past the 30 s gap since their last tap)
    now += 30_000;
    assert.ok((await ask({ tap: true, load: "L-spam" })).signedIn, "the person's tap works after the spam");
    // and the hour passes: the re-run room opens again (control: it is a cap, not a ban)
    now += 3_600_000;
    assert.ok((await ask({ tap: false, load: "L-later" })).signedIn);
  } finally {
    Date.now = real;
  }
});

test("QA control: a first sign-in with no tap and no approved session is the person's room, as before (six an hour, 30 s apart)", async () => {
  const d = await device();
  const w = await d.wallets.create("site", "sol", undefined, "gmgn");
  const site = { origin: "https://gmgn.ai" };
  const ask = (load: string) => d.wallets.signMessage(w.id, Buffer.from(gmgnText(w.address)).toString("base64"), site, "Browser", "browser", undefined, false, load);
  assert.ok((await ask("A")).signedIn);
  // now approved: the next with no tap is a re-run on a new load (signs), then the same load again is refused
  assert.ok((await ask("B")).signedIn);
  await assert.rejects(ask("B"));
});

test("d: AgentZero's sign-in row is in Activity, under AgentZero, with the copy review's words, and in AgentZero's receipts", () => {
  const at = Date.UTC(2026, 10, 5, 8, 0, 0);
  agentSignInRow("gmgn.ai", "GMGN", at);
  const row = taskStore().list().find((t) => t.id === `signin:gmgn.ai:${at}`);
  assert.ok(row, "the row is kept");
  assert.equal(row!.app, "agentzero");
  assert.equal(row!.title, "AgentZero signed in to GMGN");
  assert.equal(row!.state, "done");
  assert.equal(row!.endedAt, at, "its time, the row's sub-line");
  assert.equal(agentZeroSteps()[0]?.line, "AgentZero signed in to GMGN");
});

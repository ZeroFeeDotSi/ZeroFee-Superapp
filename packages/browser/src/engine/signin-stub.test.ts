// Ledger row 4 (3–4 Nov). No live site
// (no bot check is ever worked around): a LOCAL stub of each site, in this process, that speaks the Solana Wallet
// Standard as the real sites' wallet lists do (it collects what registers, connects, then asks its sign-in message), with
// the REAL pinned provider.js in the page, the REAL Browser wallet engine, and the REAL core's site wallets signing.
// Each sign-in step also leaves its trace point (shell-api step-trace.ts: inject, connect, sign request, sign reply,
// session saved, session restored) with fixed words only, never an address or a signature. Failure controls: a message
// outside the allow-list, a stale one, a second within the sign-in room's gap, a sign before connecting, and a reload /
// app close that must come back connected from the kept store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { SubWallets } from "../../../core/src/subwallets.ts";
import { MemoryVault } from "../../../core/src/vault.ts";
import type { SolChain } from "../../../core/src/solana.ts";
import { ProblemError } from "../../../core/src/problem.ts";
import { fromBase58 } from "../../../core/src/sol/bytes.ts";
import { setStepSink, type StepNote } from "@zerofee/shell-api/step-trace.ts";
import { createWalletEngine } from "./engine.ts";
import { siteRules } from "../sites.ts";

const PROVIDER = readFileSync(new URL("../provider/provider.js", import.meta.url), "utf8");
const enc = new TextEncoder();

/** The device: the core's site wallets and the engine's kept store (it outlives an engine: an app close). */
async function device() {
  const store = new Map<string, string>();
  const wallets = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm: {} as never, approve: async () => false, emit: () => undefined });
  const made = new Map<string, Promise<{ id: string; address: string }>>();
  const forSite: Record<string, string> = { "pump.fun": "pump", "gmgn.ai": "gmgn" };
  const bridge: Bridge = {
    async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      try {
        if (method === "device.store.get") return { ok: { value: store.get(String(p.key)) ?? null } as T };
        if (method === "device.store.set") return (store.set(String(p.key), String(p.value)), { ok: { ok: true } as T });
        if (method.startsWith("device.")) return { ok: { ok: true } as T };
        if (method === "subwallet.site.forHost") {
          const host = new URL(String((p.site as { origin: string }).origin)).host;
          if (!made.has(host)) made.set(host, wallets.create("site", "sol", undefined, forSite[host]) as never);
          return { ok: (await made.get(host)) as T };
        }
        // the Browser engine's own calls are stamped app "browser" by forApps on the phone
        if (method === "subwallet.signMessage") return { ok: (await wallets.signMessage(p.id, p.message, p.site, "Browser", "browser")) as T };
        throw new Error(`not stubbed: ${method}`);
      } catch (e) {
        if (e instanceof ProblemError) return { problem: e.problem };
        throw e;
      }
    },
    on: () => () => undefined,
  };
  return { store, bridge, wallets };
}

/** The stub site: https://<host>, its page world with provider.js and the host's zerofeeWallet handler (the origin and
 *  frame from the "WebKit" side, never the page), and the site's own wallet-standard app. */
function stubSite(host: string, engine: ReturnType<typeof createWalletEngine>) {
  let id = 0;
  const window = new EventTarget() as EventTarget & Record<string, unknown>;
  window.webkit = { messageHandlers: { zerofeeWallet: { postMessage: async (m: { id: number; method: string; params: unknown }) => engine.handle({ ...m, id: ++id, origin: `https://${host}`, mainFrame: true }) } } };
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
    /** The site's Connect → ZeroFee (or, silent, its own reconnect after a reload). */
    connect: async (silent = false) => (await zf().features["standard:connect"].connect({ silent })).accounts as { address: string }[],
    /** The site's sign-in: its own message, through solana:signMessage. */
    signIn: async (text: string, account?: { address: string }) => {
      const w = zf();
      const [out] = await w.features["solana:signMessage"].signMessage({ account: account ?? w.accounts[0] ?? { address: "none" }, message: enc.encode(text) });
      return out as { signature: Uint8Array };
    },
  };
}

const engineOn = (bridge: Bridge) => createWalletEngine({ bridge, site: siteRules({}), emit: () => undefined, askConnect: async () => true });
const gmgnText = (address: string, o: { extra?: string; issued?: string } = {}) =>
  `gmgn.ai wants you to sign in with your Solana account:\n${address}\n\nwallet_sign_statement\n\nURI: https://gmgn.ai\nVersion: 1\nChain ID: mainnet\nNonce: a1b2c3d4e5f6\nIssued At: ${o.issued ?? new Date().toISOString()}${o.extra ?? ""}`;
function traced() {
  const notes: StepNote[] = [];
  setStepSink((n) => notes.push(n));
  return notes;
}
const steps = (notes: StepNote[], host: string) => notes.filter((n) => n.host === host).map((n) => `${n.s}:${n.r}`);

test("GMGN (stub): ZeroFee is in its wallet list, connects, and signs GMGN's sign-in with no sheet; each step is traced (inject, session saved, connect, sign request, sign reply ok)", async () => {
  const notes = traced();
  const d = await device();
  const site = stubSite("gmgn.ai", engineOn(d.bridge));
  const [account] = await site.connect();
  assert.ok(account?.address);
  const text = gmgnText(account!.address);
  const { signature } = await site.signIn(text, account);
  assert.ok(ed25519.verify(signature, enc.encode(text), fromBase58(account!.address)), "the site wallet's own signature over GMGN's exact words");
  assert.deepEqual(steps(notes, "gmgn.ai"), ["signin.inject:ok", "signin.session.saved:preapproved", "signin.connect:asked", "signin.sign.request:sol", "signin.sign.reply:ok"]);
  // fixed words only: no address, no signature, no message in any trace point
  const all = JSON.stringify(notes);
  assert.ok(!all.includes(account!.address) && !all.includes(Buffer.from(signature).toString("base64")) && !all.includes("wallet_sign_statement"));
  setStepSink(null);
});

test("pump.fun (stub): its own 'Sign in to pump.fun: <ms>' signs with no sheet (control: a stale one, and a standard one with Resources, are refused and the trace names the rule)", async () => {
  const notes = traced();
  const d = await device();
  const site = stubSite("pump.fun", engineOn(d.bridge));
  const [account] = await site.connect();
  const text = `Sign in to pump.fun: ${Date.now()}`;
  const { signature } = await site.signIn(text, account);
  assert.ok(ed25519.verify(signature, enc.encode(text), fromBase58(account!.address)));
  assert.deepEqual(steps(notes, "pump.fun").slice(-1), ["signin.sign.reply:ok"]);
  // a fresh device each (the sign-in room is per wallet: these controls must not be read as "too soon")
  const refusedWith = async (words: (a: string) => string, why: string) => {
    const n = traced();
    const dd = await device();
    const s = stubSite("pump.fun", engineOn(dd.bridge));
    const [a] = await s.connect();
    await assert.rejects(s.signIn(words(a!.address), a), (e: { code?: number }) => e.code === -32603, why);
    assert.deepEqual(steps(n, "pump.fun").slice(-1), [`signin.sign.reply:${why}`]);
  };
  await refusedWith(() => `Sign in to pump.fun: ${Date.now() - 10 * 60_000}`, "stale");
  await refusedWith((a) => `pump.fun wants you to sign in with your Solana account:\n${a}\n\nSign in to pump.fun\n\nURI: https://pump.fun\nVersion: 1\nChain ID: mainnet\nNonce: a1b2c3d4e5f6\nIssued At: ${new Date().toISOString()}\nResources:\n- https://privy.io`, "resources-or-request-id");
  await refusedWith(() => "Welcome! Click to sign in and accept the pump.fun terms.", "not-a-sign-in");
  setStepSink(null);
});

test("a second sign-in within the room's gap is refused and traced as 'room' (control: the first signed); a sign before connecting is refused in the page, never asked", async () => {
  const notes = traced();
  const d = await device();
  const site = stubSite("gmgn.ai", engineOn(d.bridge));
  await assert.rejects(site.signIn(gmgnText("11111111111111111111111111111111"), { address: "11111111111111111111111111111111" }), (e: { code?: number }) => e.code === 4100);
  // provider.js itself refuses a sign for an account it wasn't given, before the host is asked: no sign step
  assert.ok(!steps(notes, "gmgn.ai").some((s) => s.startsWith("signin.sign")));
  const [account] = await site.connect();
  await site.signIn(gmgnText(account!.address), account);
  await assert.rejects(site.signIn(gmgnText(account!.address), account));
  assert.deepEqual(steps(notes, "gmgn.ai").filter((s) => s.startsWith("signin.sign.reply")), ["signin.sign.reply:ok", "signin.sign.reply:room"]);
  setStepSink(null);
});

test("the session survives a reload and an app close: a new page and a new engine on the same device answer the site's silent reconnect with the same wallet, traced 'kept' (control: a device that never connected is not restored)", async () => {
  const notes = traced();
  const d = await device();
  const [first] = await stubSite("gmgn.ai", engineOn(d.bridge)).connect();
  // the app closes: the engine and the page go; the device's store and its wallets stay
  const [again] = await stubSite("gmgn.ai", engineOn(d.bridge)).connect(true);
  assert.equal(again?.address, first?.address, "the same site wallet, connected with no ask");
  assert.ok(steps(notes, "gmgn.ai").includes("signin.session.restored:kept"));
  // control: a fresh device's typed (unknown, not pre-approved) site's silent reconnect gets no address
  const n2 = traced();
  const fresh = await device();
  assert.equal((await stubSite("example.org", engineOn(fresh.bridge)).connect(true)).length, 0);
  assert.deepEqual(steps(n2, "example.org"), ["signin.inject:ok", "signin.session.restored:none"]);
  setStepSink(null);
});

test("rule 8: a refused sign-in's screen names the site's sign-in, the money by its wallet's name and the core's own cause, never 'This wallet can't approve this ... in that wallet' (control: a signed one shows no screen)", async () => {
  const d = await device();
  const shown: { code: string; whatHappened: string; money: { where?: string }; next: { label: string }; more?: string }[] = [];
  const engine = createWalletEngine({ bridge: d.bridge, site: siteRules({}), emit: () => undefined, askConnect: async () => true, problem: (p) => void shown.push(p as never) });
  const site = stubSite("pump.fun", engine);
  const [a] = await site.connect();
  await site.signIn(`Sign in to pump.fun: ${Date.now()}`, a);
  assert.equal(shown.length, 0, "control: a signed sign-in shows nothing");
  await assert.rejects(site.signIn(`Sign in to pump.fun: ${Date.now()}`, a));
  assert.equal(shown.length, 1);
  const p = shown[0]!;
  assert.equal(p.code, "browser.signin.refused");
  assert.match(p.whatHappened, /pump\.fun/);
  assert.match(p.money.where ?? "", /pump\.fun wallet/);
  assert.match(p.more ?? "", /too soon/, "the core's own cause, said under it");
  assert.doesNotMatch(JSON.stringify(p), /that wallet|can't approve this/);
});

test("a trace point carries fixed words only: a host or reason that isn't the fixed shape is replaced (control: a plain host and word pass)", async () => {
  const { noteStep } = await import("@zerofee/shell-api/step-trace.ts");
  setStepSink(() => undefined); // the steps kept while no recorder listened (the earlier tests') go there first
  const notes = traced();
  noteStep("signin.connect", "pump.fun", "asked", 12.4);
  noteStep("signin.connect", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU wants", "Sign in to pump.fun: 1730000000000");
  assert.deepEqual(JSON.parse(JSON.stringify(notes)), [{ s: "signin.connect", host: "pump.fun", r: "asked", ms: 12 }, { s: "signin.connect", host: "?", r: "other" }]);
  setStepSink(null);
});

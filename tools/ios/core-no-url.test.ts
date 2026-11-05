// The phone's core bundle where the phone runs it: Swift's own JavaScriptCore context (CoreContext.swift), which has the
// language's own globals and nothing of WebKit's: no URL, no crypto.subtle, no WebSocket. What a browser would give,
// the core gets only from apps/ios/core/shims.ts (built on Swift's `__native`). The web build has all of it, so no web
// test can see a missing one, and each one found so far was found on the test iPhone:
// - 2 Nov, URL: relayBase's `new URL` threw, so the core started without its relay and every Top up said "This isn't
//   something your separate wallet can sign"; Security's "Your key" card said "Something went wrong on our side"
//   (account.keyProof: "ReferenceError: Can't find variable: URL"); and every site's request read as naming no site.
// - 2 Nov, crypto.subtle: subwallet.import (linking the laptop's extension) opened the box with WebCrypto; the TypeError
//   fell into the import's own catch, so every right code read as "That code didn't open it".
//
// So here the real bundle (apps/ios/core/build.mjs) runs in node:vm with exactly a bare JSContext's globals (the list
// below, which apps/ios/check/core-watch.sh checks against a real JSContext each run), behind a fake Swift (`__native`)
// on fake nodes, and:
// - every core method family is called, at least to its first network call or sheet; any ReferenceError or TypeError
//   in an answer, an unhandled rejection or a timer's throw fails;
// - the same calls run again in a control context that differs ONLY by what a browser adds (URL, URLSearchParams,
//   structuredClone, WebCrypto, ...): an answer that differs is a phone-only path;
// - a read of anything the shims' objects don't have (crypto.subtle, AbortSignal.any, a Response's body ...) is caught
//   as it happens, even where the core's own catch would swallow the error;
// - statically, every free name the bundle reads (TypeScript's binder: scope-aware, so locals never count) and every
//   member it reads off a shimmed global must be one the phone's context really has.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { randomBytes, scrypt as nodeScrypt, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { scrypt } from "@noble/hashes/scrypt.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { SoftwareKey } from "../../packages/core/src/device-key.ts";
import { handleOf } from "../../packages/core/src/dev-signer.ts";
import { forApps, type Bridge, type BridgeResult } from "../../packages/core/src/bridge.ts";
import { base58, base64, cat, fromBase58, u64le, utf8 } from "../../packages/core/src/sol/bytes.ts";
import { HOT_ROOT, hotRoot } from "../../packages/core/src/hot-keys.ts";
import { createWalletEngine } from "../../packages/browser/src/engine/engine.ts";
import { siteRules } from "../../packages/browser/src/sites.ts";

const at = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const ACCOUNT = "zf-0123456789.near";
const RELAY = "https://quotes-seven-gamma.vercel.app";

/** A bare JSContext's own globals (apps/ios/check/core-watch.sh prints and checks them in a real one, every run). */
const JSC_GLOBALS = readFileSync(at("tools/ios/jsc-globals.txt"), "utf8").split("\n").filter((l) => !l.startsWith("#")).join(" ").split(/\s+/).filter(Boolean);
/** What shims.ts installs where the context lacks it, and the two names Swift and the bundle put there themselves. */
const SHIMMED = ["TextEncoder", "TextDecoder", "btoa", "atob", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "AbortSignal", "AbortController", "Headers", "Response", "fetch", "performance", "crypto"];
const OWN = ["__native", "ZeroFeeCore"];
/** The members the shims' objects have: a read of any other is a phone-only crash (or a swallowed one). */
const SHIM_MEMBERS: Record<string, string[]> = { crypto: ["getRandomValues"], performance: ["now"], AbortSignal: ["timeout", "abort"] };
/**
 * Reads of a missing member that are feature checks, each with the reason it can't throw. Anything else read off a
 * shimmed object that it doesn't have fails the run.
 */
const GUARDED_READS: Record<string, string> = {
  // net.ts: `if (!res.body || typeof res.body.getReader !== "function")` reads the answer whole (Swift's fetch is whole, ≤ 2 MB)
  "Response.body": "net.ts reads the answer whole when there is no stream",
};
/** What a browser has and JavaScriptCore doesn't, given only to the control context. */
const BROWSER_ONLY = { URL, URLSearchParams, structuredClone, crypto: webcrypto, Blob, navigator: { userAgent: "control" } };

let built: string | undefined;
function script(): string {
  if (built) return built;
  execFileSync(process.execPath, [at("apps/ios/core/build.mjs")], { stdio: ["ignore", "ignore", "inherit"] });
  return (built = readFileSync(at("apps/ios/core/dist/zerofee-core.js"), "utf8"));
}

type World = "phone" | "browser";
const FAULT = /ReferenceError|TypeError|Can't find variable|is not defined|is not a function|is not a constructor|undefined is not an object|Cannot read propert/;

/** A real-looking mainnet node for the few reads every family starts with; anything else isn't served (a network Problem). */
function rpc(handle: string, body: { id: unknown; method: string; params: any }) {
  if (body.method === "block") return { result: { header: { height: 1000, hash: "4dYUuPfEnAGVhXZHqnDzPWpNn6aDcHKZZKGfXUCNhoa7", timestamp_nanosec: String(Date.now() * 1e6) } } };
  if (body.method === "query" && body.params?.request_type === "view_access_key_list") {
    return { result: { keys: [{ public_key: handle, access_key: { nonce: 0, permission: { FunctionCall: { allowance: null, receiver_id: ACCOUNT, method_names: ["execute"] } } } }] } };
  }
  // Solana's two nodes, for a site's transaction: the blockhash is good and the simulation sends 0.001 SOL and its fee
  if (body.method === "isBlockhashValid") return { result: { value: true } };
  if (body.method === "getBalance") return { result: { value: 1_000_000_000 } };
  if (body.method === "getMultipleAccounts") return { result: { value: [] } };
  if (body.method === "simulateTransaction") return { result: { value: { err: null, accounts: [{ lamports: 1_000_000_000 - 1_005_000, owner: "11111111111111111111111111111111", data: ["", "base64"], executable: false }] } } };
  return null;
}

/**
 * The bundle started as Swift starts it (network, relay), in a context with exactly a bare JSContext's globals (and, for
 * "browser", the control, what a browser adds), on fake mainnet nodes. Every sheet is answered `approve` (default no).
 */
function coreIn(world: World, publicKey: string, o: { approve?: boolean; hotRoot?: boolean; fast?: boolean; scrypt?: "native" | "fails" } = {}) {
  const handle = handleOf(publicKey);
  const vault = new Map([["state", Buffer.from(JSON.stringify({ accountId: ACCOUNT, stage: "ready", recoveryIn: true })).toString("base64")]]);
  if (o.hotRoot) vault.set(HOT_ROOT, Buffer.from(hotRoot(randomBytes(32))).toString("base64"));
  const asked: string[] = [];
  const sheets: string[] = [];
  const faults: string[] = [];
  /** `o.scrypt`: Swift's scrypt (CoreContext.swift), here node's, off the test's thread; each call's parameters kept. */
  const scrypts: { N: number; r: number; p: number; dkLen: number }[] = [];
  const native = {
    ...(o.scrypt
      ? {
          scrypt(spec: string, done: (r: string) => void) {
            const s = JSON.parse(spec) as { password: string; salt: string; N: number; r: number; p: number; dkLen: number };
            scrypts.push({ N: s.N, r: s.r, p: s.p, dkLen: s.dkLen });
            if (o.scrypt === "fails") return setImmediate(() => done(JSON.stringify({ error: "not scrypt's parameters" })));
            nodeScrypt(Buffer.from(s.password, "base64"), Buffer.from(s.salt, "base64"), s.dkLen, { N: s.N, r: s.r, p: s.p, maxmem: 256 * 1024 * 1024 }, (e, key) =>
              done(JSON.stringify(e ? { error: e.message } : { key: key.toString("base64") })),
            );
          },
        }
      : {}),
    fetch(url: string, init: string, done: (r: string) => void) {
      asked.push(url);
      const { body } = JSON.parse(init) as { body: string | null };
      let a: unknown = null;
      try {
        a = body ? rpc(handle, JSON.parse(Buffer.from(body, "base64").toString("utf8"))) : null;
      } catch {
        a = null;
      }
      if (!a) return setImmediate(() => done(JSON.stringify({ error: "not served here" })));
      const id = JSON.parse(Buffer.from(body!, "base64").toString("utf8")).id;
      setImmediate(() => done(JSON.stringify({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, ...(a as object) })).toString("base64") })));
    },
    random: (n: number) => [...randomBytes(n)],
    // unref: the core keeps its own timers running (its watch, its read pace); the test ends when its calls have answered.
    // A throw in a timer is the context's uncaught exception (CoreContext.swift logs it and goes on): recorded here.
    // `o.fast`: every wait a 25th as long (the core's retries and read pace on nodes that never answer), the same in both worlds.
    setTimer: (ms: number, fire: () => void) =>
      Number(
        setTimeout(() => {
          try {
            fire();
          } catch (e) {
            faults.push(`a timer threw: ${String((e as Error)?.stack ?? e)}`);
          }
        }, o.fast ? ms / 25 : ms).unref(),
      ),
    clearTimer: (id: number) => clearTimeout(id),
    log: () => {},
    vault(op: string, name: string, bytes: string, done: (r: string) => void) {
      if (op === "get") return done(JSON.stringify({ bytes: vault.get(name) ?? null }));
      if (op === "put") vault.set(name, bytes);
      else vault.delete(name);
      done(JSON.stringify({ bytes: "" }));
    },
    approve: (words: string, done: (yes: boolean) => void) => (sheets.push(String((JSON.parse(words) as { title?: unknown }).title)), done(o.approve === true)),
    key(op: string, _p: string, done: (r: string) => void) {
      if (op === "sign" || op === "signAlertsProof" || op === "signChatName") sheets.push(`the chip's sheet (${op})`);
      if (op === "approval-state") return done(JSON.stringify({ ok: { changed: false } }));
      done(JSON.stringify(op === "info" || op === "proof" ? { ok: { publicKey, held: true } } : { ok: { declined: true } }));
    },
    resource: () => "",
    emit: () => {},
    words: (_s: string, done: (r: string) => void) => (sheets.push("the words screen"), done("null")),
    secret: (_s: string, done: (b: boolean) => void) => (sheets.push("the key screen"), done(false)),
    typeWords: (_s: string, done: (r: string) => void) => (sheets.push("the typing screen"), done("null")),
  };
  const context = vm.createContext({});
  // node:vm adds a few names a JSContext doesn't have (explicit resource management, SharedArrayBuffer): taken away, so
  // the context's own names are exactly the real JSContext's.
  for (const name of vm.runInContext("Object.getOwnPropertyNames(globalThis)", context) as string[]) if (!JSC_GLOBALS.includes(name)) vm.runInContext(`delete globalThis[${JSON.stringify(name)}]`, context);
  assert.deepEqual([...(vm.runInContext("Object.getOwnPropertyNames(globalThis)", context) as string[])].sort(), [...JSC_GLOBALS].sort(), "the control: the context's globals are exactly a bare JSContext's");
  assert.equal(vm.runInContext("typeof URL + typeof crypto + typeof WebSocket", context), "undefinedundefinedundefined");
  const missing: string[] = [];
  if (world === "browser") Object.assign(context, BROWSER_ONLY);
  else {
    // Each shimmed object as the shims install it, behind a proxy that records a read of a member it doesn't have.
    const watch = (label: string, target: object) =>
      new Proxy(target, {
        get(t, k, r) {
          // (The shims' own install reads crypto.getRandomValues before it sets it: a member the object will have isn't missing.)
          if (typeof k === "string" && !(k in t) && !SHIM_MEMBERS[label]?.includes(k) && k !== "then" && k !== "toJSON") missing.push(`${label}.${k}`);
          return Reflect.get(t, k, r);
        },
      });
    const slots: Record<string, unknown> = {};
    for (const name of ["crypto", "performance", "AbortSignal", "fetch"]) {
      Object.defineProperty(context, name, {
        configurable: true,
        enumerable: false,
        get: () => slots[name],
        set: (v) => {
          slots[name] =
            name === "fetch" && typeof v === "function"
              ? (...a: unknown[]) => (v as (...a: unknown[]) => Promise<object>)(...a).then((res) => watch("Response", res))
              : v && (typeof v === "object" || typeof v === "function")
                ? watch(name, v)
                : v;
        },
      });
    }
  }
  context.__native = native;
  vm.runInContext(script(), context, { filename: "zerofee-core.js" });
  const core = vm.runInContext("ZeroFeeCore", context) as { start(c: string): string; call(m: string, p: string, done: (j: string) => void): void };
  assert.equal(core.start(JSON.stringify({ network: "mainnet", relay: RELAY })), "ok");
  const call = (method: string, params: Record<string, unknown> = {}, ms = 20_000) =>
    new Promise<any>((resolve) => {
      const t = setTimeout(() => resolve({ timeout: ms }), ms);
      // the page's shell stamps its own calls (asShell, audit pass 2 item 2): the phone's core refuses one that names no app
      core.call(method, JSON.stringify(params.app === undefined ? { ...params, app: "shell" } : params), (j) => (clearTimeout(t), resolve(JSON.parse(j))));
    });
  /** A call exactly as sent, unstamped: what the phone's core says to a call that names no app. */
  const raw = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((resolve) => core.call(method, JSON.stringify(params), (j) => resolve(JSON.parse(j))));
  return { call, raw, asked, sheets, faults, missing, scrypts };
}

test("audit pass 2, item 2: the phone's own core refuses a call that names no app, or app \"\"; the shell's stamped call answers", { timeout: 120_000 }, async () => {
  const { call, raw } = coreIn("phone", SoftwareKey.generate().publicKey);
  for (const m of ["subwallet.export", "recovery.cancel", "subwallet.private.home", "account.keyProof"]) {
    for (const p of [{}, { app: "" }]) assert.equal((await raw(m, p)).problem?.code, "security.request.not-allowed", `${m} ${JSON.stringify(p)}`);
  }
  assert.ok("ok" in (await call("account.keyProof")), "the shell's own (stamped) call answers");
});

/** The original test's name for the phone's own context. */
const phoneCore = (_script: string, publicKey: string, o: { approve?: boolean } = {}) => coreIn("phone", publicKey, o);

test("the phone's core, with no URL in its context: Security's Your key card answers from two nodes", { timeout: 120_000 }, async () => {
  const key = SoftwareKey.generate();
  const { call, asked } = phoneCore(script(), key.publicKey);
  const proof = await call("account.keyProof");
  assert.ok("ok" in proof, `account.keyProof answers, not ${JSON.stringify(proof.problem)}`);
  assert.equal(proof.ok.matches, true);
  assert.equal(proof.ok.nodes.length, 2);
  for (const n of proof.ok.nodes) assert.ok(/^[a-z0-9.-]+$/.test(n.node) && n.found, `each node named by its host: ${n.node}`);
  assert.ok(asked.length > 0, "the control: it read the nodes");
});

test("the phone's core, with no URL in its context: a Top up's quote has the relay the build gave it", { timeout: 120_000 }, async () => {
  const { call } = phoneCore(script(), SoftwareKey.generate().publicKey);
  // The relay reached the core: the quote goes on to its next check (no Trading balance on this phone yet), never "isn't
  // set up". Nothing here reaches the network: the float is the core's own list.
  const quote = await call("subwallet.float.quoteAdd", { amount: "700000000000000000000000", tokenId: "nep141:wrap.near", app: "trade" });
  assert.equal(quote.problem?.code, "security.subwallet.refused");
  assert.equal(quote.problem?.more, "Move money to your NEAR wallet first.");
});

test("the phone's core, with no URL in its context: a site's sign-in is read for the site that asked, and signed with no sheet", { timeout: 120_000 }, async () => {
  // Swift gives every site request its { origin } from WebKit (IsolatedCore.swift site()); the core read it with URL, so on
  // the phone every site's request was refused as if it named no site: pump.fun's Sign in never reached the sheet.
  // D143 (core approval-policy.ts): a hot key never asks, so the site read is the one named in each answer here.
  const { call, sheets } = phoneCore(script(), SoftwareKey.generate().publicKey);
  const site = { origin: "https://app.example.com" };
  // audit C1: the shared chain wallet signs nothing for a site; the site's own wallet is made on first connect
  const shared = await call("subwallet.create", { chain: "sol", app: "browser" });
  const refused = await call("subwallet.signMessage", { id: shared.ok.id, message: Buffer.from("hi").toString("base64"), site, app: "browser" });
  assert.equal(refused.problem?.more, "This site can use only its own wallet.");
  const made = await call("subwallet.site.forHost", { chain: "sol", site, app: "browser" });
  assert.ok("ok" in made, JSON.stringify(made));
  const ask = (text: string) => call("subwallet.signMessage", { id: made.ok.id, message: Buffer.from(text).toString("base64"), site, app: "browser" });
  // words that aren't a sign-in: refused naming the site (its origin read with no URL), not as naming no site; nothing signed
  const words = await ask("Welcome to app.example.com! Sign to continue.");
  assert.equal(words.problem?.code, "security.subwallet.refused", JSON.stringify(words));
  assert.match(words.problem?.more ?? "", /^app\.example\.com asked to sign words that aren't a sign-in\. Nothing was signed\.$/i);
  // a sign-in for another site: refused, naming both, so the page's own site was read and compared
  const siws = (domain: string) => `${domain} wants you to sign in with your Solana account:\n${made.ok.address}\n\nSign in to ${domain}\n\nURI: https://${domain}\nVersion: 1\nChain ID: mainnet\nNonce: 8f2a91c4\nIssued At: ${new Date().toISOString()}`;
  const other = await ask(siws("evil.example"));
  assert.equal(other.problem?.code, "security.subwallet.refused", JSON.stringify(other));
  assert.match(other.problem?.more ?? "", /for evil\.example, not app\.example\.com, the site that asked\. Nothing was signed\.$/);
  // control: its plain sign-in (Sign In With Solana for the site, this wallet): signed by the wallet, with no sheet
  const text = siws("app.example.com");
  const signed = await ask(text);
  assert.ok("ok" in signed, JSON.stringify(signed));
  assert.equal(signed.ok.signedIn, true);
  assert.ok(ed25519.verify(Buffer.from(signed.ok.signature, "base64"), Buffer.from(text), fromBase58(made.ok.address)), "the wallet's signature");
  assert.deepEqual(sheets, [], "no sheet: a hot key never asks");
});

/** A plain SOL transfer from `from`, legacy message, one empty signature slot (as connect-flow.test.ts builds it). */
function transfer(from: string, to: string, lamports: bigint): string {
  const keys = [from, to, "11111111111111111111111111111111"];
  const message = cat([1, 0, 1], [keys.length], ...keys.map(fromBase58), fromBase58(base58(new Uint8Array(32).fill(5))), [1], [2, 2, 0, 1, 12], cat([2, 0, 0, 0], u64le(lamports)));
  return base64(cat([1], new Uint8Array(64), message));
}

test("Apps' pump.fun on the phone's core, no URL in its context: Connect, its own sign-in, a message and a transaction, each answered with no sheet (D143)", { timeout: 120_000 }, async () => {
  // The Browser wallet engine (packages/browser) asks as "browser", as the phone's page does; Swift gives every signature
  // the waiting partner window's origin from WebKit (IsolatedCore.swift callIsolatedCore → site()). Any sheet says yes,
  // and none may open: the site's own wallet is a hot key (core approval-policy.ts).
  const host = "pump.fun", origin = `https://${host}`;
  const { call, sheets } = phoneCore(script(), SoftwareKey.generate().publicKey, { approve: true });
  const SITE = new Set(["subwallet.signTx", "subwallet.sign", "subwallet.signMessage", "subwallet.signTypedData"]);
  const swiftCore: Bridge = {
    call: <T,>(method: string, p: Record<string, unknown> = {}) => call(method, SITE.has(method) && p.app === "browser" ? { ...p, site: { origin } } : p) as Promise<BridgeResult<T>>,
    on: () => () => {},
  };
  const store = new Map<string, string>();
  const asBrowser = forApps(swiftCore, "browser");
  const page: Bridge = {
    async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      if (method === "device.store.get") return { ok: { value: store.get(String(p.key)) ?? null } as T };
      if (method === "device.store.set") return (store.set(String(p.key), String(p.value)), { ok: { ok: true } as T });
      if (method.startsWith("device.")) return { ok: { ok: true } as T };
      return asBrowser.call<T>(method, p);
    },
    on: (e, h) => asBrowser.on(e, h),
  };
  const problems: string[] = [];
  const engine = createWalletEngine({ bridge: page, site: siteRules({}), emit: () => {}, askConnect: async () => true, problem: (p) => problems.push(`${p.code}: ${p.more ?? p.whatHappened}`) });
  let id = 0;
  const reply = (method: string, params?: unknown) => engine.handle({ id: ++id, method, params, origin, mainFrame: true });
  const ask = async (method: string, params?: unknown) => {
    const r = await reply(method, params);
    assert.ok("result" in r, `${method} answered, not ${JSON.stringify(r)} (${problems.join(" | ")})`);
    return r as { result: Record<string, string>; signedIn?: true };
  };
  /** A refusal, named, with nothing signed: the page gets an error, never a signature. */
  const refused = async (method: string, params: unknown, why: RegExp, code = "browser.signin.refused") => {
    const told = problems.length;
    const r = await reply(method, params);
    assert.ok("error" in r && !("result" in r), `${method}: refused, not ${JSON.stringify(r)}`);
    assert.equal(problems.length, told + 1, "the person is told why");
    // rule 8 (fix/site-signin): a refused sign-in is the Browser's own Problem, by the site's name, the core's cause under it
    // (the Problem screen, never an approve sheet: `sheets` below stays empty, D143 holds)
    assert.ok(problems.at(-1)!.startsWith(`${code}: `), problems.at(-1));
    assert.match(problems.at(-1)!, /Nothing was signed\.$/);
    assert.match(problems.at(-1)!, why);
  };

  const account = (await ask("solana:connect", {})).result;
  const key = fromBase58(account.address!);
  // pump.fun's own sign-in, as it signs in on the phone (ST4: "Sign in to pump.fun: <its clock in ms>"): no sheet
  const own = `Sign in to ${host}: ${Date.now()}`;
  const signIn = await ask("solana:signMessage", { address: account.address, message: Buffer.from(own).toString("base64") });
  assert.ok(ed25519.verify(Buffer.from(signIn.result.signature!, "base64"), Buffer.from(own), key), "the sign-in signature is the connected wallet's");
  assert.equal(signIn.signedIn, true, "the host is told it was a plain sign-in");
  // a second sign-in within 30 s (here Sign In With Solana): refused, so a page's script can't collect them
  const siws = `${host} wants you to sign in with your Solana account:\n${account.address}\n\nSign in to ${host}\n\nURI: ${origin}\nVersion: 1\nChain ID: mainnet\nNonce: 8f2a91c4\nIssued At: ${new Date().toISOString()}`;
  await refused("solana:signMessage", { address: account.address, message: Buffer.from(siws).toString("base64") }, /too soon/);
  // words that aren't a sign-in: refused, on their own sheet (QA, rule 8), named
  await refused("solana:signMessage", { address: account.address, message: Buffer.from("Welcome to pump.fun! Sign to continue.").toString("base64") }, /isn't this site's own sign-in/i, "browser.signin.unknown");
  assert.deepEqual(sheets, [], "no sheet for a sign-in or a message: the site's own wallet is a hot key");
  // a transaction the core's checks don't pass (a plain SOL transfer to someone else; this phone's stand-in nodes don't
  // serve its test run either): never silent (D143 refinement, review H1): the approve sheet asks, saying why first
  const sent = await reply("solana:signTransaction", { address: account.address, transaction: transfer(account.address!, base58(new Uint8Array(32).fill(9)), 1_000_000n), chain: "solana:mainnet" });
  assert.equal(sheets.length, 1, `the approve sheet asked (${JSON.stringify(sent).slice(0, 120)})`);
});

/** The extension's box for the phone's code, as the laptop's panel seals it (WebCrypto there; the core opens it in plain JS). */
async function sealForPhone(typed: string, seed: Uint8Array): Promise<string> {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = await webcrypto.subtle.importKey("raw", new Uint8Array(scrypt(utf8(typed), salt, { N: 2 ** 17, r: 8, p: 1, dkLen: 32 })), "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8("zerofee-extension/link/v1") }, key, seed));
  return base64(utf8(JSON.stringify({ v: 1, salt: base64(salt), iv: base64(iv), ct: base64(ct) })));
}

test("the phone's core, with no crypto.subtle in its context: linking the laptop's extension opens its box and reaches the sheet", { timeout: 120_000 }, async () => {
  // 2 Nov: the import opened the box with crypto.subtle, which JavaScriptCore doesn't have; the TypeError fell into the
  // import's catch, so on the phone the right code always said security.link.wrong.
  const { call, sheets, missing } = coreIn("phone", SoftwareKey.generate().publicKey);
  const link = await call("subwallet.linkStart", { kind: "extension" });
  assert.ok("ok" in link, JSON.stringify(link));
  const sealed = await sealForPhone(String(link.ok.code).replace("-", ""), new Uint8Array(32).fill(7));
  const opened = await call("subwallet.import", { kind: "extension", sealed });
  assert.equal(opened.problem?.code, "security.link.declined", `the box opened and the sheet was answered no, not ${JSON.stringify(opened)}`);
  assert.deepEqual(sheets, ["Link the wallet in your laptop's ZeroFee panel"]);
  // (The core's own reads in the meantime, its watch's answers, may make net.ts's guarded Response.body check.)
  assert.deepEqual(missing.filter((m) => !(m in GUARDED_READS)), []);
  // The control: a wrong code still doesn't open it.
  await call("subwallet.linkStart", { kind: "extension" });
  const wrong = await call("subwallet.import", { kind: "extension", sealed: await sealForPhone("WRONGCODE0", new Uint8Array(32).fill(7)) });
  assert.equal(wrong.problem?.code, "security.link.wrong");
});

test("the phone's core with Swift's scrypt: the link's key is made off the core's thread, with the same parameters and bytes", { timeout: 120_000 }, async () => {
  // 2 Nov: the link's scrypt (N=2^17) took 21 s in plain JS in the phone's JavaScriptCore, on the core's one queue.
  const { call, sheets, missing, scrypts } = coreIn("phone", SoftwareKey.generate().publicKey, { scrypt: "native" });
  const link = await call("subwallet.linkStart", { kind: "extension" });
  const sealed = await sealForPhone(String(link.ok.code).replace("-", ""), new Uint8Array(32).fill(7));
  const opened = await call("subwallet.import", { kind: "extension", sealed });
  assert.equal(opened.problem?.code, "security.link.declined", `the box opened with Swift's key and the sheet was answered no, not ${JSON.stringify(opened)}`);
  assert.deepEqual(sheets, ["Link the wallet in your laptop's ZeroFee panel"]);
  assert.deepEqual(scrypts, [{ N: 2 ** 17, r: 8, p: 1, dkLen: 32 }], "Swift's scrypt made the key, with the box's parameters");
  // (The core's own reads in the meantime, its watch's answers, may make net.ts's guarded Response.body check.)
  assert.deepEqual(missing.filter((m) => !(m in GUARDED_READS)), []);
  // The control: a wrong code still doesn't open it with Swift's key either.
  await call("subwallet.linkStart", { kind: "extension" });
  const wrong = await call("subwallet.import", { kind: "extension", sealed: await sealForPhone("WRONGCODE0", new Uint8Array(32).fill(7)) });
  assert.equal(wrong.problem?.code, "security.link.wrong");
  assert.equal(scrypts.length, 2);
  // A Swift scrypt that can't answer: the core's own (@noble/hashes) makes the key, so a right code still opens it.
  const failing = coreIn("phone", SoftwareKey.generate().publicKey, { scrypt: "fails" });
  const again = await failing.call("subwallet.linkStart", { kind: "extension" });
  const fallback = await failing.call("subwallet.import", { kind: "extension", sealed: await sealForPhone(String(again.ok.code).replace("-", ""), new Uint8Array(32).fill(7)) });
  assert.equal(fallback.problem?.code, "security.link.declined", JSON.stringify(fallback));
  assert.equal(failing.scrypts.length, 1, "the control: Swift's was asked first");
});

// ── Every method family, on the phone's globals and on a browser's ───────────────────────────────────────────────────

type Call = (method: string, params?: Record<string, unknown>) => Promise<any>;
interface Step {
  method: string;
  answer: any;
}

const SOL_TO = base58(new Uint8Array(32).fill(9));
const EVM_TO = "0x000000000000000000000000000000000000dEaD";
const RECIPIENT = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"; // secp256k1's G: a real x-only key

/**
 * Each family's calls, as the page asks them (with `app` where forApps stamps one), each to its first network call, sheet
 * or answer. Sheets are answered no: nothing is ever signed. Later calls use what earlier ones made (the wallets' ids).
 */
const FAMILIES: Record<string, (call: Call) => Promise<void>> = {
  async account(call) {
    await call("account.state");
    await call("account.recoveryChoices");
    await call("account.keyProof");
    await call("account.nearPrice");
    await call("account.protection.get");
    await call("account.protection.set", { bands: [{ usd: 100, wait: "FaceId" }] });
    await call("account.activity", { limit: 5 });
    await call("account.waiting");
    await call("account.waiting.status", { id: "1" });
    await call("account.waiting.run", { id: "1" });
    await call("account.waiting.cancel", { id: "1" });
    // The agreed block is shared for a second, process-wide (chain.ts AGREED, speed 2 Nov): wait it out, so removeKey reads
    // the same way in both worlds instead of racing the other world's kept block (it flaked: unreachable vs invalid).
    await new Promise((r) => setTimeout(r, 1_100));
    await call("account.removeKey", { handle: "ml-dsa-65:aaaa" });
    await call("account.alertsEmail", { email: "someone@example.com" });
    await call("account.alertsEmailStop");
    await call("alerts.poll", { notify: false });
    await call("account.create", { recoveryDelaySeconds: 172800 });
  },
  // "Add money to start": the coins, a real quote asked of 1Click (to its first network call), the checklist, a note.
  async fund(call) {
    await call("account.fund.coins");
    await call("account.fund.start", { coin: "sol" });
    await call("account.fund.start", { coin: "near" });
    await call("account.fund.status");
    await call("account.fund.note", { away: true });
  },
  async rules(call) {
    await call("account.rules");
    await call("account.rules.update");
  },
  async agent(call) {
    await call("account.agent.view");
    await call("account.agent.set", { budget: { usdPerDay: 10 }, orders: [] });
    await call("account.agent.setBudget", { budget: { usdPerDay: 10 } });
    await call("account.agent.pause");
    await call("account.agent.quote", { fromToken: "nep141:wrap.near", toToken: "nep141:usdt.tether-token.near", amount: "1000000000000000000000000" });
    await call("account.agent.revoke");
  },
  async ledger(call) {
    // Wallet's Send and its reading of a request (tx.describe), and a site's NEAR request (tx.request).
    const request = { receiverId: "usdt.tether-token.near", actions: [{ kind: "call", method: "ft_transfer", args: { receiver_id: "someone.near", amount: "1" }, gas: "30000000000000", depositYocto: "1" }] };
    await call("tx.describe", { request: { receiverId: "someone.near", actions: [{ kind: "transfer", yocto: "1000000000000000000000000" }] } });
    await call("tx.describe", { request });
    await call("tx.request", { request, app: "wallet" });
    await call("card.check", { product: "gnosis-pay", address: EVM_TO });
    await call("card.balance", { address: EVM_TO });
  },
  async spending(call) {
    const near = await call("subwallet.create", { kind: "trade", chain: "near", app: "trade" });
    await call("subwallet.list", { app: "trade" });
    await call("subwallet.session.start", { perTxUsd: 5, totalUsd: 20, minutes: 15, why: "Trade", app: "trade" });
    await call("subwallet.session.end", { id: "trade", app: "trade" });
    await call("subwallet.session.endAll", { reason: "locked" });
  },
  async subwallet(call) {
    const sol = await call("subwallet.create", { chain: "sol", app: "browser" });
    const bsc = await call("subwallet.create", { chain: "bsc", app: "browser" });
    const site = { origin: "https://pump.fun" };
    if (sol.ok?.id) {
      await call("subwallet.balances", { id: sol.ok.id, app: "browser" });
      await call("subwallet.signMessage", { id: sol.ok.id, message: Buffer.from("hello").toString("base64"), site, app: "browser" });
      await call("subwallet.signTx", { id: sol.ok.id, tx: transfer(sol.ok.address, SOL_TO, 1_000_000n), site, app: "browser" });
      await call("subwallet.sign", { id: sol.ok.id, tx: transfer(sol.ok.address, SOL_TO, 1_000_000n), site, app: "browser" });
      await call("subwallet.session.start", { id: sol.ok.id, perTx: "1000000", total: "2000000", minutes: 15, why: "pump.fun", app: "browser" });
      await call("subwallet.export", { id: sol.ok.id, app: "trade" });
    }
    if (bsc.ok?.id) {
      await call("subwallet.signTypedData", { id: bsc.ok.id, typedData: { types: { EIP712Domain: [{ name: "name", type: "string" }], Hello: [{ name: "text", type: "string" }] }, primaryType: "Hello", domain: { name: "pump.fun" }, message: { text: "hi" } }, site, app: "browser" });
      await call("subwallet.read", { id: bsc.ok.id, method: "eth_getBalance", params: [bsc.ok.address, "latest"], app: "browser" });
      await call("subwallet.sign", { id: bsc.ok.id, call: { to: EVM_TO, value: "0x1", data: "0x" }, site, app: "browser" });
    }
    await call("subwallet.send", { chain: "sol", to: SOL_TO, amount: "1000000", app: "chat" });
    await call("subwallet.privatePay", { id: sol.ok?.id ?? "x", depositAddress: SOL_TO, intent: {}, why: "Pay" });
  },
  async float(call) {
    await call("subwallet.float.limits", { app: "trade" });
    await call("subwallet.float.balance", { app: "trade" });
    await call("subwallet.float.quoteAdd", { amount: "700000000000000000000000", tokenId: "nep141:wrap.near", app: "trade" });
    await call("subwallet.float.in", { chain: "sol", slot: 0, amount: "1000000", key: "watch-float-in-0001", app: "trade" });
    await call("subwallet.float.out", { chain: "sol", slot: 0, amount: "1000000", key: "watch-float-out-0001", app: "trade" });
    await call("subwallet.float.home", { amount: "1000000", key: "watch-float-home-0001", app: "trade" });
    await call("subwallet.float.move", { id: "1", app: "trade" });
    await call("subwallet.float.moves", { app: "trade" });
  },
  async private(call) {
    await call("subwallet.private.balances", { app: "wallet" });
    await call("subwallet.private.quoteIn", { tokenId: "nep141:wrap.near", amount: "1000000000000000000000000", app: "wallet" });
    await call("subwallet.private.home", { tokenId: "nep141:wrap.near", amount: "1000000000000000000000000", key: "watch-private-home-01", app: "wallet" });
    await call("subwallet.private.move", { id: "1", app: "wallet" });
    await call("subwallet.private.moves", { app: "wallet" });
  },
  async nostr(call) {
    // ZeroFee Chat: the relays' WebSockets are the page's (packages/chat pool.ts); only its key's work is the core's.
    const me = await call("nostr.publicKey", { geohash: "u0", app: "chat" });
    await call("nostr.sign", { geohash: "u0", kind: 20001, content: "", app: "chat" });
    await call("nostr.sign", { geohash: "u0", kind: 20000, content: "hello", nickname: "kid", app: "chat" });
    const sealed = await call("nostr.seal", { geohash: "u0", to: RECIPIENT, kind: "message", text: "hi", app: "chat" });
    await call("nostr.open", { geohash: "u0", event: sealed.ok?.event ?? {}, app: "chat" });
    void me;
  },
  async recovery(call) {
    await call("recovery.status");
    await call("recovery.words");
    await call("recovery.check", { words: Array(24).fill("abandon") });
    await call("recovery.backup");
    await call("recovery.renew");
    await call("recovery.rearm");
    await call("recovery.start", { accountId: ACCOUNT });
    await call("recovery.cancel");
  },
  async secondDevice(call) {
    await call("account.secondDevices");
    await call("account.secondDevice.setLimit", { usd: 100 });
    await call("account.secondDevice.refill");
    await call("account.secondDevice.pair", { qr: "zerofee-second:ml-dsa-65:aaaa", kind: "laptop" });
    await call("secondDevice.state", { space: "guardian" });
    await call("secondDevice.requests", { space: "guardian" });
    await call("secondDevice.answer", { space: "guardian", id: "1", yes: false });
  },
  async import(call) {
    const link = await call("subwallet.linkStart", { kind: "extension" });
    await call("subwallet.import", { kind: "extension", sealed: link.ok ? await sealForPhone(String(link.ok.code).replace("-", ""), new Uint8Array(32).fill(7)) : "" });
  },
};

/** One answer as the comparison reads it: ok, or the Problem's code, or no answer in time. */
const shape = (a: any) => ("timeout" in a ? "no answer" : "ok" in a ? "ok" : `problem ${a.problem?.code}`);

async function runFamily(world: World, family: string) {
  const c = coreIn(world, SoftwareKey.generate().publicKey, { hotRoot: true, fast: true });
  const steps: Step[] = [];
  let reached = 0;
  const call: Call = async (method, params = {}) => {
    const before = c.asked.length + c.sheets.length;
    const started = Date.now();
    const answer = await c.call(method, params);
    if (process.env.ZF_CORE_TABLE) console.log(`${world} ${family} ${method} ${Date.now() - started}ms ${JSON.stringify(answer).slice(0, 200)}`);
    if ("ok" in answer || c.asked.length + c.sheets.length > before) reached++;
    steps.push({ method, answer });
    return answer;
  };
  await FAMILIES[family](call);
  return { steps, reached, faults: c.faults, missing: c.missing, sheets: c.sheets };
}

const rejections: string[] = [];
process.on("unhandledRejection", (e) => rejections.push(String((e as Error)?.stack ?? e)));

for (const family of Object.keys(FAMILIES)) {
  test(`every ${family} call runs on the phone's globals as on a browser's: no ReferenceError, no TypeError, the same answers`, { timeout: 300_000 }, async () => {
    const phone = await runFamily("phone", family);
    const browser = await runFamily("browser", family);
    const faulted = phone.steps.filter((s) => FAULT.test(JSON.stringify(s.answer))).map((s) => `${s.method}: ${JSON.stringify(s.answer.problem ?? s.answer).slice(0, 300)}`);
    assert.deepEqual(faulted, [], "a ReferenceError or TypeError in the phone's answers");
    assert.deepEqual(phone.faults, [], "a timer threw in the phone's context");
    assert.deepEqual(phone.missing.filter((m) => !(m in GUARDED_READS)), [], "the phone's core read something its context doesn't have");
    assert.deepEqual(
      phone.steps.map((s) => `${s.method} → ${shape(s.answer)}`),
      browser.steps.map((s) => `${s.method} → ${shape(s.answer)}`),
      "an answer differs between the phone's globals and a browser's: a phone-only path",
    );
    assert.deepEqual(phone.sheets.length, browser.sheets.length, "the same sheets were reached");
    assert.ok(phone.reached > 0, `the control: ${family} reached the network, a sheet or an answer`);
    assert.deepEqual(rejections, [], "an unhandled rejection");
  });
}

// ── Statically: every name the bundle reads, and every member it reads off a shimmed global ──────────────────────────

/** Every free name the bundle reads (undeclared anywhere in scope), by TypeScript's binder with the language's lib only. */
function freeNames(code: string): Map<string, number[]> {
  const file = "zerofee-core.js";
  const options: ts.CompilerOptions = { allowJs: true, checkJs: true, noEmit: true, lib: ["lib.es2024.d.ts"], target: ts.ScriptTarget.ES2022, types: [] };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile;
  host.getSourceFile = (name, lang, ...rest) => (name === file ? ts.createSourceFile(file, code, lang) : read.call(host, name, lang, ...rest));
  host.fileExists = ((exists) => (name: string) => name === file || exists.call(host, name))(host.fileExists);
  const program = ts.createProgram([file], options, host);
  const source = program.getSourceFile(file)!;
  const names = new Map<string, number[]>();
  // "Cannot find name" and its variants that suggest a lib or @types package.
  for (const d of program.getSemanticDiagnostics(source)) {
    if (![2304, 2552, 2580, 2581, 2582, 2583, 2584, 2591].includes(d.code) || d.start === undefined) continue;
    const name = code.slice(d.start, d.start + d.length!);
    const line = source.getLineAndCharacterOfPosition(d.start).line + 1;
    names.set(name, [...(names.get(name) ?? []), line]);
  }
  return names;
}

test("the phone's core bundle reads no name JavaScriptCore and the shims don't give it (a static scan, scope-aware)", { timeout: 120_000 }, () => {
  const code = script();
  const lines = code.split("\n");
  const names = freeNames(code);
  // The control: the scan sees the shimmed names the core really reads, and a planted read of a missing one.
  assert.ok(names.has("fetch") && names.has("TextEncoder"), `the scan finds the core's own reads: ${[...names.keys()]}`);
  assert.ok(freeNames(`${code}\n;new WebSocket("wss://x");`).has("WebSocket"), "the control: a WebSocket would be found");
  const provided = new Set([...JSC_GLOBALS, ...SHIMMED, ...OWN]);
  const unprovided = [...names].filter(([n]) => !provided.has(n));
  // `typeof document` (net.ts netLog: only a browser's console shows the net log) is a check, never a read.
  const guarded = unprovided.filter(([n, at]) => n === "document" && at.every((l) => /typeof document === "undefined"/.test(lines[l - 1])));
  assert.deepEqual(
    unprovided.filter((u) => !guarded.includes(u)).map(([n, at]) => `${n} at line ${at.slice(0, 5).join(", ")}: ${lines[at[0] - 1].trim().slice(0, 120)}`),
    [],
    "free names the phone's context doesn't have",
  );
});

test("the phone's core bundle reads only what the shimmed globals have: no crypto.subtle, no AbortSignal.any, no new URL", () => {
  const code = script();
  const lines = code.split("\n").map((l, i) => [i + 1, l] as const).filter(([, l]) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  // The control: the scan finds what is there (the core's own code, by a name it really uses).
  assert.match(code, /function httpsOrigin\(/);
  assert.match(code, /crypto\.getRandomValues\(/);
  const hits: string[] = [];
  for (const [global, members] of Object.entries(SHIM_MEMBERS)) {
    const re = new RegExp(`(?<![\\w$.])(?:globalThis\\.)?${global}\\??\\.([A-Za-z_$][\\w$]*)`, "g");
    for (const [n, l] of lines) for (const m of l.matchAll(re)) if (!members.includes(m[1])) hits.push(`${global}.${m[1]} at line ${n}: ${l.trim().slice(0, 120)}`);
  }
  // Anything read off globalThis that the phone's context doesn't have, unless the same line checks it's there first.
  const provided = new Set([...JSC_GLOBALS, ...SHIMMED, ...OWN, "__zfNetLog"]);
  for (const [n, l] of lines) {
    for (const m of l.matchAll(/(?<![\w$.])globalThis(?:\.|\[")([A-Za-z_$][\w$]*)/g)) {
      if (!provided.has(m[1]) && !new RegExp(`"${m[1]}" in globalThis`).test(l)) hits.push(`globalThis.${m[1]} at line ${n}: ${l.trim().slice(0, 120)}`);
    }
  }
  for (const [what, re] of [["new URL(", /\bnew URL\(/], ["URL.", /(?<![\w.$])URL\.(?:parse|canParse|createObjectURL)\b/], ["URLSearchParams", /\bURLSearchParams\b/], ["structuredClone(", /\bstructuredClone\(/]] as const) {
    for (const [n, l] of lines) if (re.test(l)) hits.push(`${what} at line ${n}: ${l.trim().slice(0, 120)}`);
  }
  assert.deepEqual(hits, [], "reads the phone's context can't answer");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { siteRules } from "../sites.ts";
import { base58Encode } from "./codec.ts";
import { CODES, createWalletEngine, type SiteRule, type WalletReply } from "./engine.ts";

const ADDR: Record<string, string> = {
  base: "0x" + "ba".repeat(20),
  eth: "0x" + "e7".repeat(20),
  arb: "0x" + "a7".repeat(20),
  sol: base58Encode(new Uint8Array(32).fill(5)),
};
const TX_SIG = base58Encode(new Uint8Array(64).fill(3));
const SIG65 = Buffer.alloc(65, 1).toString("base64");

/** The core as the Browser's bridge sees it, plus device.store. Records every call. */
function fakeCore(answers: Partial<Record<string, (p: Record<string, unknown>) => unknown>> = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  const store = new Map<string, string>();
  const wallets: { id: string; kind: string; chain: string; address: string; site?: string; current?: boolean }[] = [];
  const problem = (code: string): Problem => ({ code, whatHappened: "No.", money: { state: "safe", where: "in your Browser wallet" }, next: { kind: "nothing", label: "Go back" } });
  const bridge: Bridge = {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      calls.push([method, params]);
      const own = answers[method];
      if (own) {
        const r = own(params);
        return (r && typeof r === "object" && "problem" in r ? r : { ok: r }) as BridgeResult<T>;
      }
      const ok = (v: unknown) => ({ ok: v as T });
      switch (method) {
        case "device.store.get":
          return ok({ value: store.get(String(params.key)) ?? null });
        case "device.store.set":
          store.set(String(params.key), String(params.value));
          return ok({ ok: true });
        case "subwallet.list":
          return ok(wallets.filter((w) => !params.kind || w.kind === params.kind));
        case "subwallet.create": {
          // as the core (D55): { chain } is that chain's one wallet (the trade path on Solana, the browser path on Base)
          const kind = String(params.kind ?? (["sol", "hood", "bsc"].includes(String(params.chain)) ? "trade" : "browser"));
          // a site's own wallet ({ kind: "site", site }): its own id, never current
          const site = kind === "site" ? String(params.siteId) : undefined;
          const w = { id: site ? `site-${site}-${params.chain}` : `${kind}-${params.chain}`, kind, chain: String(params.chain), address: ADDR[String(params.chain)] ?? "0x" + "00".repeat(20), ...(site ? { site } : kind === "pay" ? {} : { current: true }) };
          wallets.push(w);
          return ok(w);
        }
        case "subwallet.site.forHost": {
          // as the core (audit C1): a listed site's fixed wallet, any other host its own "host:<host>" wallet, made once
          const host = new URL(String((params.site as { origin: string }).origin)).host;
          const listed: Record<string, string> = { "pump.fun": "pump", "gmgn.ai": "gmgn" };
          const site = listed[host] ?? `host:${host}`;
          const id = listed[host] ? `site-${site}-${params.chain}` : `site-${host}-${params.chain}`;
          const had = wallets.find((x) => x.id === id);
          if (had) return ok(had);
          const w = { id, kind: "site", chain: String(params.chain), address: ADDR[String(params.chain)] ?? "0x" + "00".repeat(20), site };
          wallets.push(w);
          return ok(w);
        }
        case "subwallet.signMessage":
        case "subwallet.signTypedData":
          return ok({ signature: String(params.id).endsWith("-sol") ? Buffer.alloc(64, 2).toString("base64") : SIG65 });
        case "subwallet.signTx":
          return ok({ signedTx: "c2lnbmVk" });
        case "subwallet.sign":
          return ok(String(params.id).endsWith("-sol") ? { status: "done", txHash: TX_SIG, explorerUrl: "" } : { status: "done", txHash: "0x" + "77".repeat(32), explorerUrl: "" });
        case "subwallet.read":
          return ok({ result: "0x10" });
      }
      return { problem: problem("security.bridge.not-allowed") };
    },
    on: () => () => {},
  };
  return { bridge, calls, store, wallets, problem, methods: () => calls.map(([m]) => m).filter((m) => !m.startsWith("device.")) };
}

function setup(options: { answers?: Parameters<typeof fakeCore>[0]; allow?: boolean | (() => Promise<boolean>); child?: boolean; kind?: "browser" | "pay"; rules?: (h: string) => SiteRule | null } = {}) {
  const core = fakeCore(options.answers);
  const emitted: [string, string, unknown][] = [];
  const problems: Problem[] = [];
  const asked: SiteRule[] = [];
  const engine = createWalletEngine({
    bridge: core.bridge,
    kind: options.kind,
    site: options.rules ?? siteRules({ child: options.child, recipes: [{ name: "Mt Pelerin", hosts: ["app.mtpelerin.com"], wallet: { kind: "browser", chains: ["base"] } }] }),
    emit: (host, event, data) => emitted.push([host, event, data]),
    problem: (p) => problems.push(p),
    askConnect: async (_host, rule) => {
      asked.push(rule);
      return typeof options.allow === "function" ? options.allow() : options.allow ?? true;
    },
    now: () => new Date("2026-10-26T04:00:00Z"),
  });
  let id = 0;
  const ask = (origin: string, method: string, params?: unknown, mainFrame = true) => engine.handle({ id: ++id, method, params, origin, mainFrame });
  return { engine, core, emitted, problems, asked, ask };
}

const result = (r: WalletReply) => {
  assert.ok("result" in r, `expected a result, got ${JSON.stringify(r)}`);
  return r.result;
};
const code = (r: WalletReply) => ("error" in r ? r.error.code : null);

const MTP = "https://app.mtpelerin.com";
const PUMP = "https://pump.fun";
const TYPED = "https://some-dex.example";

test("only the main frame of an https page, on a site the rules allow, is answered", async () => {
  const s = setup();
  assert.equal(code(await s.ask(MTP, "eth_chainId", [], false)), CODES.unauthorized);
  assert.equal(code(await s.ask("http://app.mtpelerin.com", "eth_chainId")), CODES.unauthorized);
  assert.equal(code(await s.ask("https://user@app.mtpelerin.com", "eth_chainId")), CODES.unauthorized);
  assert.equal(code(await s.ask("not a url", "eth_chainId")), CODES.unauthorized);
  assert.equal(result(await s.ask(MTP, "eth_chainId")), "0x2105");
  const child = setup({ child: true });
  assert.equal(code(await child.ask(MTP, "eth_chainId")), CODES.unauthorized);
  assert.deepEqual(child.core.methods(), []);
});

test("a site sees no address until the person says yes, once per host, remembered on the device", async () => {
  const s = setup();
  assert.deepEqual(result(await s.ask(MTP, "eth_accounts")), []);
  assert.deepEqual(result(await s.ask(MTP, "eth_requestAccounts")), [ADDR.base]);
  assert.equal(s.asked.length, 1);
  assert.equal(s.asked[0].known, true);
  assert.deepEqual(result(await s.ask(MTP, "eth_requestAccounts")), [ADDR.base]);
  assert.deepEqual(result(await s.ask(MTP, "eth_accounts")), [ADDR.base]);
  assert.equal(s.asked.length, 1);
  assert.deepEqual(await s.engine.connections(), [{ host: "app.mtpelerin.com", name: "Mt Pelerin", chain: "base", sinceIso: "2026-10-26T04:00:00.000Z" }]);
  // The wallet is that chain's one wallet (D55), made once.
  // audit C1: the site's own wallet, asked for its exact host; never a shared chain wallet (none made)
  assert.deepEqual(s.core.calls.filter(([m]) => m === "subwallet.site.forHost").map(([, p]) => p), [{ chain: "base", site: { origin: MTP } }]);
  assert.equal(s.core.calls.some(([m]) => m === "subwallet.create"), false);
});

test("no on the connect sheet is 4001 and remembers nothing", async () => {
  const s = setup({ allow: false });
  assert.equal(code(await s.ask(MTP, "eth_requestAccounts")), CODES.declined);
  assert.deepEqual(await s.engine.connections(), []);
  assert.deepEqual(result(await s.ask(MTP, "eth_accounts")), []);
});

test("a typed site is unknown: always the sheet, even if a rule claims pre-approval", async () => {
  const typed = setup();
  assert.deepEqual(result(await typed.ask(TYPED, "eth_requestAccounts")), [ADDR.eth]);
  assert.equal(typed.asked[0].known, false);
  const sneaky = setup({ rules: (host) => ({ host, name: host, chains: ["eth"], known: false, preapproved: true }) });
  await sneaky.ask(TYPED, "eth_requestAccounts");
  assert.equal(sneaky.asked.length, 1);
  const recipe = setup({ rules: (host) => ({ host, name: host, chains: ["base"], known: true, preapproved: true }) });
  await recipe.ask(MTP, "eth_requestAccounts");
  assert.equal(recipe.asked.length, 0);
});

test("personal_sign: hex or text becomes bytes for the core's sheet, with the site's origin; the signature comes back as hex", async () => {
  const s = setup();
  assert.equal(code(await s.ask(MTP, "personal_sign", ["0x68690a", ADDR.base])), CODES.unauthorized, "not connected yet");
  await s.ask(MTP, "eth_requestAccounts");
  const sig = result(await s.ask(MTP, "personal_sign", ["0x68690a", ADDR.base]));
  assert.equal(sig, "0x" + "01".repeat(65));
  assert.deepEqual(s.core.calls.at(-1), ["subwallet.signMessage", { id: "site-app.mtpelerin.com-base", message: Buffer.from("hi\n").toString("base64"), site: { origin: MTP } }]);
  // Some sites send [address, message]; text is UTF-8.
  await s.ask(MTP, "personal_sign", [ADDR.base.toUpperCase().replace("0X", "0x"), "Sign in"]);
  assert.equal(s.core.calls.at(-1)?.[1].message, Buffer.from("Sign in").toString("base64"));
  assert.equal(code(await s.ask(MTP, "personal_sign", ["0x01", "0x" + "11".repeat(20)])), CODES.unauthorized);
});

test("a no on the core's sheet is 4001; a core Problem goes to the person's screen and the site gets -32603", async () => {
  const s = setup({
    answers: {
      "subwallet.signMessage": () => ({ declined: true }),
      "subwallet.sign": () => ({ status: "problem", problem: { code: "security.subwallet.refused", whatHappened: "This isn't something your separate wallet can sign, so we said no.", money: { state: "safe", where: "in that wallet" }, next: { kind: "nothing", label: "Go back" } } }),
    },
  });
  await s.ask(MTP, "eth_requestAccounts");
  assert.equal(code(await s.ask(MTP, "personal_sign", ["0x01", ADDR.base])), CODES.declined);
  const r = await s.ask(MTP, "eth_sendTransaction", [{ from: ADDR.base, to: "0x" + "22".repeat(20), value: "0x1" }]);
  assert.equal(code(r), CODES.internal);
  assert.deepEqual(s.problems.map((p) => p.code), ["security.subwallet.refused"]);
});

test("eth_signTypedData_v4: JSON is read, the domain's chain must be the site's network", async () => {
  const s = setup();
  await s.ask(MTP, "eth_requestAccounts");
  const typed = { domain: { name: "X", chainId: 8453 }, types: { EIP712Domain: [], M: [{ name: "a", type: "uint256" }] }, primaryType: "M", message: { a: "1" } };
  assert.equal(result(await s.ask(MTP, "eth_signTypedData_v4", [ADDR.base, JSON.stringify(typed)])), "0x" + "01".repeat(65));
  assert.deepEqual(s.core.calls.at(-1), ["subwallet.signTypedData", { id: "site-app.mtpelerin.com-base", typedData: typed, site: { origin: MTP } }]);
  assert.equal(code(await s.ask(MTP, "eth_signTypedData_v4", [ADDR.base, { ...typed, domain: { chainId: 1 } }])), CODES.invalid);
  assert.equal(code(await s.ask(MTP, "eth_signTypedData_v4", [ADDR.base, "{not json"])), CODES.invalid);
});

test("eth_sendTransaction goes to the core as a call it builds itself; contract creation is refused", async () => {
  const s = setup();
  await s.ask(MTP, "eth_requestAccounts");
  const to = "0x" + "22".repeat(20);
  assert.equal(result(await s.ask(MTP, "eth_sendTransaction", [{ from: ADDR.base, to, value: "0x5", data: "0xabcd", gas: "0x5208" }])), "0x" + "77".repeat(32));
  assert.deepEqual(s.core.calls.at(-1), ["subwallet.sign", { id: "site-app.mtpelerin.com-base", call: { to, value: "5", data: "0xabcd", gas: "21000" }, why: "app.mtpelerin.com asked for this", site: { origin: MTP } }]);
  assert.equal(code(await s.ask(MTP, "eth_sendTransaction", [{ from: ADDR.base, data: "0x60" }])), CODES.invalid);
  assert.equal(code(await s.ask(MTP, "eth_sendTransaction", [{ from: ADDR.base, to, chainId: "0x1" }])), CODES.invalid);
  assert.equal(code(await s.ask(MTP, "eth_sendTransaction", [{ from: ADDR.base, to, value: 5 }])), CODES.invalid);
});

test("blind signatures are refused with a Problem for the person; adding chains is refused quietly; unknown methods too", async () => {
  const s = setup();
  await s.ask(MTP, "eth_requestAccounts");
  const before = s.core.methods().length;
  assert.equal(code(await s.ask(MTP, "eth_sign", [ADDR.base, "0x" + "00".repeat(32)])), CODES.unsupported);
  assert.equal(code(await s.ask(MTP, "eth_signTransaction", [{}])), CODES.unsupported);
  assert.deepEqual(s.problems.map((p) => p.code), ["browser.request.refused", "browser.request.refused"]);
  assert.equal(code(await s.ask(MTP, "wallet_addEthereumChain", [{ chainId: "0x89" }])), CODES.unsupported);
  assert.equal(code(await s.ask(MTP, "eth_signTypedData_v3", [])), CODES.unsupported);
  assert.equal(code(await s.ask(MTP, "debug_traceCall", [])), CODES.unsupported);
  assert.equal(s.problems.length, 2);
  assert.equal(s.core.methods().length, before);
});

test("switching network: only the site's own chains; the address changes with it, and the page is told", async () => {
  const s = setup();
  await s.ask(TYPED, "eth_requestAccounts");
  assert.equal(result(await s.ask(TYPED, "wallet_switchEthereumChain", [{ chainId: "0xa4b1" }])), null);
  assert.equal(result(await s.ask(TYPED, "eth_chainId")), "0xa4b1");
  assert.deepEqual(s.emitted, [
    ["some-dex.example", "chainChanged", "0xa4b1"],
    ["some-dex.example", "accountsChanged", [ADDR.arb]],
  ]);
  assert.equal(code(await s.ask(TYPED, "wallet_switchEthereumChain", [{ chainId: "0x89" }])), CODES.unknownChain);
  assert.equal(code(await s.ask(MTP, "wallet_switchEthereumChain", [{ chainId: "0x1" }])), CODES.unknownChain, "Mt Pelerin is Base only");
});

test("one sheet per site at a time: a second ask while the first is up is -32002, not a second sheet", async () => {
  let release: ((v: unknown) => void) | undefined;
  const s = setup({ answers: { "subwallet.signMessage": () => (release ? { signature: SIG65 } : new Promise((r) => (release = r))) } });
  await s.ask(MTP, "eth_requestAccounts");
  const first = s.ask(MTP, "personal_sign", ["0x01", ADDR.base]);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(code(await s.ask(MTP, "personal_sign", ["0x02", ADDR.base])), CODES.pending);
  release?.({ signature: SIG65 });
  assert.equal(result(await first), "0x" + "01".repeat(65));
  assert.equal(result(await s.ask(MTP, "personal_sign", ["0x03", ADDR.base])), "0x" + "01".repeat(65));
});

test("reads go to the core's nodes for the site's chain, through the Browser wallet there", async () => {
  const s = setup();
  assert.equal(result(await s.ask(MTP, "eth_blockNumber", [])), "0x10");
  assert.deepEqual(s.core.calls.at(-1), ["subwallet.read", { id: "site-app.mtpelerin.com-base", method: "eth_blockNumber", params: [] }]);
});

test("Solana: a site's own wallet on its own site connects with no sheet (silent too: Social trading opens it signed in), gives the address and key, signing names the site", async () => {
  const s = setup();
  assert.equal((result(await s.ask(PUMP, "solana:connect", { silent: true })) as { address: string }).address, ADDR.sol, "pre-approved: its own wallet only");
  assert.equal(s.asked.length, 0, "no connect sheet");
  const account = result(await s.ask(PUMP, "solana:connect", {})) as { address: string; publicKey: string };
  assert.equal(account.address, ADDR.sol);
  assert.deepEqual([...Buffer.from(account.publicKey, "base64")], new Array(32).fill(5));
  assert.equal(code(await s.ask(PUMP, "eth_chainId")), CODES.chainDisconnected, "pump.fun is Solana only");

  assert.deepEqual(result(await s.ask(PUMP, "solana:signTransaction", { address: ADDR.sol, transaction: "AQID", chain: "solana:mainnet" })), { signedTransaction: "c2lnbmVk" });
  // pump.fun's own wallet (core site-wallets.ts), never the shared Solana wallet
  assert.deepEqual(s.core.calls.at(-1), ["subwallet.signTx", { id: "site-pump-sol", tx: "AQID", why: "pump.fun asked for this", site: { origin: PUMP } }]);
  assert.deepEqual(s.core.calls.filter(([m]) => m === "subwallet.site.forHost").map(([, p]) => p), [{ chain: "sol", site: { origin: PUMP } }]);

  const sent = result(await s.ask(PUMP, "solana:signAndSendTransaction", { address: ADDR.sol, transaction: "AQID" })) as { signature: string };
  assert.deepEqual([...Buffer.from(sent.signature, "base64")], new Array(64).fill(3));

  assert.equal(code(await s.ask(PUMP, "solana:signMessage", { address: "x", message: "aGk=" })), CODES.unauthorized);
  assert.equal(code(await s.ask(PUMP, "solana:signTransaction", { address: ADDR.sol, transaction: "not base64!" })), CODES.invalid);
});

test("disconnecting in the Browser app: the site is told at once and must ask again", async () => {
  const s = setup();
  await s.ask(PUMP, "solana:connect", {});
  await s.engine.disconnect("pump.fun");
  assert.deepEqual(s.emitted, [
    ["pump.fun", "disconnect", null],
    ["pump.fun", "solana:change", null],
  ]);
  assert.deepEqual(await s.engine.connections(), []);
  assert.equal(code(await s.ask(PUMP, "solana:signMessage", { address: ADDR.sol, message: "aGk=" })), CODES.unauthorized);
  // the person disconnected it: the pre-approval no longer counts, a silent connect gets nothing, and the sheet asks
  assert.equal(result(await s.ask(PUMP, "solana:connect", { silent: true })), null);
  await s.ask(PUMP, "solana:connect", {});
  assert.equal(s.asked.length, 1);
});

test("disconnecting also clears the host's own yes for the site, after the engine's; no such method is fine", async () => {
  const s = setup();
  await s.ask(TYPED, "eth_requestAccounts");
  await s.engine.disconnect("some-dex.example");
  const order = s.core.calls.map(([m, p]) => (m === "device.store.set" ? "store" : m === "device.wallet.forget" ? `forget ${p.host}` : null)).filter(Boolean);
  assert.deepEqual(order.slice(-2), ["store", "forget some-dex.example"]);
  assert.deepEqual(await s.engine.connections(), [], "the fake core answers device.wallet.forget with a Problem, and nothing breaks");
  await s.ask(PUMP, "solana:connect", {});
  assert.equal(result(await s.ask(PUMP, "solana:disconnect", {})), null);
  assert.deepEqual(s.core.calls.at(-1), ["device.wallet.forget", { host: "pump.fun" }]);
});

test("Pay's instance for the card's window uses its own kind of wallet, never the Browser wallet", async () => {
  const s = setup({ kind: "pay", rules: (host) => ({ host, name: "Gnosis Pay", chains: ["gnosis"], known: true }) });
  await s.ask("https://app.gnosispay.com", "eth_requestAccounts");
  assert.deepEqual(s.core.calls.filter(([m]) => m.startsWith("subwallet.")).map(([m, p]) => [m, p.kind]), [
    ["subwallet.list", undefined],
    ["subwallet.create", "pay"],
  ]);
});

// ── The product Browser thesis, part 1 (4 Nov): "when you go to a site, it auto-creates a new wallet for it" ──────────
// In a Browser tab the host says so with each request (`auto`, PartnerWallet: an every-site window, EverySite.swift):
// every site is connected at once with its own new wallet, no sheet. What it signs is unchanged: still the core's.

function autoSetup(options: Parameters<typeof setup>[0] = {}) {
  const s = setup(options);
  let id = 1000;
  const auto = (origin: string, method: string, params?: unknown) => s.engine.handle({ id: ++id, method, params, origin, mainFrame: true, auto: true });
  const forHost = () => s.core.calls.filter(([m]) => m === "subwallet.site.forHost").map(([, p]) => p);
  return { ...s, auto, forHost };
}
const OTHER = "https://other-dex.example";

test("a Browser tab: a typed site is connected at once with its own new wallet, made for its exact host, with no sheet (EIP-1193 and Solana alike)", async () => {
  const s = autoSetup({ allow: false }); // a sheet would say no: none may be asked
  assert.deepEqual(result(await s.auto(TYPED, "eth_accounts", [])), [ADDR.eth], "eth_accounts answers the address at once");
  assert.deepEqual(s.forHost(), [{ chain: "eth", site: { origin: TYPED } }], "its own wallet, asked for its exact host");
  assert.deepEqual(result(await s.auto(TYPED, "eth_requestAccounts", [])), [ADDR.eth]);
  assert.deepEqual(result(await s.auto(TYPED, "wallet_getPermissions", [])), [{ parentCapability: "eth_accounts", caveats: [] }]);
  // Solana's silent connect (a wallet adapter's onlyIfTrusted) on another typed site: its address, its own wallet
  assert.equal((result(await s.auto(OTHER, "solana:connect", { silent: true })) as { address: string }).address, ADDR.sol);
  assert.deepEqual(s.forHost().at(-1), { chain: "sol", site: { origin: OTHER } });
  assert.equal(s.asked.length, 0, "no connect sheet, ever");
  assert.deepEqual(s.core.wallets.map((w) => [w.id, w.site]), [["site-some-dex.example-eth", "host:some-dex.example"], ["site-other-dex.example-sol", "host:other-dex.example"]], "a new wallet per site, never a shared one");
  assert.equal(s.core.calls.some(([m]) => m === "subwallet.create"), false);
  // listed in the Browser's Sites, with Disconnect
  assert.deepEqual((await s.engine.connections()).map((c) => c.host).sort(), ["other-dex.example", "some-dex.example"]);

  // control: the same site outside a Browser tab (no auto) sees nothing until the sheet says yes
  const plain = setup({ allow: false });
  assert.deepEqual(result(await plain.ask(TYPED, "eth_accounts", [])), []);
  assert.equal(result(await plain.ask(OTHER, "solana:connect", { silent: true })), null);
  assert.equal(code(await plain.ask(TYPED, "eth_requestAccounts", [])), CODES.declined);
  assert.equal(plain.asked.length, 1, "the sheet asked (and said no)");
  assert.deepEqual(await plain.engine.connections(), []);
});

test("a Browser tab never connects a look-alike name on its own, nor the card's window (Pay's engine)", async () => {
  const s = autoSetup({ allow: false });
  const fake = "https://xn--pmp-0na.fun";
  assert.deepEqual(result(await s.auto(fake, "eth_accounts", [])), []);
  assert.equal(result(await s.auto(fake, "solana:connect", { silent: true })), null);
  assert.equal(code(await s.auto(fake, "eth_requestAccounts", [])), CODES.declined, "only the sheet, which said no");
  assert.equal(s.asked.length, 1);
  assert.deepEqual(s.forHost().filter((p) => (p.site as { origin: string }).origin === fake).length, 1, "made only by the connect's own ask, never by eth_accounts");
  assert.deepEqual(await s.engine.connections(), []);
  // control: a plain name, the same way, connects at once
  assert.deepEqual(result(await s.auto(TYPED, "eth_accounts", [])), [ADDR.eth]);

  const pay = autoSetup({ kind: "pay", allow: false, rules: (host) => ({ host, name: "Gnosis Pay", chains: ["gnosis"], known: true }) });
  assert.deepEqual(result(await pay.auto("https://app.gnosispay.com", "eth_accounts", [])), []);
  assert.equal(code(await pay.auto("https://app.gnosispay.com", "eth_requestAccounts", [])), CODES.declined);
  assert.equal(pay.asked.length, 1, "the card's window always asks");
});

test("a Browser tab: a site the person disconnected stays disconnected until they connect it again on the sheet", async () => {
  let yes = false;
  const s = autoSetup({ allow: async () => yes });
  assert.deepEqual(result(await s.auto(TYPED, "eth_accounts", [])), [ADDR.eth]);
  await s.engine.disconnect("some-dex.example");
  assert.deepEqual(await s.engine.connections(), []);
  assert.deepEqual(result(await s.auto(TYPED, "eth_accounts", [])), [], "not connected again silently");
  assert.deepEqual(result(await s.auto(TYPED, "wallet_getPermissions", [])), []);
  assert.equal(code(await s.auto(TYPED, "personal_sign", ["0x01", ADDR.eth])), CODES.unauthorized, "nothing signs");
  assert.deepEqual(await s.engine.connections(), [], "and nothing listed it again");
  assert.equal(code(await s.auto(TYPED, "eth_requestAccounts", [])), CODES.declined, "the site's Connect asks the sheet: no");
  assert.deepEqual(result(await s.auto(TYPED, "eth_accounts", [])), [], "still disconnected");
  // a Solana site's own Disconnect is the person's too
  await s.auto(OTHER, "solana:connect", {});
  assert.equal(result(await s.auto(OTHER, "solana:disconnect", {})), null);
  assert.equal(result(await s.auto(OTHER, "solana:connect", { silent: true })), null, "a silent connect after it gets nothing");
  assert.equal(s.asked.length, 1);
  // control: the person says yes on the sheet: connected again
  yes = true;
  assert.deepEqual(result(await s.auto(TYPED, "eth_requestAccounts", [])), [ADDR.eth]);
  assert.equal(s.asked.length, 2);
  assert.deepEqual(result(await s.auto(TYPED, "eth_accounts", [])), [ADDR.eth]);
});

test("a Browser tab: a pre-connected site's signatures still go to the core, its own wallet, with its origin (the core decides the sheet)", async () => {
  const s = autoSetup({ allow: false });
  await s.auto(TYPED, "eth_accounts", []);
  assert.equal(result(await s.auto(TYPED, "personal_sign", ["0x68690a", ADDR.eth])), "0x" + "01".repeat(65));
  assert.deepEqual(s.core.calls.at(-1), ["subwallet.signMessage", { id: "site-some-dex.example-eth", message: Buffer.from("hi\n").toString("base64"), site: { origin: TYPED } }]);
  const to = "0x" + "22".repeat(20);
  await s.auto(TYPED, "eth_sendTransaction", [{ from: ADDR.eth, to, value: "0x1" }]);
  assert.deepEqual(s.core.calls.at(-1), ["subwallet.sign", { id: "site-some-dex.example-eth", call: { to, value: "1", data: "0x", gas: undefined }, why: "some-dex.example asked for this", site: { origin: TYPED } }]);
  // blind signatures stay refused, connected or not
  assert.equal(code(await s.auto(TYPED, "eth_sign", [ADDR.eth, "0x" + "00".repeat(32)])), CODES.unsupported);
  // a frame inside the page is still refused, auto or not
  assert.equal(code(await s.engine.handle({ id: 1, method: "eth_accounts", params: [], origin: TYPED, mainFrame: false, auto: true })), CODES.unauthorized);
  assert.equal(s.asked.length, 0);
});

// Audit pass 2, item 4: auto-connect kept a host-named wallet record and a Sites entry for every site a page asked from,
// private windows too: a local history of private browsing. A private window (the host's privateWindow) never
// auto-connects; only the connect sheet's yes keeps a site.
test("a private window: a typed site is not auto-connected and nothing is kept for it; the sheet's yes still connects (control: the same request in a normal tab)", async () => {
  const s = autoSetup({ allow: false });
  const priv = (origin: string, method: string, params?: unknown) => s.engine.handle({ id: 9000 + Math.floor(Math.random() * 1000), method, params, origin, mainFrame: true, auto: true, privateWindow: true });
  assert.deepEqual(result(await priv(TYPED, "eth_accounts", [])), [], "no accounts at once");
  assert.equal(result(await priv(OTHER, "solana:connect", { silent: true })), null, "a silent connect gets nothing");
  assert.equal(s.forHost().length, 0, "no site wallet made");
  assert.deepEqual(await s.engine.connections(), [], "no Sites entry kept");
  assert.equal(code(await priv(TYPED, "eth_requestAccounts", [])), CODES.declined, "it asks; this sheet said no");
  assert.equal(s.asked.length, 1);
  // control: a normal Browser tab still connects at once
  assert.deepEqual(result(await s.auto(TYPED, "eth_accounts", [])), [ADDR.eth]);
});

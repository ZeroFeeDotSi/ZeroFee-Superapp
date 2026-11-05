// Every app in Apps, end to end through the REAL core (no stand-in): on a fresh account with no Solana wallet yet, the
// site's Connect makes the site's OWN wallet (core site-wallets.ts, product decision, 2 Nov B24), never the shared Solana wallet, and
// gives its address. D143 (product decision, 3 Nov, core approval-policy.ts): a site wallet is a hot key, so the core's sheet never
// opens for it. Its plain sign-in (Sign In With Solana, or pump.fun's own) and a trade the core's checks pass are signed
// with no sheet, each signature checking out against that address; words that aren't a sign-in and a transaction the
// checks don't pass are refused, named, with nothing signed and no sheet.
// The Browser engine is called as the phone calls it (app "browser", the origin and main frame from WebKit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { forApps, type Bridge, type BridgeResult } from "@zerofee/core/bridge";
import { DemoCore } from "@zerofee/core/demo-core";
import type { PlainWords } from "@zerofee/core/signer";
import type { Problem } from "@zerofee/core/problems";
import { SOL, ownTokenAccount, type SolChain } from "@zerofee/core/solana";
import { base58, base64, cat, fromBase58, u64le } from "@zerofee/core/sol/bytes";
import { FakeChain } from "@zerofee/core/testing/fake-chain";
import { fairCoins } from "@zerofee/core/testing/sol-coins";
import { SOL_USD, buy as pocketBuy } from "@zerofee/core/testing/pocket-tx";
import { MemoryVault } from "@zerofee/core/vault";
import { createWalletEngine, type WalletReply } from "../engine/engine.ts";
import { siteRules } from "../sites.ts";
import { LISTED } from "./catalog.ts";

const wasm = new Uint8Array(readFileSync(new URL("../../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const BLOCKHASH = base58(new Uint8Array(32).fill(5));
const SYSTEM = "11111111111111111111111111111111";
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

/** A plain SOL transfer from `from`, legacy message, one empty signature slot. */
function transfer(from: string, to: string, lamports: bigint): string {
  const keys = [from, to, SYSTEM];
  const message = cat([1, 0, 1], [keys.length], ...keys.map(fromBase58), fromBase58(BLOCKHASH), [1], [2, 2, 0, 1, 12], cat([2, 0, 0, 0], u64le(lamports)));
  return base64(cat([1], new Uint8Array(64), message));
}

/** A pump.fun buy the way a trade is built: pump.fun's real 17-account layout, paid into the wallet's own coin account
 *  (core testing/pocket-tx.ts, which payoutRefusal reads), with a minimum. A trade the core's checks pass. */
const buy = (wallet: string, lamports: bigint): string => pocketBuy(wallet, (Number(lamports) / 1e9) * SOL_USD);

async function readyCore() {
  const chain = new FakeChain();
  // the stand-in nodes: two that agree, and the coins a fair fill moves (fairCoins)
  const sol: SolChain = { blockhashValid: async () => true, simulate: async (tx: string) => ({ ok: true, agreed: true, lamportsBefore: 1_000_000_000n, lamportsAfter: 1_000_000_000n - 1_005_000n, tokens: fairCoins(tx) }), lookupTables: async () => [] };
  const core = new DemoCore({ chain, vault: new MemoryVault(), sol, nativeUsd: async () => 150, policyWasm: async () => wasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1 });
  const sheets: PlainWords[] = [];
  const answer = { yes: true };
  core.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => {
    sheets.push(words);
    void core.call("approval.answer", { id, approve: answer.yes });
  });
  const ok = <T,>(r: BridgeResult<T>): T => {
    if ("problem" in r) assert.fail(r.problem.whatHappened);
    return r.ok;
  };
  ok(await core.call("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 12, 24], words: [words[0], words[11], words[23]] }));
  return { core, sheets, answer };
}

/** The phone's way in: forApps(shell, "browser") for the core, the host's device store, its connect sheet says yes. */
function phoneEngine(core: Bridge) {
  const store = new Map<string, string>();
  const asBrowser = forApps(core, "browser");
  const calls: string[] = [];
  const bridge: Bridge = {
    async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      calls.push(method);
      if (method === "device.store.get") return { ok: { value: store.get(String(p.key)) ?? null } as T };
      if (method === "device.store.set") return (store.set(String(p.key), String(p.value)), { ok: { ok: true } as T });
      if (method.startsWith("device.")) return { ok: { ok: true } as T };
      return asBrowser.call<T>(method, p);
    },
    on: (event, handler) => asBrowser.on(event, handler),
  };
  const problems: Problem[] = [];
  const asked: string[] = [];
  const engine = createWalletEngine({ bridge, site: siteRules({}), emit: () => {}, askConnect: async (host) => (asked.push(host), true), problem: (p) => problems.push(p) });
  return { engine, calls, problems, asked };
}

const result = (r: WalletReply) => {
  assert.ok("result" in r, `expected an answer, got ${JSON.stringify(r)}`);
  return r.result as Record<string, string>;
};
/** D143: a hot key's refusal, named, with nothing signed (the page gets an error, never a signature). */
const refusedNothingSigned = (r: WalletReply, problems: Problem[], why: RegExp, what: string, code = "browser.signin.refused") => {
  assert.ok("error" in r && !("result" in r), `${what}: refused, not ${JSON.stringify(r)}`);
  const p = problems.at(-1);
  // a sign-in's refusal is said as the site's sign-in (browser.signin.refused, rule 8), the core's cause under it; words
  // outside the core's allow-list are their own sheet (browser.signin.unknown, QA)
  assert.equal(p?.code, code, what);
  assert.match(p?.more ?? "", /Nothing was signed\.$/, `${what}: nothing was signed`);
  assert.match(p?.more ?? "", why, what);
};

for (const app of LISTED) {
  const host = app.preset.hosts[0]!;
  const origin = `https://${host}`;
  test(`${app.preset.name}: Connect on a fresh account; its sign-in and a checked trade from the site's own wallet with no sheet; a message that isn't a sign-in and an unchecked transaction refused, nothing signed (D143)`, async (t) => {
    const { core, sheets, answer } = await readyCore();
    const { engine, calls, problems } = phoneEngine(core);
    const setUp = sheets.length; // the account's own set-up sheets; none after this: a site wallet is a hot key (D143)
    let id = 0;
    const ask = (method: string, params?: unknown) => engine.handle({ id: ++id, method, params, origin, mainFrame: true });

    // Social trading (2 Nov): its own wallet on its own site connects with no sheet, even silently (it opens signed in)
    const silent = result(await ask("solana:connect", { silent: true }));
    const account = result(await ask("solana:connect", {}));
    assert.equal(silent.address, account.address, "a silent connect gives the site's own wallet");
    assert.equal(Buffer.from(account.publicKey!, "base64").length, 32);
    assert.equal(base58(Buffer.from(account.publicKey!, "base64")), account.address);
    assert.ok(calls.includes("subwallet.site.forHost"), "a fresh account has no wallet for the site yet: Connect asks the core for the site's own (audit C1)");
    const listed = (await forApps(core, "browser").call<{ address: string; kind: string; site?: string; label: string; chain: string }[]>("subwallet.list", {})) as { ok: { address: string; kind: string; site?: string; label: string; chain: string }[] };
    assert.deepEqual(listed.ok.filter((w) => w.chain === "sol").map((w) => [w.address, w.kind, w.site, w.label]), [[account.address, "site", app.id, `${app.preset.name} wallet`]], "the site's own wallet, and no shared one made");
    const key = fromBase58(account.address!);

    // words that aren't a sign-in: refused, named, nothing signed, no sheet (read before the sign-in room: it takes none)
    const words = `Welcome to ${host}! Sign to continue.`;
    refusedNothingSigned(await ask("solana:signMessage", { address: account.address, message: Buffer.from(words).toString("base64") }), problems, /isn't this site's own sign-in|has no sign-in of its own/, "a message that isn't a sign-in", "browser.signin.unknown");

    // control: Sign In With Solana, as the site writes it (domain = the site, the wallet's own address): signed, no sheet
    const siws = `${host} wants you to sign in with your Solana account:\n${account.address}\n\nSign in to ${host}\n\nURI: ${origin}\nVersion: 1\nChain ID: mainnet\nNonce: 8f2a91c4\nIssued At: ${new Date().toISOString()}`;
    const signInReply = await ask("solana:signMessage", { address: account.address, message: Buffer.from(siws).toString("base64") });
    const signIn = result(signInReply);
    assert.ok(ed25519.verify(Buffer.from(signIn.signature!, "base64"), Buffer.from(siws), key), "the sign-in signature is the wallet's");
    assert.equal((signInReply as { signedIn?: true }).signedIn, true, "the host is told it was a plain sign-in, signed with no sheet");
    assert.equal(sheets.length, setUp, "a plain sign-in for its own site: no sheet");

    // the site's own sign-in text ("Sign in to pump.fun: <ms>", ST4): pump.fun's only, and never two within 30 s
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const own = () => Buffer.from(`Sign in to ${host}: ${Date.now()}`).toString("base64");
    if (host === "pump.fun") {
      refusedNothingSigned(await ask("solana:signMessage", { address: account.address, message: own() }), problems, /too soon/, "a second sign-in within 30 s");
      t.mock.timers.tick(31_000);
      const text = own();
      const ownReply = await ask("solana:signMessage", { address: account.address, message: text });
      assert.ok(ed25519.verify(Buffer.from(result(ownReply).signature!, "base64"), Buffer.from(text, "base64"), key), "pump.fun's own sign-in, 30 s on: signed by the wallet");
      assert.equal((ownReply as { signedIn?: true }).signedIn, true);
    } else {
      t.mock.timers.tick(31_000);
      refusedNothingSigned(await ask("solana:signMessage", { address: account.address, message: own() }), problems, /has no sign-in of its own/, `${host} has no sign-in of its own`, "browser.signin.unknown");
    }
    t.mock.timers.reset();
    assert.equal(sheets.length, setUp, "no sheet for any message");

    // a transaction the core's checks don't pass (a plain SOL transfer to someone else): never silent; the approve sheet
    // asks (Face ID), saying why first, and a no signs nothing (D143 refinement, review H1)
    const tx = transfer(account.address!, base58(new Uint8Array(32).fill(9)), 1_000_000n);
    answer.yes = false;
    const unchecked = await ask("solana:signTransaction", { address: account.address, transaction: tx, chain: "solana:mainnet" });
    answer.yes = true;
    assert.ok("error" in unchecked && !("result" in unchecked), `an unchecked transaction: not signed, not ${JSON.stringify(unchecked)}`);
    assert.equal(sheets.length, setUp + 1, "the approve sheet asked");
    assert.match(sheets.at(-1)!.warnings[0]!.text, /It isn't one trade/);
    assert.equal(sheets.at(-1)!.asker, "browser", "D146: the Browser's sheet");

    // control: a trade the core's checks pass, signed by the wallet it connected, with no sheet
    const out = result(await ask("solana:signTransaction", { address: account.address, transaction: buy(account.address!, 100_000_000n), chain: "solana:mainnet" }));
    const bytes = Buffer.from(out.signedTransaction!, "base64");
    assert.ok(ed25519.verify(bytes.subarray(1, 65), bytes.subarray(65), key), "the trade is signed by the wallet it connected");
    assert.equal(sheets.length, setUp + 1, "a checked trade: no sheet");

    // another known site's page can't use this site's wallet: it gets its own (or the shared one), never this address
    const otherSite = LISTED.find((a) => a.id !== app.id)!;
    const otherOrigin = `https://${otherSite.preset.hosts[0]}`;
    const elsewhere = await engine.handle({ id: ++id, method: "solana:signMessage", params: { address: account.address, message: Buffer.from(siws).toString("base64") }, origin: otherOrigin, mainFrame: true });
    assert.ok("error" in elsewhere, "another site never signs with this site's wallet");
    const elsewhereTx = await engine.handle({ id: ++id, method: "solana:signTransaction", params: { address: account.address, transaction: buy(account.address!, 100_000_000n), chain: "solana:mainnet" }, origin: otherOrigin, mainFrame: true });
    assert.ok("error" in elsewhereTx, "nor trades with it");

    // a sign-in for another site is refused, never signed (60 s on, so the 30 s gap isn't the reason)
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 60_000 });
    const told = problems.length;
    const other = siws.replace(`${host} wants`, "evil.example wants").replace(/Issued At: .*/, `Issued At: ${new Date().toISOString()}`);
    const refused = await ask("solana:signMessage", { address: account.address, message: Buffer.from(other).toString("base64") });
    t.mock.timers.reset();
    assert.ok("error" in refused, "a sign-in for another site");
    assert.equal(problems.length, told + 1, "and the person is told why");
    assert.equal(problems.at(-1)!.code, "browser.signin.refused");
    assert.match(problems.at(-1)!.more ?? "", /Nothing was signed\.$/, "the core's own cause, under the site's sign-in");
    assert.equal(sheets.length, setUp + 1, "no other sheet for the site's own wallet: only the unchecked transaction's");
  });
}

// The product Browser thesis, part 1 (4 Nov): in a Browser tab every site is connected at once with its own new wallet
// (the host's `auto`). Signing is unchanged, through the REAL core: an unlisted site's own wallet signs a trade only
// through its one-tap sheet (D143 refinement, audit C1); a listed site's checked trade and sign-in go with no sheet.
test("a Browser tab: a typed site is pre-connected with its own new wallet, no connect sheet; its trade still asks on the core's sheet (control: pump.fun's goes with none)", async () => {
  const { core, sheets, answer } = await readyCore();
  const { engine, asked } = phoneEngine(core);
  const setUp = sheets.length;
  let id = 0;
  const ask = (origin: string, method: string, params?: unknown) => engine.handle({ id: ++id, method, params, origin, mainFrame: true, auto: true });

  const typed = "https://some-dex.example";
  const account = result(await ask(typed, "solana:connect", { silent: true }));
  assert.deepEqual(asked, [], "no connect sheet");
  const listed = (await forApps(core, "browser").call<{ address: string; kind: string; site?: string; chain: string }[]>("subwallet.list", {})) as { ok: { address: string; kind: string; site?: string; chain: string }[] };
  assert.deepEqual(listed.ok.filter((w) => w.chain === "sol").map((w) => [w.address, w.kind, w.site]), [[account.address, "site", "host:some-dex.example"]], "its own new wallet, for its exact host");

  // a checked trade from it: the core's one-tap sheet asks (the person says no here: nothing signed)
  answer.yes = false;
  const trade = await ask(typed, "solana:signTransaction", { address: account.address, transaction: buy(account.address!, 100_000_000n), chain: "solana:mainnet" });
  answer.yes = true;
  assert.ok("error" in trade && trade.error.code === 4001, `declined on the sheet, not ${JSON.stringify(trade)}`);
  assert.equal(sheets.length, setUp + 1, "the core's sheet asked");
  assert.match(JSON.stringify(sheets.at(-1)), /some-dex\.example isn't a site ZeroFee knows/);
  // and a yes signs it, with the wallet it connected
  const signed = result(await ask(typed, "solana:signTransaction", { address: account.address, transaction: buy(account.address!, 100_000_000n), chain: "solana:mainnet" }));
  const bytes = Buffer.from(signed.signedTransaction!, "base64");
  assert.ok(ed25519.verify(bytes.subarray(1, 65), bytes.subarray(65), fromBase58(account.address!)));
  assert.equal(sheets.length, setUp + 2);

  // control: pump.fun (listed), the same way: its sign-in and a checked trade go with no sheet, as before
  const pump = result(await ask("https://pump.fun", "solana:connect", { silent: true }));
  const siws = `pump.fun wants you to sign in with your Solana account:\n${pump.address}\n\nSign in to pump.fun\n\nURI: https://pump.fun\nVersion: 1\nChain ID: mainnet\nNonce: 8f2a91c4\nIssued At: ${new Date().toISOString()}`;
  assert.equal((await ask("https://pump.fun", "solana:signMessage", { address: pump.address, message: Buffer.from(siws).toString("base64") }) as { signedIn?: true }).signedIn, true);
  result(await ask("https://pump.fun", "solana:signTransaction", { address: pump.address, transaction: buy(pump.address!, 100_000_000n), chain: "solana:mainnet" }));
  assert.equal(sheets.length, setUp + 2, "no sheet for the listed site's sign-in or checked trade");
  assert.deepEqual(asked, [], "and no connect sheet anywhere");
});

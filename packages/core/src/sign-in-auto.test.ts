// Social trading (product decision, 2 Nov): a site's own wallet signs a PLAIN sign-in for its own site with no sheet, so the site
// opens signed in. D143: there is no sheet at all; everything else is refused, named, and nothing is signed: another
// wallet, another site, money words, a stale or nonce-less sign-in, extra lines, resources, plain text that isn't a
// sign-in, another asker than Browser's engine, and past six in an hour. Each with its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { SIGN_IN_GAP_MS, SIGN_IN_PER_HOUR, plainSignInRefusal, readSignIn, siteSignInRefusal } from "./sign-message.ts";
import type { PlainWords } from "./signer.ts";
import { base64, fromBase58, fromBase64, utf8 } from "./sol/bytes.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";

const GMGN = { origin: "https://gmgn.ai" };
const now = () => new Date().toISOString();
const siws = (address: string, o: { domain?: string; statement?: string; nonce?: string | null; issued?: string; extra?: string } = {}) =>
  `${o.domain ?? "gmgn.ai"} wants you to sign in with your Solana account:\n${address}\n\n${o.statement ?? "wallet_sign_statement"}\n\nURI: https://${o.domain ?? "gmgn.ai"}\nVersion: 1\nChain ID: mainnet${o.nonce === null ? "" : `\nNonce: ${o.nonce ?? "a1b2c3d4e5f6"}`}\nIssued At: ${o.issued ?? now()}${o.extra ?? ""}`;

async function setup() {
  const shown: PlainWords[] = [];
  const events: string[] = [];
  const wallets = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm: {} as never, approve: async (w) => (shown.push(w), false), emit: (e) => void events.push(e) });
  const site = await wallets.create("site", "sol", undefined, "gmgn");
  return { wallets, shown, events, site };
}
/** D143: refused, named, nothing signed. */
const refusedFor = (why: RegExp) => (e: any) => e.problem?.code === "security.subwallet.refused" && why.test(e.problem.more) && /Nothing was signed\.$/.test(e.problem.more);
const notSigned = refusedFor(/./);

test("a site's own wallet signs a plain sign-in for its own site with no sheet; the signature is that wallet's", async () => {
  const { wallets, shown, events, site } = await setup();
  const text = siws(site.address);
  const r = await wallets.signMessage(site.id, base64(utf8(text)), GMGN, "Browser");
  assert.ok("signature" in r, "signed, though every sheet here says no");
  assert.equal(r.signedIn, true);
  assert.ok(ed25519.verify(fromBase64(r.signature), utf8(text), fromBase58(site.address)));
  assert.equal(shown.length, 0, "no sheet");
  assert.deepEqual(events, [], "and nothing else happens");
});

test("everything else is refused, nothing signed: money words, no nonce, stale, resources, extra lines, plain text (control: the plain one then signs)", async () => {
  const { wallets, shown, site } = await setup();
  const refused = async (text: string, why: string) => {
    await assert.rejects(wallets.signMessage(site.id, base64(utf8(text)), GMGN, "Browser"), notSigned, why);
  };
  await refused(siws(site.address, { statement: "Sign in and approve a transfer of your tokens" }), "money words");
  await refused(siws(site.address, { statement: "Sign to place a $50 order" }), "a dollar order");
  await refused(siws(site.address, { nonce: null }), "no one-time number");
  await refused(siws(site.address, { issued: "2020-01-01T00:00:00Z" }), "stale");
  await refused(siws(site.address, { extra: "\nResources:\n- https://gmgn.ai/withdraw" }), "resources");
  await refused(siws(site.address, { extra: "\nThen also send 1 SOL" }), "a line a sign-in doesn't have");
  await refused("Sign in to gmgn.ai: 1730000000000", "plain words, not the standard sign-in");
  assert.equal(shown.length, 0, "no sheet");
  // control: none of those took the room; the plain one, on the same wallet, signs
  assert.equal((await wallets.signMessage(site.id, base64(utf8(siws(site.address))), GMGN, "Browser")).signedIn, true);
});

test("never for another site or another wallet: the core refuses those outright; audit C1: a shared chain wallet signs no site's sign-in (control: another site's own wallet signs its own plain sign-in, D143)", async () => {
  const { wallets, shown, site } = await setup();
  await assert.rejects(wallets.signMessage(site.id, base64(utf8(siws(site.address, { domain: "evil.example" }))), { origin: "https://evil.example" }, "Browser"), (e: any) => e.problem.code === "security.subwallet.refused");
  await assert.rejects(wallets.signMessage(site.id, base64(utf8(siws(site.address))), { origin: "https://pump.fun" }, "Browser"), (e: any) => e.problem.code === "security.subwallet.refused");
  // another wallet's sign-in on the right site: refused, named
  const chain = await wallets.create("chain", "sol");
  await assert.rejects(wallets.signMessage(site.id, base64(utf8(siws(chain.address))), GMGN, "Browser"), refusedFor(/names another wallet/));
  // audit C1: the shared chain wallet, asked its own plain sign-in by a site, is refused: a site uses only its own wallet
  await assert.rejects(wallets.signMessage(chain.id, base64(utf8(siws(chain.address))), GMGN, "Browser"), (e: any) => e.problem.more === "This site can use only its own wallet.");
  // control: an unlisted site's own wallet asked its own plain sign-in on its own page signs it with no sheet (D143)
  const SITE = { origin: "https://app.example.com" };
  const mine = await wallets.siteFor(SITE, "sol");
  const own = siws(mine.address, { domain: "app.example.com" });
  const r = await wallets.signMessage(mine.id, base64(utf8(own)), SITE, "Browser");
  assert.equal(r.signedIn, true);
  assert.ok(ed25519.verify(fromBase64(r.signature), utf8(own), fromBase58(mine.address)));
  assert.equal(shown.length, 0);
});

test("a site's own wallet: at most six sign-ins an hour, never two within 30 s (review B, M4; ST4: GMGN signs in again each time it opens); past either, refused; and only for Browser's engine (L1)", async () => {
  const { wallets, shown, site } = await setup();
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  try {
    // the text's own Issued At follows the clock, so each is fresh when asked
    const sign = (n: number) => wallets.signMessage(site.id, base64(utf8(siws(site.address, { nonce: `nonce${String(n).padStart(4, "0")}`, issued: new Date(clock).toISOString() }))), GMGN, "Browser");
    const tooSoon = refusedFor(/asked to sign you in again too soon/);
    assert.ok("signature" in (await sign(1)));
    clock += 5_000;
    await assert.rejects(sign(2), tooSoon, "a second within 30 s is refused");
    clock += SIGN_IN_GAP_MS;
    assert.ok("signature" in (await sign(3)), "a re-open 30 s later signs in (the refused one took no room)");
    for (let n = 4; n <= 7; n++) {
      clock += 5 * 60_000;
      assert.ok("signature" in (await sign(n)), `sign-in ${n} in the hour`);
    }
    clock += 5 * 60_000;
    await assert.rejects(sign(8), tooSoon, "a seventh within the hour is refused");
    assert.equal(shown.length, 0, "no sheet, ever");
    clock += 60 * 60_000;
    assert.ok("signature" in (await sign(9)), "an hour on, there is room again");
    assert.equal(SIGN_IN_PER_HOUR, 6);
    assert.deepEqual(wallets.siteSignIns().map((x) => [x.wallet, x.site]), [[site.id, "gmgn.ai"]], "and it is recorded for the wallet sheet");
  } finally {
    Date.now = realNow;
  }
  // another caller than Browser's engine (ZeroFee's own screens, the hub, another app) is refused
  const fresh = await setup();
  for (const asker of [undefined, "Social trading", "ZeroFee"]) {
    await assert.rejects(fresh.wallets.signMessage(fresh.site.id, base64(utf8(siws(fresh.site.address))), GMGN, asker), refusedFor(/Only a site's own window signs you in/), String(asker));
  }
  // control: Browser's engine, the same sign-in on the same wallet (the refusals took no room)
  assert.equal((await fresh.wallets.signMessage(fresh.site.id, base64(utf8(siws(fresh.site.address))), GMGN, "Browser")).signedIn, true);
  assert.equal(fresh.shown.length, 0);
});

test("security review B (M1, M2): everything that only looks plain is refused", async () => {
  const a = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const t = (o: Parameters<typeof siws>[1] = {}) => siws(a, o);
  const cases: [string, string][] = [
    [t({ statement: "Grant unlimited spending rights" }), "rights"],
    [t({ statement: "This approves withdrawals" }), "approves"],
    [t({ statement: "Authorizes payments" }), "authorizes"],
    [t({ statement: "Authorization to place orders" }), "orders"],
    [t({ statement: "Enable one-click trading" }), "enable"],
    [t({ statement: "Sign in for 100 USDT and 2 ETH" }), "amounts"],
    [t({ statement: "\u0430pprove" }).replace("\\u0430", "\u0430"), "a Cyrillic letter"],
    [t({ statement: "app\u2060rove" }).replace("\\u2060", "\u2060"), "an invisible letter"],
    [t({ extra: "\nRequest ID: I approve transfer of all my tokens" }), "a Request ID"],
    [t({ extra: "\nResources:\n- https://gmgn.ai/x" }), "resources"],
    [t().replace("URI: https://gmgn.ai", "URI: https://evil.example/withdraw"), "a URI elsewhere"],
    [t().replace("Version: 1", "Version: 1 - I authorise GMGN to sell everything"), "words in a field"],
    [t({ nonce: "a".repeat(900) }), "a huge nonce"],
    [t().replace(/\nIssued At: .*/, ""), "no Issued At"],
    [t({ extra: `\nIssued At: 2025-01-01T00:00:00Z` }), "a second Issued At"],
    [t({ extra: "\nExpiration Time: 2999-01-01T00:00:00Z" }), "an expiry far off"],
    [t({ extra: "\nNonce: abcdefgh1" }), "a second Nonce"],
  ];
  for (const [text, why] of cases) {
    const s = readSignIn(text, "Solana");
    assert.ok(s === null || plainSignInRefusal(text, s, Date.now()) !== null, why);
  }
  // control: the plain one passes
  assert.equal(plainSignInRefusal(t(), readSignIn(t(), "Solana")!, Date.now()), null);
});

test("the rule alone: a plain sign-in passes, and each way out of it is named", () => {
  const a = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const read = (t: string) => readSignIn(t, "Solana")!;
  const t0 = siws(a);
  assert.equal(plainSignInRefusal(t0, read(t0), Date.now()), null);
  const t1 = siws(a, { issued: new Date(Date.now() - 11 * 60_000).toISOString() });
  assert.match(plainSignInRefusal(t1, read(t1), Date.now())!, /fresh/);
  const t2 = siws(a, { statement: "Withdraw all" });
  assert.match(plainSignInRefusal(t2, read(t2), Date.now())!, /more than signing in/);
});

// ST4 (probed in the phone's WebKit, 2 Nov): pump.fun signs its wallet log-in as "Sign in to pump.fun: <ms>", not the
// standard text. Its own wallet signs exactly that, fresh, for pump.fun, with no sheet; everything near it is refused.
test("pump.fun's own sign-in: exactly its text, fresh, its own wallet on its own site, no sheet; anything near it is refused, nothing signed", async () => {
  const shown: PlainWords[] = [];
  const wallets = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm: {} as never, approve: async (w) => (shown.push(w), false), emit: () => {} });
  const pump = await wallets.create("site", "sol", undefined, "pump");
  const PUMP = { origin: "https://pump.fun" };
  const text = `Sign in to pump.fun: ${Date.now()}`;
  const r = await wallets.signMessage(pump.id, base64(utf8(text)), PUMP, "Browser");
  assert.ok("signature" in r, "signed with no sheet");
  assert.ok(ed25519.verify(fromBase64(r.signature), utf8(text), fromBase58(pump.address)));
  assert.equal(shown.length, 0);
  assert.deepEqual(wallets.siteSignIns().map((x) => x.site), ["pump.fun"], "recorded for the wallet sheet");
  // each refused for its own reason, named (pump.fun has one site wallet, so each reason is checked before its room)
  const refused = async (t: string, why: string, reason: RegExp, asker = "Browser") => {
    const w = await wallets.create("site", "sol", undefined, "pump");
    await assert.rejects(wallets.signMessage(w.id, base64(utf8(t)), PUMP, asker), refusedFor(reason), why);
  };
  const notOwn = /isn't this site's own sign-in/;
  await refused(`Sign in to pump.fun: ${Date.now() - 3 * 60_000}`, "three minutes old (review M1: at most 2)", /isn't fresh/);
  await refused(`Sign in to pump.fun: ${Date.now() + 60_000}`, "a minute ahead (review M1: at most 30 s)", /isn't fresh/);
  await refused(`Sign in to pump.fun: ${Date.now()}\nand send 1 SOL`, "a second line", notOwn);
  await refused(`Sign in to pump.fun: ${Date.now()} `, "a trailing space", notOwn);
  await refused(`Sign in to pump.fun and approve: ${Date.now()}`, "other words", notOwn);
  await refused(`Sign in to pump.fun: 12345`, "not a clock", notOwn);
  await refused(`Sign in to evil.example: ${Date.now()}`, "another site's name", notOwn);
  await refused(`Sign in to pump.fun: ${Date.now()}`, "not Browser's engine", /Only a site's own window signs you in/, "Social trading");
  // the shape is pump.fun's only: GMGN's own wallet asked it on GMGN is refused
  const g = await wallets.create("site", "sol", undefined, "gmgn");
  await assert.rejects(wallets.signMessage(g.id, base64(utf8(`Sign in to gmgn.ai: ${Date.now()}`)), GMGN, "Browser"), refusedFor(/no sign-in of its own/));
  // and a chain wallet (not pump.fun's own) asked pump.fun's text on pump.fun is refused: a site uses only its own wallet (audit C1)
  const chain = await wallets.create("chain", "sol");
  await assert.rejects(wallets.signMessage(chain.id, base64(utf8(`Sign in to pump.fun: ${Date.now()}`)), PUMP, "Browser"), (e: any) => e.problem.more === "This site can use only its own wallet.");
  // nor another site's own wallet: pump.fun's shape is pump.fun's own wallet's only
  const other = await wallets.siteFor({ origin: "https://app.example.com" }, "sol");
  await assert.rejects(wallets.signMessage(other.id, base64(utf8(`Sign in to app.example.com: ${Date.now()}`)), { origin: "https://app.example.com" }, "Browser"), refusedFor(/words that aren't a sign-in/));
  // control: past the 30 s gap, pump.fun's wallet signs the exact text, fresh, again (the refusals above took no room)
  const realNow = Date.now;
  const later = realNow() + SIGN_IN_GAP_MS + 1_000;
  Date.now = () => later;
  try {
    const p2 = await wallets.create("site", "sol", undefined, "pump");
    assert.equal((await wallets.signMessage(p2.id, base64(utf8(`Sign in to pump.fun: ${Date.now()}`)), PUMP, "Browser")).signedIn, true);
  } finally {
    Date.now = realNow;
  }
  assert.equal(shown.length, 0);
  // the rule alone names each way out
  assert.equal(siteSignInRefusal(`Sign in to pump.fun: ${Date.now()}`, "pump.fun", Date.now()), null);
  assert.match(siteSignInRefusal(`Sign in to pump.fun: ${Date.now()}`, "gmgn.ai", Date.now())!, /no sign-in of its own/);
  assert.match(siteSignInRefusal(`Sign in to pump.fun: ${Date.now() - 3 * 60_000}`, "pump.fun", Date.now())!, /fresh/);
  assert.equal(siteSignInRefusal(`Sign in to pump.fun: ${Date.now() - 90_000}`, "pump.fun", Date.now()), null, "90 s old passes (control)");
  assert.equal(siteSignInRefusal(`Sign in to pump.fun: ${Date.now() + 20_000}`, "pump.fun", Date.now()), null, "20 s ahead passes (control)");
  assert.match(siteSignInRefusal("Sign in to pump.fun: now", "pump.fun", Date.now())!, /own sign-in/);
  assert.match(siteSignInRefusal(`Sign in to pump.fun: ${Date.now()}`, "__proto__", Date.now())!, /no sign-in of its own/);
});

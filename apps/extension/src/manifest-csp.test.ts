// D157: the extension's pages run no remote code, and fetch only what the phone may fetch. The policy is made from the
// phone's own list (manifest-gen.ts); these check the made policy, and the BUILT manifest when there is a build (npm run
// build runs this file with ZF_REQUIRE_BUILD=1, so a build without its policy fails).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { EXTENSION_ID } from "./extension-id.ts";
import { builtManifest, extensionIdOf, connectHosts, connectSources, directive, extensionCsp, relayOrigin, relayUrl, wssHosts } from "./manifest-gen.ts";

const here = fileURLToPath(new URL("..", import.meta.url));
const built = join(here, "build/manifest.json");

/** The phone's list, read here independently of manifest-gen.ts: connect-hosts.txt's lines, the relay, build-web.sh's WSS_HOSTS. */
function phoneList(): Set<string> {
  const repo = join(here, "../..");
  const hosts = readFileSync(join(repo, "apps/ios/connect-hosts.txt"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const relay = readFileSync(join(repo, "apps/ios/relay-url.txt"), "utf8").trim();
  const wss = /^WSS_HOSTS="([^"]*)"$/m.exec(readFileSync(join(repo, "apps/ios/build-web.sh"), "utf8"))![1]!.split(/\s+/);
  return new Set(["'self'", ...(relay ? [new URL(relay).origin] : []), ...hosts, ...wss]);
}
/** What a mainnet-only build never calls (review M6), written here apart from manifest-gen.ts: any testnet host,
 *  Anthropic's API, the archival nodes, and Chat's nostr relay sockets (Chat isn't live in the release). */
const notOnMainnet = (h: string) => /test(net)?[.-]|[.-]test(net)?\b/.test(h) || h === "https://api.anthropic.com" || h.startsWith("https://archival-rpc.") || (h.startsWith("wss://") && !wssOf().includes(h));
const wssOf = () => /^WSS_HOSTS="([^"]*)"$/m.exec(readFileSync(join(here, "../../apps/ios/build-web.sh"), "utf8"))![1]!.split(/\s+/);
/** The extension's list: the phone's, less notOnMainnet. */
const mainnetList = () => new Set([...phoneList()].filter((h) => !notOnMainnet(h)));

/** No remote code: scripts from the extension alone; nothing framed, no plugins, no base or form tricks. */
function noRemoteCode(csp: string) {
  assert.deepEqual(directive(csp, "script-src"), ["'self'"]);
  assert.deepEqual(directive(csp, "default-src"), ["'self'"]);
  assert.deepEqual(directive(csp, "object-src"), ["'none'"]);
  assert.deepEqual(directive(csp, "frame-src"), ["'none'"]);
  assert.deepEqual(directive(csp, "base-uri"), ["'none'"]);
  assert.equal(directive(csp, "worker-src"), undefined); // falls back to script-src 'self'
  assert.doesNotMatch(csp, /unsafe-eval|wasm-unsafe-eval|strict-dynamic|\bhttp:|\*/);
  for (const d of ["script-src", "default-src"]) for (const s of directive(csp, d)!) assert.doesNotMatch(s, /^(https?|wss?):/i);
}

/** connect-src is exactly the phone's list: nothing more, nothing less, no bare scheme. */
function connectMatches(csp: string) {
  const got = directive(csp, "connect-src")!;
  assert.equal(new Set(got).size, got.length, "no source twice");
  assert.deepEqual(new Set(got), mainnetList());
  for (const s of got) assert.ok(phoneList().has(s), `${s} is not on the phone's list`);
  assert.ok(!got.some(notOnMainnet), "a testnet, Anthropic, archival or Chat host is in");
  // controls: what stays (NEAR mainnet, the price sockets, Agent's model host) and what went (testnet, nostr)
  for (const h of ["https://rpc.mainnet.fastnear.com", "wss://solana-rpc.publicnode.com", "https://cloud-api.near.ai"]) assert.ok(got.includes(h), `${h} missing`);
  for (const h of ["https://rpc.testnet.near.org", "wss://nos.lol", "https://api.anthropic.com"]) assert.ok(!got.includes(h), `${h} is in`);
  for (const s of got) assert.ok(s === "'self'" || /^(https|wss):\/\/[a-z0-9.-]+$/i.test(s), `not an origin: ${s}`);
}

test("D157: the made policy has no remote code and its connect-src is exactly the phone's list less what mainnet never calls", () => {
  const csp = extensionCsp();
  noRemoteCode(csp);
  connectMatches(csp);
  assert.deepEqual(connectSources().slice(0, relayUrl() ? 2 : 1), ["'self'", ...(relayUrl() ? [relayOrigin(relayUrl())] : [])]);
  // images: the extension, data:, blob:, the relay, and the trading panel's own two coin-image hosts
  const img = directive(csp, "img-src")!;
  assert.deepEqual(img.slice(0, 3), ["'self'", "data:", "blob:"]);
  assert.ok(img.every((s) => ["'self'", "data:", "blob:", relayOrigin(relayUrl()), "https://coin-images.coingecko.com", "https://assets.geckoterminal.com"].includes(s)));
});

test("D157: the lists refuse a wildcard, a bare scheme, a wrong relay, and a WSS_HOSTS line that isn't four origins", () => {
  assert.throws(() => connectHosts("https://a.example\nhttps:\n"));
  assert.throws(() => connectHosts("https://*.example\n"));
  assert.throws(() => connectHosts("http://a.example\n"));
  assert.deepEqual(connectHosts("# c\nhttps://a.example\n\nwss://b.example\n"), ["https://a.example", "wss://b.example"]); // control
  assert.throws(() => relayUrl("http://relay.example"));
  assert.equal(relayUrl(" \n"), "");
  assert.throws(() => wssHosts('WSS_HOSTS="wss://a.example"\n'));
  assert.equal(wssHosts().length, 4); // control: the real line
});

test("D157: the built manifest carries the made policy and opens the app in the side panel", () => {
  const m = builtManifest({ manifest_version: 3, side_panel: { default_path: "panel.html" }, content_security_policy: { extension_pages: "default-src *" } });
  assert.equal(m.side_panel?.default_path, "app.html");
  assert.equal(m.content_security_policy?.extension_pages, extensionCsp());
});

test("D157: the BUILT manifest (build/manifest.json) has no remote code, connect-src is the mainnet list, and the id is pinned", { skip: !existsSync(built) && process.env.ZF_REQUIRE_BUILD !== "1" ? "no build/ here (npm run build runs this with ZF_REQUIRE_BUILD=1)" : false }, () => {
  assert.ok(existsSync(built), "build/manifest.json is missing");
  const m = JSON.parse(readFileSync(built, "utf8")) as { content_security_policy?: { extension_pages?: string }; side_panel?: { default_path?: string }; background?: unknown };
  const csp = m.content_security_policy?.extension_pages ?? "";
  noRemoteCode(csp);
  connectMatches(csp);
  assert.equal(m.side_panel?.default_path, "app.html");
  // the "hybrid" request hint (straight to the QR code for the iPhone) is Chrome 128's
  assert.ok(Number((m as { minimum_chrome_version?: string }).minimum_chrome_version) >= 128, "minimum_chrome_version must be 128 or later");
  // review L5: build/ is never the load check's sample build
  assert.deepEqual(JSON.parse(readFileSync(join(here, "build/app/build.json"), "utf8")), { check: false });
  // review B1: the built manifest carries the operator's public key, and it gives the documented id
  const key = (m as { key?: string }).key;
  assert.ok(key, "the built manifest has no key: the id isn't pinned");
  assert.equal(extensionIdOf(key!), EXTENSION_ID);
  for (const page of ["app.html", "approve.html", "panel.html"]) {
    const html = readFileSync(join(here, "build", page), "utf8");
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${page}: an inline script`);
    for (const src of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/gi)) assert.doesNotMatch(src[1]!, /^(https?:)?\/\//i, `${page}: a remote script`);
  }
});

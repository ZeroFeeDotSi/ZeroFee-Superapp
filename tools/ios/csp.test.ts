// Audit NF-12 (network and supply chain, 28 Oct 2026; FIXED): the phone's page may fetch only the origins it needs and
// load images only from the app, data:, blob: or the relay (which serves every coin logo). build-web.sh writes the CSP
// from apps/ios/connect-hosts.txt; these read the sources: every host the page's code names is either fetched (listed)
// or only linked to (below), so a new endpoint is added to the list on purpose, never by a bare "https:".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_RELAYS } from "../../packages/chat/src/allowlist.ts";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const listed = new Set(read("apps/ios/connect-hosts.txt").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));

/** Hosts the page's code names only as links (explorers, partners' sites and help pages), never fetched. */
const LINK_ONLY = new Set([
  // the web top note's "Laptop approval" link (top-note-words.ts TOP_NOTE_LAPTOP_URL): a link, never fetched
  "https://laptop.zerofee.si",
  // B30: each service's own status page, linked from the status banner and the sheets' lines (core services.ts STATUS_LINKS)
  "https://partners.near-intents.org", "https://status.near.org", "https://status.solana.com", "https://helius.statuspage.io",
  "https://app.gnosispay.com", "https://app.mtpelerin.com", "https://app.rampnetwork.com", "https://arbiscan.io", "https://basescan.org", "https://blog.indodax.com",
  "https://bscscan.com", "https://coins.ph", "https://console.anthropic.com", "https://docs.bitrefill.com", "https://docs.peer.xyz", "https://etherfi.gitbook.io",
  "https://etherscan.io", "https://explorer.chain.robinhood.com", "https://explorer.near-intents.org", "https://fomo.family", "https://github.com", "https://gmgn.ai", "https://gnosisscan.io", "https://help.bitrefill.com",
  "https://help.ether.fi", "https://helpcenter.redotpay.com", "https://indodax.com", "https://livenet.xrpl.org", "https://mempool.space", "https://metamask.io",
  "https://nearblocks.io", "https://optimistic.etherscan.io", "https://peer.xyz", "https://pexx.com", "https://polygonscan.com", "https://pump.fun",
  "https://sell.moonpay.com", "https://solcard.cc", "https://solscan.io", "https://support.coins.ph", "https://support.kraken.com", "https://support.metamask.io",
  "https://support.quidax.io", "https://tangem.com", "https://testnet.nearblocks.io", "https://tronscan.org", "https://widget.mtpelerin.com", "https://www.binance.com",
  "https://www.binance.th", "https://www.bitrefill.com", "https://www.bleap.finance", "https://www.ether.fi", "https://www.kraken.com", "https://www.mtpelerin.com",
  "https://www.paribu.com", "https://www.quidax.io", "https://www.redotpay.com",
  // the web wallet's "Get the phone app" link (shell-api web-wallet-words.ts PHONE_APP_URL): opened in a new tab, never fetched
  "https://zerofee.si",
  // D131: the Browser's search for words that aren't an address (address.ts searchUrl): opened in its window, never fetched
  "https://duckduckgo.com",
  // the App Store's apps (packages/browser/src/social/catalog.ts): opened in ZeroFee's window or a new tab, never fetched
  "https://jup.ag", "https://raydium.io", "https://www.orca.so", "https://kamino.com", "https://app.sanctum.so",
]);

/** Hosts only the phone's isolated core fetches (CoreContext.swift coreHosts), never the page: the page's CSP doesn't
 *  list them. D119 landing 3: Hyperliquid's mainnet API (perps run in the isolated core's "perps" family). Each must be in
 *  coreHosts (checked below), so this list can't hide a host the page would fetch. */
const CORE_ONLY = new Set(["https://api.hyperliquid.xyz"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(repo, dir))) {
    const p = join(dir, name);
    if (statSync(join(repo, p)).isDirectory()) {
      if (name !== "node_modules" && name !== "testing") sources(p, out);
    } else if (/\.(ts|tsx|js)$/.test(name) && !/\.test\.|recorded|demo-samples|^testing\.ts$/.test(name)) out.push(p);
  }
  return out;
}

test("NF-12: every host the page's code names is one it may fetch (connect-hosts.txt) or one it only links to", () => {
  const dirs = [...readdirSync(join(repo, "packages")).map((p) => `packages/${p}/src`).filter((d) => { try { return statSync(join(repo, d)).isDirectory(); } catch { return false; } }), "apps/web/src"];
  const unknown = new Map<string, string>();
  for (const file of dirs.flatMap((d) => sources(d))) {
    for (const [host] of read(file).matchAll(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?/g)) {
      if (/\.(example|test)(:|$)|example\.(com|app)|evil\./.test(host)) continue;
      if (!listed.has(host) && !LINK_ONLY.has(host) && !CORE_ONLY.has(host)) unknown.set(host, file);
    }
  }
  assert.deepEqual([...unknown].map(([h, f]) => `${h} (${f})`), [], "add each to apps/ios/connect-hosts.txt if the page fetches it, or to LINK_ONLY if it only links there");
  const coreHosts = /static let coreHosts[^\]]*\]/s.exec(read("apps/ios/ZeroFee/CoreContext.swift"))?.[0] ?? "";
  for (const h of CORE_ONLY) {
    assert.ok(coreHosts.includes(`"${new URL(h).host}"`), `${h} is CORE_ONLY, so the isolated core's coreHosts must list it`);
    assert.ok(!listed.has(h), `${h} is CORE_ONLY: the page's connect-src never lists it`);
  }
});

test("NF-12: the phone's CSP fetches and loads images only from listed origins, never any https host", () => {
  const sh = read("apps/ios/build-web.sh");
  const csp = /CSP="([^"]+)"/.exec(sh)![1]!;
  const directive = (name: string) => (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "").split(/\s+/).slice(1);
  assert.deepEqual(directive("connect-src"), ["'self'", "$RELAY_ORIGIN", "$CONNECT_HOSTS", "$WSS_HOSTS"]);
  assert.deepEqual(directive("img-src"), ["'self'", "data:", "blob:", "$RELAY_ORIGIN"]);
  for (const host of listed) assert.match(host, /^(https|wss):\/\/[a-z0-9.-]+\.[a-z]{2,}$/, `connect-hosts.txt lists origins only: ${host}`);
  assert.ok(listed.has("https://api.anthropic.com"), "Agent's SDK host, which our code never names");
});

test("ZeroFee Chat (D55): every wss:// the page's code names is listed, and the listed sockets are its allow-list and nothing else", () => {
  const dirs = [...readdirSync(join(repo, "packages")).map((p) => `packages/${p}/src`).filter((d) => { try { return statSync(join(repo, d)).isDirectory(); } catch { return false; } }), "apps/web/src"];
  const named = new Set<string>();
  for (const file of dirs.flatMap((d) => sources(d))) for (const [host] of read(file).matchAll(/wss:\/\/[a-z0-9.-]+\.[a-z]{2,}/g)) named.add(host);
  const sockets = [...listed].filter((h) => h.startsWith("wss://"));
  const wss = /WSS_HOSTS="([^"]+)"/.exec(read("apps/ios/build-web.sh"))![1]!.split(" ");
  for (const h of named) assert.ok(sockets.includes(h) || wss.includes(h), `${h} is opened by the page's code but not approved`);
  // Slice 2: the allow-list (packages/chat/src/allowlist.ts), exactly: about 40 exact hosts, no wildcard.
  assert.deepEqual([...sockets].sort(), [...ALLOWED_RELAYS].sort(), "the listed sockets are Chat's allow-list");
  assert.ok(sockets.length >= 35 && sockets.length <= 45, `${sockets.length} relays`);
  assert.ok(!sockets.includes("wss://relay.damus.io"), "damus serves private messages only after AUTH: never opened");
  assert.ok(sockets.every((s) => named.has(s)), "every listed relay is one Chat uses");
});

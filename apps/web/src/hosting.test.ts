// The public web app's hosting rules: the committed vercel.json is exactly what hosting.ts makes from the approved host
// list, and the policy is strict (no outside script, no framing, only listed hosts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AGENT_HOSTS, WEB_UNUSED, WSS_HOSTS, approvedHosts, chatRelays, connectSrc, csp, isLeftOut, phoneConnectSrc, relayOrigin, vercelJson } from "./hosting.ts";
import { ALLOWED_RELAYS } from "@zerofee/chat/allowlist.ts";

test("ZeroFee Chat's relays: the allow-list (slice 2), in the approved list, in the public CSP only once Chat is live there", () => {
  assert.deepEqual(chatRelays(), [...ALLOWED_RELAYS]);
  for (const r of ALLOWED_RELAYS) assert.match(r, /^wss:\/\/[a-z0-9.-]+\.[a-z]{2,}$/, r);
  const relays = new Set<string>(ALLOWED_RELAYS);
  assert.ok(!connectSrc().some((h) => relays.has(h)), "Chat is Coming soon in the release: no relay socket");
  assert.deepEqual(connectSrc().filter((h) => h.startsWith("wss://")), WSS_HOSTS, "only the four price sockets");
  const live = connectSrc(approvedHosts(), relayOrigin(), new Set(["wallet", "trade", "social", "chat"]));
  assert.deepEqual(live.filter((h) => h.startsWith("wss://") && !WSS_HOSTS.includes(h)), [...ALLOWED_RELAYS], "with Chat live: exactly the allow-list, no wildcard");
});

test("apps/web/vercel.json is the generated one (run: node apps/web/src/hosting.ts)", () => {
  assert.equal(readFileSync(fileURLToPath(new URL("../vercel.json", import.meta.url)), "utf8"), vercelJson());
});

test("the CSP: scripts from the app only, no framing either way, connect-src only the approved mainnet hosts", () => {
  const policy = csp();
  const dir = (name: string) => policy.split("; ").find((d) => d.startsWith(`${name} `))!;
  assert.equal(dir("script-src"), "script-src 'self'");
  assert.equal(dir("default-src"), "default-src 'self'");
  assert.equal(dir("frame-ancestors"), "frame-ancestors 'none'");
  assert.equal(dir("object-src"), "object-src 'none'");
  assert.doesNotMatch(policy, /unsafe-eval|https:(?!\/\/)|\*|wss:(?!\/\/)|http:\/\//, "no wildcard, bare scheme or eval");
  const src = connectSrc();
  assert.equal(src[0], "'self'");
  for (const h of src.slice(1)) assert.match(h, /^(https|wss):\/\/[a-z0-9.-]+\.[a-z]{2,}$/, h);
  assert.equal(dir("connect-src"), `connect-src ${src.join(" ")}`);
  assert.equal(dir("img-src"), `img-src 'self' data: blob: ${relayOrigin()}`, "coin logos come from the relay's logo route only");
  assert.equal(isLeftOut("https://near-testnet.drpc.org"), true);
  assert.equal(isLeftOut("https://tx.test.fastnear.com"), true);
  assert.equal(isLeftOut("https://api.fastnear.com"), false);
});

/** The public build's connect-src, written out (product decision, 3 Nov, D87: a real account on the hosted web reaches what the phone
 *  reaches). Pinned here so any widening is a deliberate edit of this list, read in review.
 *  rpc.mainnet.near.org is gone (product decision, 4 Nov: deprecated, -429 to every call). */
const PUBLIC_CONNECT = [
  "'self'",
  "https://quotes-seven-gamma.vercel.app",
  "https://rpc.mainnet.fastnear.com", "https://near.drpc.org", "https://api.fastnear.com", "https://tx.main.fastnear.com", "https://rpc.intea.rs",
  "https://1click.chaindefuser.com",
  "https://solana-rpc.publicnode.com", "https://solana.api.pocket.network", "https://public.rpc.solanavibestation.com", "https://lite-api.jup.ag", "https://mainnet.block-engine.jito.wtf",
  "https://bsc-dataseed.bnbchain.org", "https://bsc-dataseed1.defibit.io", "https://bsc-dataseed1.ninicoin.io", "https://bsc-rpc.publicnode.com", "https://bsc.api.pocket.network", "https://rpc-bsc.48.club",
  "https://rpc.mainnet.chain.robinhood.com", "https://robinhood-rpc.publicnode.com", "https://robinhood.drpc.org",
  "https://api.geckoterminal.com", "https://api.coingecko.com", "https://aggregator-api.kyberswap.com",
  "wss://solana-rpc.publicnode.com", "wss://public.rpc.solanavibestation.com", "wss://bsc-rpc.publicnode.com", "wss://robinhood-rpc.publicnode.com",
];

/** The phone's connect-src as apps/ios/build-web.sh composes it, read from the script itself (its CSP line's connect-src
 *  directive and its WSS_HOSTS), expanded with connect-hosts.txt and relay-url.txt as the script does: not hosting.ts's copy. */
function phoneFromScript(): string[] {
  const sh = readFileSync(fileURLToPath(new URL("../../ios/build-web.sh", import.meta.url)), "utf8");
  const directive = /^CSP="[^"]*?connect-src ([^;]+);/m.exec(sh)![1]!.trim().split(/\s+/);
  const wss = /^WSS_HOSTS="([^"]+)"/m.exec(sh)![1]!.split(" ");
  const relayUrl = readFileSync(fileURLToPath(new URL("../../ios/relay-url.txt", import.meta.url)), "utf8").trim();
  const relay = relayUrl ? relayUrl.replace(/^(https:\/\/[^/]+).*$/, "$1") : "";
  const listed = readFileSync(fileURLToPath(new URL("../../ios/connect-hosts.txt", import.meta.url)), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const vars: Record<string, string[]> = { $RELAY_ORIGIN: relay ? [relay] : [], $CONNECT_HOSTS: listed, $WSS_HOSTS: wss };
  return directive.flatMap((t) => (t in vars ? vars[t]! : [t]));
}

test("the hosted web app reaches what the phone reaches (D87, product decision, 3 Nov): the pinned list, a subset of the phone's own policy, never testnet, Anthropic, archival nodes, Agent's model or Chat's sockets while those apps aren't live", () => {
  const web = connectSrc();
  assert.deepEqual(web, PUBLIC_CONNECT, "a widening is an edit of PUBLIC_CONNECT, on purpose");
  const phone = phoneFromScript();
  assert.equal(phone[0], "'self'");
  for (const h of web) assert.ok(phone.includes(h), `${h} is on the web's list but not in the phone's own policy`);
  assert.deepEqual(phoneConnectSrc(), phone, "hosting.ts's phone list is the script's");
  // never on the public build while the apps that call them aren't live: Agent's model host and Chat's sockets
  assert.ok(!web.some((h) => AGENT_HOSTS.includes(h)), "Agent is the demo's sample chat on the public site: no NEAR AI Cloud");
  assert.ok(!web.some((h) => chatRelays().includes(h)), "Chat is Coming soon: none of its sockets");
  for (const h of web) assert.ok(!/test(net)?[.-]|archival-rpc\./.test(h) && h !== "https://api.anthropic.com", h);
  assert.ok(!web.some((h) => h.includes("*")) && !web.some((h) => /^(https?|wss?):$/.test(h)), "no wildcard, no bare scheme");
  // controls: Agent live with a model on the public site: its model host joins (and only it); with Agent not live it
  // stays out even so; a testnet host stays out even when approved
  const agentLive = connectSrc(approvedHosts(), relayOrigin(), new Set(["wallet", "trade", "social", "agent"]), true);
  assert.deepEqual(agentLive.filter((h) => !web.includes(h)), [...AGENT_HOSTS]);
  assert.ok(!connectSrc(approvedHosts(), relayOrigin(), new Set(["wallet", "trade", "social"]), true).some((h) => AGENT_HOSTS.includes(h)));
  assert.ok(!connectSrc([...approvedHosts(), "https://rpc.testnet.example.org"]).includes("https://rpc.testnet.example.org"), "a testnet host stays out");
});

test("deploy-app.sh: previews only, from a clean committed copy, no git link, never a secret printed", () => {
  const sh = readFileSync(fileURLToPath(new URL("../deploy-app.sh", import.meta.url)), "utf8");
  const code = sh.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.match(code, /STOP: this script deploys previews only/);
  assert.match(code, /vercel deploy --yes --target=preview/);
  assert.doesNotMatch(code.replace(/case " \$\* " in[^\n]*/, ""), /--prod\b|--target=production/, "never a production deploy");
  assert.doesNotMatch(code, /vercel git connect|vercel env (pull|ls)|\.env/, "no git link, no environment read");
  assert.match(code, /git -C "\$repo" archive HEAD/);
  assert.match(code, /npm ci --ignore-scripts/);
  assert.match(code, /VITE_ZEROFEE_PUBLIC=1/);
  // no local address ever reaches a person: the build is refused when one is in it, and the check catches one
  const check = code.split("\n").find((l) => l.includes("STOP: a local address"));
  assert.ok(check, "deploy-app.sh refuses a build with a local address");
  const pattern = new RegExp(/grep -rqE -- '([^']+)'/.exec(check!)![1]);
  for (const bad of ["http://127.0.0.1:5181/?laptop", "localhost:5180", "[::1]:5180/x", "0.0.0.0:8080"]) assert.ok(pattern.test(bad), bad);
  for (const fine of ['["localhost","127.0.0.1","[::1]"].includes(h)', "open ZeroFee and choose Second device"]) assert.ok(!pattern.test(fine), fine);
});

test("deploy-app.sh's release rules (D157, the Sim only): no key path, no Coming soon, no real account, the Sim whole, no laptop page", () => {
  const sh = readFileSync(fileURLToPath(new URL("../deploy-app.sh", import.meta.url)), "utf8");
  const code = sh.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.match(code, /VITE_ZEROFEE_PUBLIC=1 VITE_HOME_PROOF=1 VITE_WEB_TRADE=1 VITE_ZEROFEE_RELAY="\$RELAY" npm run -s -w @zerofee\/web build/, "Trade on the web: the product call (VITE_WEB_TRADE=1)");
  assert.match(code, /for gone in "x-api-key" "bitrefill\.com" "LegacyRoot" "api\.anthropic\.com" "etherfi-cash"; do/);
  assert.match(code, /! grep -rqF -- "Wallet, Trade and Security work now"/);
  // the web wallet (product decision, 4 Nov): its password vault and lock are allowed now; the Safe still never ships
  assert.doesNotMatch(code, /for gone in "zerofee-mainnet-vault"/, "the web wallet's vault is allowed");
  assert.doesNotMatch(code, /"Lock ZeroFee on this device"/, "the web wallet's lock is allowed");
  assert.match(code, /grep -rqF -- "Web version: no Safe\." "\$dist\/assets" \|\|/, "the web wallet is in");
  assert.match(code, /\[ -z "\$\(find "\$dist" -name 'account_policy\*\.wasm' -print -quit\)" \] \|\|/, "the account contract (the Safe) never ships");
  assert.match(code, /for gone in "PublicKeyCredential" "navigator\.credentials"; do\n  ! grep -rqF -- "\$gone" "\$dist\/assets" \|\|/, "no passkey ships");
  assert.match(code, /for here in "ZeroFee, on pretend money" "Sim: pretend money"; do/);
  assert.match(code, /"Or copy the code to paste on your phone"/, "the laptop page stays out");
  // control: the Sim | Real rule (the real vault must be in) is gone, or the Sim-only build could never pass
  assert.doesNotMatch(code, /for here in "zerofee-mainnet-vault"/);
  assert.match(sh, /#\s+vercel alias set <the checked preview URL> superapp\.zerofee\.si/);
  assert.doesNotMatch(code, /vercel alias/);
});

test("headers for real money: HSTS, no referrer, nosniff, permissions shut, assets immutable, the page never cached", () => {
  const cfg = JSON.parse(vercelJson());
  const all = Object.fromEntries(cfg.headers[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]));
  assert.match(all["Strict-Transport-Security"], /max-age=63072000; includeSubDomains/);
  assert.equal(all["Referrer-Policy"], "no-referrer");
  assert.equal(all["X-Content-Type-Options"], "nosniff");
  assert.match(all["Permissions-Policy"], /camera=\(\), microphone=\(\), geolocation=\(\)/);
  const cache = (src: string) => cfg.headers.find((h: { source: string }) => h.source === src).headers[0].value;
  assert.equal(cache("/assets/(.*)"), "public, max-age=31536000, immutable");
  for (const page of ["/", "/index.html", "/laptop"]) assert.equal(cache(page), "no-store", `${page} is never kept (QA)`);
});

test("the public build drops the gallery's AgentZero screen: its import sits behind the inlined public flag", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./gallery/Screens.tsx", import.meta.url), "utf8");
  const line = src.split("\n").find((l) => l.includes('import("../agentzero/AgentZeroChat.tsx")')) ?? "";
  assert.match(line, /import\.meta\.env\.VITE_ZEROFEE_PUBLIC === "1" \? \(\) => null :/);
  // control: the old ungated line would not pass
  assert.doesNotMatch('const FailedTurns = lazy(() => Promise.all([import("../agentzero/AgentZeroChat.tsx")', /import\.meta\.env\.VITE_ZEROFEE_PUBLIC === "1" \? \(\) => null :/);
});

test("audit pass 2, 6c: one source for every policy; the relay is in connect-src; the live check wants exactly this policy", async () => {
  const { wssHostsOf } = await import("./hosting.ts");
  const sh = readFileSync(fileURLToPath(new URL("../../ios/build-web.sh", import.meta.url)), "utf8");
  // the web's sockets are build-web.sh's line, read, never a second copy: a changed line changes the web's policy too
  assert.deepEqual([...WSS_HOSTS], wssHostsOf(sh));
  const moved = sh.replace(/^WSS_HOSTS="[^"]*"$/m, 'WSS_HOSTS="wss://a.example wss://b.example wss://c.example wss://d.example"');
  assert.deepEqual(wssHostsOf(moved), ["wss://a.example", "wss://b.example", "wss://c.example", "wss://d.example"]);
  assert.throws(() => wssHostsOf(sh.replace(/^WSS_HOSTS=.*$/m, "")), /no WSS_HOSTS line/);
  assert.throws(() => wssHostsOf('WSS_HOSTS="wss://a.example"\n'), /exactly four/);
  assert.throws(() => wssHostsOf('WSS_HOSTS="wss://a.example wss://b.example wss://c.example wss:"\n'), /exactly four/);
  // the relay is in the policy's connect-src (and the committed vercel.json's)
  const relay = relayOrigin()!;
  assert.ok(relay, "relay-url.txt names the relay");
  assert.ok(connectSrc().includes(relay), "connect-src has the relay");
  assert.ok(phoneConnectSrc().includes(relay), "the phone's connect-src has the relay");
  // promote-demo.sh compares the live header with hosting.ts's own policy, so the old demo's policy (no relay) can't pass
  const promote = readFileSync(fileURLToPath(new URL("../promote-demo.sh", import.meta.url)), "utf8");
  assert.match(promote, /node "\$repo\/apps\/web\/src\/hosting\.ts" --csp/);
  assert.match(promote, /\[ "\$got_csp" = "\$want_csp" \]/);
  assert.doesNotMatch(promote, /grep -qi '\^content-security-policy:'; then ok=1/, "a header that merely exists isn't enough");
});

test("QA: the Safe's own chains and the bridge are out of the public build; the web wallet's Solana, Robinhood Chain and NEAR (and Trade's BNB Chain) stay", () => {
  const web = connectSrc();
  for (const h of WEB_UNUSED) assert.ok(!web.includes(h), `${h} is out`);
  // control: each one is on the phone's list (so it is the filter that drops it, not a missing line)
  for (const h of WEB_UNUSED) assert.ok(phoneConnectSrc().includes(h), `${h} stays on the phone's own list`);
  const kept = [
    "https://rpc.mainnet.fastnear.com", "https://1click.chaindefuser.com", "https://solana-rpc.publicnode.com", "https://lite-api.jup.ag",
    "https://rpc.mainnet.chain.robinhood.com", "https://robinhood.drpc.org", "https://bsc-dataseed.bnbchain.org",
    "wss://solana-rpc.publicnode.com", "wss://robinhood-rpc.publicnode.com",
  ];
  for (const h of kept) assert.ok(web.includes(h), `${h} stays`);
  // the web wallet's chains are the ones kept: its nodes (core evm.ts) are in, no Safe chain's is
  const evm = readFileSync(fileURLToPath(new URL("../../../packages/core/src/evm.ts", import.meta.url)), "utf8");
  for (const chain of ["hood", "bsc"]) {
    const line = evm.split("\n").find((l) => l.startsWith(`  ${chain}: onCopy(`))!;
    for (const url of line.match(/https:\/\/[a-z0-9.-]+/g)!) assert.ok(web.includes(url), `${chain}: ${url}`);
  }
});

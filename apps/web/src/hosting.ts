// The public web app's hosting rules (apps/web/vercel.json), made from the same approved host list as the phone's CSP
// (apps/ios/connect-hosts.txt, audit NF-12), so the browser and the phone can fetch exactly the same places.
//
//   node apps/web/src/hosting.ts            writes apps/web/vercel.json (deploy-app.sh runs it; hosting.test.ts fails
//                                           when the committed file differs from what this makes)
//
// The public build is mainnet only, so testnet hosts are left out, and Anthropic's API (Agent's robot and AgentZero's
// own-key rule box); Agent's own model host (NEAR AI Cloud) joins only once Agent is live in the release, as Chat's
// sockets do with Chat; the Safe's own chains and the bridge stay out (WEB_UNUSED: the web wallet has no Safe). Otherwise
// its connect-src is the phone's, host for host (connectSrc).
// No third-party script, style, font or frame is allowed; images only from the app, data:, blob: and the relay (which
// serves every coin logo); the page can't be framed by anyone.
//
// This is a Node script, not part of the browser bundle, so apps/web/tsconfig.json leaves it out of the browser typecheck
// (which has no Node types); hosting.test.ts runs it under Node.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LIVE_IN_RELEASE } from "./shown-apps.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** build-web.sh's WSS_HOSTS line, the one place the phone's websocket origins are written (Security-approved; the
 *  extension's manifest-gen.ts reads the same line). Audit pass 2, 6c: this was a second copy of the list, so the web's
 *  policy could drift from the phone's; now every policy (phone, web, extension) reads connect-hosts.txt, relay-url.txt
 *  and this line, and nothing else. */
export function wssHostsOf(script: string): string[] {
  const m = /^WSS_HOSTS="([^"]*)"$/m.exec(script);
  if (!m) throw new Error("apps/ios/build-web.sh has no WSS_HOSTS line");
  const hosts = m[1]!.trim().split(/\s+/);
  if (hosts.length !== 4 || hosts.some((h) => !/^wss:\/\/[a-z0-9.-]+$/.test(h))) throw new Error("WSS_HOSTS must list exactly four wss origins");
  return hosts;
}
/** The websocket origins the phone may open, read from build-web.sh. */
export const WSS_HOSTS: readonly string[] = Object.freeze(wssHostsOf(readFileSync(here("../../ios/build-web.sh"), "utf8")));

/** Hosts the public (mainnet) build never calls: NEAR testnet's (and every other testnet), Anthropic's API (Agent's robot
 *  and AgentZero's own-key rule box, the phone's only), and the archival nodes (listed for the phone, named nowhere in
 *  the code today). Checked against the built bundle in deploy-app.sh's run. */
export const isLeftOut = (origin: string) => /\/\/([^/]*[.-])?test(net)?[.-]/.test(origin) || origin === "https://api.anthropic.com" || /^https:\/\/archival-rpc\./.test(origin);

/**
 * Hosts on the phone's list the public build never calls (QA's audit, 4 Nov): the web wallet has no Safe, so
 * the Safe's own chains (Ethereum, Base, Arbitrum, Gnosis: core evm.ts, gnosis-pay.ts) and the bridge's deposit
 * addresses (wallet apis.ts DEPOSIT_BRIDGE, the Safe's Receive and cross-chain Send) stay out. Its wallets are Solana,
 * Robinhood Chain and NEAR (web-wallet.ts WEB_WALLETS), with Trade's BNB Chain: all of those stay.
 */
export const WEB_UNUSED: readonly string[] = [
  "https://eth.drpc.org", "https://ethereum-rpc.publicnode.com",
  "https://mainnet.base.org", "https://base-rpc.publicnode.com",
  "https://arb1.arbitrum.io", "https://arbitrum.drpc.org",
  "https://rpc.gnosischain.com", "https://gnosis-rpc.publicnode.com",
  "https://bridge.chaindefuser.com",
  // (W7, 5 Nov: ZeroFee's mail host stays allowed: AgentZero's mailbox works in the web wallet too)
];

/** The approved https origins (apps/ios/connect-hosts.txt), without comments. */
export function approvedHosts(text = readFileSync(here("../../ios/connect-hosts.txt"), "utf8")): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

/** The relay's origin from its URL (apps/ios/relay-url.txt), or null when none is set. */
export function relayOrigin(url = readFileSync(here("../../ios/relay-url.txt"), "utf8").trim()): string | null {
  const m = /^(https:\/\/[a-z0-9.-]+)(\/|$)/.exec(url);
  return m ? m[1]! : null;
}

/** ZeroFee Chat's relays (D55): the approved wss origins (connect-hosts.txt's last section, packages/chat relays.ts). */
export const chatRelays = (hosts = approvedHosts()): string[] => hosts.filter((h) => h.startsWith("wss://"));

/** The public site's AgentZero (live there since 3 Nov) is the sample-money demo's chat (main.tsx: no real account
 *  on the public site): it calls no model, so Agent's model host stays out of the public policy even with Agent live. */
export const PUBLIC_AGENT_MODEL = false;
/** Agent's own model host (connect-hosts.txt: NEAR AI Cloud, release 10; packages/agent nearai.ts): only once Agent is live. */
export const AGENT_HOSTS: readonly string[] = ["https://cloud-api.near.ai"];

/**
 * The phone's connect-src, as apps/ios/build-web.sh writes it: the app, the relay's origin, every approved origin
 * (connect-hosts.txt, testnet and Chat's sockets included) and the four price sockets (WSS_HOSTS).
 */
export function phoneConnectSrc(hosts = approvedHosts(), relay = relayOrigin()): string[] {
  return ["'self'", ...(relay ? [relay] : []), ...hosts, ...WSS_HOSTS];
}

/**
 * connect-src for the public build (product decision, 3 Nov: the hosted web app is a first-class home for a real account, D87):
 * exactly the phone's, less what the public build never calls (testnet, Anthropic's API, the archival nodes:
 * isLeftOut; the Safe's own chains and the bridge: WEB_UNUSED), less Chat's relay sockets until Chat is live in the release and Agent's model host until Agent is (`live`,
 * LIVE_IN_RELEASE: a host a Coming soon screen never calls stays out, since every reachable host is a way out for
 * anything on the page). So a real account here reads its prices, the relay and the chains' sockets as the phone does,
 * and nothing the phone doesn't. (Until 3 Nov this was the sample demo's two Solana nodes only, which left a real
 * account's market dead on the web.)
 */
// `withSafe`: the Chrome extension (manifest-gen.ts) holds a Safe, so its own chains and the bridge stay in its list; only
// the public website, which has no Safe, drops WEB_UNUSED
export function connectSrc(hosts = approvedHosts(), relay = relayOrigin(), live: ReadonlySet<string> = LIVE_IN_RELEASE, agentModel = PUBLIC_AGENT_MODEL, withSafe = false): string[] {
  const relays = new Set(chatRelays(hosts));
  return phoneConnectSrc(hosts, relay).filter((h) => h === "'self'" || (!isLeftOut(h) && (withSafe || !WEB_UNUSED.includes(h)) && (!relays.has(h) || live.has("chat")) && (!AGENT_HOSTS.includes(h) || (live.has("agent") && agentModel))));
}

export function csp(hosts = approvedHosts(), relay = relayOrigin()): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    `connect-src ${connectSrc(hosts, relay).join(" ")}`,
    // coin logos: the relay's logo route (Trade's market asks it for every coin's picture); no other image host
    `img-src 'self' data: blob:${relay ? ` ${relay}` : ""}`,
    // React's style props are inline styles; no inline or outside script is ever allowed.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** The whole vercel.json: security headers on every path, never-changing assets cached for a year, the page itself never
 *  kept (no-store, QA: a stale page could run an old wallet's code after a fix ships). */
export function vercelConfig(hosts = approvedHosts(), relay = relayOrigin()) {
  return {
    cleanUrls: false,
    trailingSlash: false,
    // D54: the real app's second-device page is the same bundle at /laptop (mode.ts LAPTOP_PATH)
    // c5-az: AgentZero's pay link opens the app at /pay
    rewrites: [{ source: "/laptop", destination: "/index.html" }, { source: "/pay", destination: "/index.html" }],
    headers: [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp(hosts, relay) },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          // Clipboard only for this page (Paste and Copy taps, D33); nothing else a page can ask for.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), browsing-topics=(), clipboard-read=(self), clipboard-write=(self)" },
        ],
      },
      { source: "/assets/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/", headers: [{ key: "Cache-Control", value: "no-store" }] },
      { source: "/laptop", headers: [{ key: "Cache-Control", value: "no-store" }] },
      { source: "/index.html", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ],
  };
}

/** The laptop page's own origin (laptop.zerofee.si, QA's MUST, 5 Nov): what its bundle reaches and nothing more.
 *  The NEAR mainnet nodes and FastNEAR's key and tx indexes only (the second-device core reads the account and sends its
 *  yes there); no relay, no price or swap host, no image host but itself; worker-src 'none', so no worker and no
 *  service worker can ever be registered. */
// core's NEAR_MAINNET_NODES, host for host (hosting-laptop.test.ts holds them equal; this file stays free of the core)
export const LAPTOP_CONNECT = ["https://rpc.mainnet.fastnear.com", "https://near.drpc.org", "https://rpc.intea.rs", "https://api.fastnear.com", "https://tx.main.fastnear.com"];
export function laptopCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    `connect-src 'self' ${LAPTOP_CONNECT.join(" ")}`,
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "media-src 'self'",
    "worker-src 'none'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** laptop.zerofee.si's vercel.json: the app's security headers with the laptop's CSP, the page itself never kept. */
export function laptopVercelConfig() {
  const app = vercelConfig();
  const all = app.headers[0]!.headers.map((h) => (h.key === "Content-Security-Policy" ? { key: h.key, value: laptopCsp() } : h));
  return {
    cleanUrls: false,
    trailingSlash: false,
    headers: [
      { source: "/(.*)", headers: all },
      { source: "/assets/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/", headers: [{ key: "Cache-Control", value: "no-store" }] },
      { source: "/index.html", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ],
  };
}

export const vercelJson = () => `${JSON.stringify(vercelConfig(), null, 2)}\n`;

/** Self-host from a phone (product decision, 5 Nov): the repo root's vercel.json, so a fork imported into Vercel with NO setting
 *  typed (no Root Directory, no env var) builds the web wallet the way deploy-app.sh does, minus the relay: ours only
 *  answers its own origins (apps/quotes ALLOWED_ORIGINS), so a stranger's copy names none until they add their own
 *  (VITE_ZEROFEE_RELAY in Vercel's settings). The same headers as ours. self-host-vercel.test.ts pins it. */
export const SELF_HOST_BUILD = {
  framework: null,
  installCommand: "npm ci --ignore-scripts --no-audit --no-fund",
  buildCommand: "VITE_ZEROFEE_PUBLIC=1 VITE_HOME_PROOF=1 VITE_WEB_TRADE=1 npm run -s -w @zerofee/web build",
  outputDirectory: "apps/web/dist",
} as const;
export const selfHostVercelConfig = () => ({ ...SELF_HOST_BUILD, ...vercelConfig() });
export const selfHostVercelJson = () => `${JSON.stringify(selfHostVercelConfig(), null, 2)}\n`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // --csp: print the policy only (promote-demo.sh compares the live site's header with it, so a stale deploy shows)
  if (process.argv[2] === "--csp") process.stdout.write(`${csp()}\n`);
  else if (process.argv[2] === "--laptop") process.stdout.write(`${JSON.stringify(laptopVercelConfig(), null, 2)}\n`);
  else {
    writeFileSync(here("../vercel.json"), vercelJson());
    writeFileSync(here("../../../vercel.json"), selfHostVercelJson());
    console.log("apps/web/vercel.json and the repo root's vercel.json (self-host) written");
  }
}

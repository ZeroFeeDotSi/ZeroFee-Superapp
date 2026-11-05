import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { SITE_TITLE } from "./src/demo-line.ts";
import { LAPTOP_BOOT_CSS, laptopBootHtml } from "./src/unlock/laptop-lock-words.ts";

/** In the public build these modules are replaced by src/release-stubs.tsx: code no page of that build shows ships none
 *  of its own (the Extension and Earn apps, the old Agent screen and its robot with the Anthropic SDK, the old Browser
 *  page, Pay's partner windows, which are the phone's own). Every app the build shows is its real code (publicApps). */
const NOT_IN_RELEASE = [
  "@zerofee/extension-app/app/ExtensionApp.tsx",
  "@zerofee/earn/app/EarnApp.tsx",
  "@zerofee/agent/app/AgentApp.tsx",
  "@zerofee/browser/app/BrowserApp.tsx",
  "@zerofee/agent/robot/think",
  "@zerofee/pay/partners/recipes",
];
const stubs = fileURLToPath(new URL("./src/release-stubs.tsx", import.meta.url));
/** The public build's passkey stand-in, and its empty account contract (the web wallet has no Safe). */
const noPasskey = fileURLToPath(new URL("./src/unlock/passkey-none.ts", import.meta.url));
const noVerify = fileURLToPath(new URL("./src/unlock/verify-none.ts", import.meta.url));
const NO_POLICY = "\0zerofee-no-account-policy";
/** base58-js, with the same answers in near-linear time (packages/core/src/base58-fast.ts): an ML-DSA-65 key's 1,952
 *  bytes took a 200 ms task at a phone's speed in the library's quadratic code at every unlock (speed, 2 Nov). */
const BASE58 = { find: /^base58-js$/, replacement: fileURLToPath(new URL("../../packages/core/src/base58-fast.ts", import.meta.url)) };
const exact = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`);

/** The second device's site's browser tab (H13). */
export const SECOND_DEVICE_TITLE = "ZeroFee · Second device";
/**
 * Modules the second device's site must never contain (H13): the app and its entry, the sample-money demo and its mock,
 * the account core (it makes and funds accounts), the money apps, and the 24-words screens. The second-device build
 * fails if any of them is reached from its entry (src/second-device.tsx), so the page that makes a real key can only
 * say yes or no.
 */
export const SECOND_DEVICE_NEVER: RegExp[] = [
  /\/apps\/web\/src\/(main|full-app|App)\.tsx$/,
  /\/apps\/web\/src\/(gallery|screens\/(Onboarding|Funding|AnyCoin|Recovery|FirstRun))\b/,
  /\/packages\/shell-api\/src\/MockBridge\.ts$/,
  /\/packages\/core\/src\/(demo-core|float|oneclick-account|hot-keys|subwallets|private-pocket|pocket-moves|float-moves|recovery-words|evm|solana)\.ts$/,
  /\/packages\/(pay|trade|wallet|agent|earn|browser|extension-app|chat)\//,
];

/** The design package's network logos that ship as files, not inline (every one but Home's own coins'). */
const LOGO_AS_FILE = /\/packages\/design\/src\/logos\/(?!(?:near|sol|eth|hood|bnb|usdc|usdt|base|arb)\.svg$)[^/]+\.svg$/;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const publicBuild = (process.env.VITE_ZEROFEE_PUBLIC ?? env.VITE_ZEROFEE_PUBLIC) === "1";
  const secondDevice = (process.env.VITE_ZEROFEE_TARGET ?? env.VITE_ZEROFEE_TARGET) === "second-device";
  if (publicBuild && secondDevice) throw new Error("VITE_ZEROFEE_PUBLIC=1 and VITE_ZEROFEE_TARGET=second-device are two different sites: build one at a time");
  // The mainnet copy (VITE_FORK=1, packages/core/src/fork.ts) is a local build on this Mac only: never beside a
  // release target (the public site, the Chrome extension, the second device). The release scripts unset it too.
  const fork = (process.env.VITE_FORK ?? env.VITE_FORK) === "1";
  const target = process.env.VITE_ZEROFEE_TARGET ?? env.VITE_ZEROFEE_TARGET;
  if (fork && (publicBuild || target)) throw new Error("VITE_FORK=1 is the mainnet copy's local build: never with VITE_ZEROFEE_PUBLIC or VITE_ZEROFEE_TARGET");
  return {
    plugins: [
      react(),
      // The second device's site: its own entry in place of main.tsx, its own tab name, and nothing else in its bundle.
      {
        name: "zerofee-second-device",
        transformIndexHtml: {
          order: "pre" as const,
          handler(html: string) {
            if (!secondDevice) return html;
            // its #root says what the page is before the script runs, and what failed if it never does (laptopBootHtml)
            const out = html.replace('src="/src/main.tsx"', 'src="/src/second-device.tsx"').replace("<title>ZeroFee</title>", `<title>${SECOND_DEVICE_TITLE}</title><style>${LAPTOP_BOOT_CSS}</style>`).replace('<div id="root"></div>', laptopBootHtml());
            if (!out.includes('src="/src/second-device.tsx"') || !out.includes(SECOND_DEVICE_TITLE) || !out.includes('class="zf-boot"')) throw new Error("index.html changed: the second-device build can't swap its entry");
            return out;
          },
        },
        buildEnd(this: { getModuleIds: () => IterableIterator<string>; error: (m: string) => never }) {
          if (!secondDevice) return;
          const ids = [...this.getModuleIds()];
          const bad = ids.filter((id) => SECOND_DEVICE_NEVER.some((re) => re.test(id)));
          if (bad.length) this.error(`the second device's site can't contain: ${bad.join(", ")}`);
          if (!ids.some((id) => /\/packages\/core\/src\/second-device\.ts$/.test(id))) this.error("the second device's own core isn't in its build");
        },
      },
      // Pay's cards, imported by a relative path from Pay's runtime (which Wallet's Send reuses): the stand-in too.
      {
        name: "zerofee-release-stubs",
        enforce: "pre" as const,
        resolveId(source: string, importer?: string) {
          if (publicBuild && /\/partners\/cards(\.ts)?$/.test(source) && importer && /\/packages\/pay\/src\//.test(importer)) return stubs;
          // The web wallet (product decision, 4 Nov) is in the public build, with no Safe: no passkey (its lock is a password;
          // passkey-none.ts) and no account contract (its .wasm never ships; the core refuses every Safe method there).
          if (publicBuild && target !== "extension" && /(^|\/)passkey(\.ts)?$/.test(source) && importer && /\/apps\/web\/src\//.test(importer)) return noPasskey;
          if (publicBuild && target !== "extension" && /(^|\/)unlock\/verify(\.ts)?$/.test(source) && importer && /\/apps\/web\/src\//.test(importer)) return noVerify;
          if (publicBuild && target !== "extension" && /account_policy[^/]*\.wasm\?url$/.test(source)) return NO_POLICY;
          return null;
        },
        load(id: string) {
          // no contract to load: a Safe method never gets this far in the web wallet (security.web.no-safe)
          return id === NO_POLICY ? 'export default "";' : null;
        },
      },
      // The public site's browser tab says what it is (independent grade 30 Oct, item 11): the tab is outside the phone's
      // screen, so the site's name goes there (main.tsx adds " · Sim" in Sim), never inside the app.
      {
        name: "zerofee-public-title",
        transformIndexHtml(html: string) {
          return publicBuild ? html.replace("<title>ZeroFee</title>", `<title>${SITE_TITLE}</title>`) : html;
        },
      },
    ],
    resolve: { alias: [BASE58, ...(publicBuild ? NOT_IN_RELEASE.map((m) => ({ find: exact(m), replacement: stubs })) : [])] },
    // Never ship source maps (a public build is real money; the code is published, the maps aren't needed).
    // Speed (D160 job, Home's first-load budget): a network's logo Home's first paint never shows (Cardano, Starknet,
    // X Layer…) is its own small file, fetched when a list shows it, never base64 inside Home's first JS. Home's own
    // coins' logos stay inline (NEAR, SOL, ETH, ETH (RH), BNB, USDC, USDT, Base, Arbitrum): its first paint is unchanged.
    build: { sourcemap: false, assetsInlineLimit: (file: string) => (LOGO_AS_FILE.test(file) ? false : undefined), ...(secondDevice ? { outDir: "dist-second-device" } : {}) },
  };
});

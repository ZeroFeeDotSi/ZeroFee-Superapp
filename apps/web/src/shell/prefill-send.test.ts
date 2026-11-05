// AgentZero's Send, filled in (UI's mainnet rehearsal, 3 Nov): the dollars asked are exactly what the sheet says, never
// the wallet's whole balance; a network the ask names is picked (and shown, the look-alike stop still on); a 64-hex NEAR
// account is taken as typed. Mounted as the shell mounts it: the agent app opens Home's Send sheet over itself.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; press: (l: RegExp) => void };
let AppHost: FunctionComponent<Record<string, unknown>>;
let useShell: () => { openMoney: (ask: unknown) => void };
let mockBridge: () => Bridge;
let forApps: (b: Bridge, app: string) => Bridge;
let sheetsLoaded: () => Promise<unknown>;

before(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
  const fake = fileURLToPath(new URL("../testing/fake-react.ts", import.meta.url));
  // D125: the test build, where Home's Send is on
  process.env.VITE_HOME_PROOF = "1";
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "silent",
    resolve: { alias: [{ find: /^react$/, replacement: fake }] },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  runtime = (await server.ssrLoadModule(fake)) as typeof runtime;
  ({ AppHost } = await server.ssrLoadModule("./shell/AppHost.tsx"));
  ({ useShell } = await server.ssrLoadModule("@zerofee/shell-api/AppFrame.tsx"));
  ({ sheetsLoaded } = await server.ssrLoadModule("@zerofee/wallet/app/money/MoneyHost.tsx"));
  const { createMockBridge } = await server.ssrLoadModule("@zerofee/shell-api/MockBridge.ts");
  // money in the private balance (the pocket): a Safe coin Send can pay now, so the form is up before the wallets read
  mockBridge = () => createMockBridge({ latencyMs: 0, settleMs: 0, hiddenStart: { usdc: "25", near: "2" } });
  forApps = (await server.ssrLoadModule("@zerofee/core/bridge")).forApps;
});
after(async () => {
  runtime?.unmount();
  await server?.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 6_000).unref();
});

/** The SOL wallet holding $4.52, its row answered only after the Safe's coins (the order the rehearsal saw). */
function bridgeWithSolWallet(): { bridge: Bridge; release: () => void } {
  const inner = mockBridge();
  const status = { loaded: true, totalUsd: "4.52", cashUsd: "0", coinsUsd: "4.52", capUsd: "500", roomUsd: "495", ready: true, onItsWay: [], firstTopUp: false,
    networks: [{ network: "sol", name: "Solana", cashUsd: "4.52", coinsUsd: "0", readyUsd: "4.52", nativeAmount: "0.0322" }] };
  let release!: () => void;
  const later = new Promise<void>((r) => (release = r));
  return {
    release,
    bridge: {
      call: ((m: string, p?: Record<string, unknown>) => (m === "spending.status" ? later.then(() => ({ ok: status })) : inner.call(m, p))) as Bridge["call"],
      on: (e, h) => inner.on(e, h),
    },
  };
}

/** Settle until `ok` holds (each turn lets the form's own 300 ms lookup and the reads land); fails after many turns. */
async function until(ok: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await runtime.settle();
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`never: ${what}\n${runtime.text()}`);
}

async function openFilled(ask: Record<string, unknown>): Promise<void> {
  const { bridge, release } = bridgeWithSolWallet();
  const agent = () => createElement(function AgentPage() {
    const shell = useShell();
    return createElement("button", { onClick: () => shell.openMoney({ kind: "send", ...ask }) }, "AGENT-SEND");
  });
  const apps = [
    { id: "agent", name: "AgentZero", line: "", bridge: forApps(bridge, "agent"), render: agent },
    { id: "wallet", name: "Home", line: "", bridge: forApps(bridge, "wallet"), render: () => createElement("p", null, "HOME") },
  ];
  await runtime.mount(createElement(AppHost, { apps, onMenu: () => {}, shellBridge: bridge, start: { id: "agent" } }), { limit: 80 });
  runtime.press(/^AGENT-SEND$/);
  await sheetsLoaded();
  // the Safe's coins first (the private balance's USDC); the SOL wallet's row once the form is already up (the rehearsal's order)
  await until(() => /\bFrom\b/.test(runtime.text()) && /\bSend\b/.test(runtime.text()), "the Send form");
  release();
}

const SOL_PAYEE = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const EVM_PAYEE = "0x7D06e272b5305a4b9D40e872C7950D3437547e3D";
const IMPLICIT = "a".repeat(10) + "0123456789abcdef".repeat(3) + "b".repeat(6);

for (const [name, to] of [["a 0x address", EVM_PAYEE], ["a Solana address", SOL_PAYEE], ["a NEAR name", "alice.near"], ["a 64-hex NEAR account", IMPLICIT]] as const) {
  test(`filled in, ${name}: $0.50 from the SOL wallet is $0.50, never its whole $4.52 (control: Max is the whole balance)`, async () => {
    try {
      await openFilled({ to, usd: "0.50", wallet: "sol" });
      await until(() => /your SOL wallet\n[\d.]+ SOL · \$/.test(runtime.text()) && /First payment|alice\.near/.test(runtime.text()) && /Send \$0\.50/.test(runtime.text()), "Send $0.50 from the SOL wallet, the address read");
      const shown = runtime.text();
      assert.match(shown, /AgentZero filled this in\. Check it before you approve\./);
      assert.doesNotMatch(shown, /Send \$4\.\d\d/, "never the whole balance ($4.38 can go)");
      assert.doesNotMatch(shown, /Paste an address or a name\./, "the address is taken as typed");
      if (!to.startsWith("0x")) assert.match(shown, to === SOL_PAYEE ? /Public on Solana\./ : /Public on NEAR\.[\s\S]*Lands as wNEAR/, "the copy review's re-walk: the core sheet's Public line first, the coin after");
      assert.doesNotMatch(shown, /Lands as SOL on Solana\./, "never the old network line");
      if (!to.startsWith("0x") && to !== SOL_PAYEE) assert.match(shown, /Lands as wNEAR, the NEAR Intents form of NEAR\./, "the sample bridge's NEAR accounts hold a NEAR Intents balance: paid there, as wNEAR, said so (send-reach INTENTS_LINE; a plain NEAR account reads \"Lands as NEAR.\", send-reach.test.ts)");
      runtime.press(/^Max$/);
      await until(() => /Send \$4\.\d\d/.test(runtime.text()), "control: Max is all the wallet can send");
    } finally {
      runtime.unmount();
    }
  });
}

test("filled in with its network (chain: hood): ETH (RH) is picked and shown, no \"Pick the network first.\" (control: without one, a new 0x address asks)", async () => {
  try {
    await openFilled({ to: EVM_PAYEE, usd: "0.50", wallet: "sol", chain: "hood" });
    await until(() => /Public on Robinhood Chain\./.test(runtime.text()), "the network picked");
    const shown = runtime.text();
    assert.match(shown, /Which network\?/, "the choice is still on screen to check");
    assert.doesNotMatch(shown, /Pick the network first\./);
    assert.match(shown, /First payment/, "the address's own checks still run");
  } finally {
    runtime.unmount();
  }
  try {
    await openFilled({ to: EVM_PAYEE, usd: "0.50", wallet: "sol" });
    await until(() => /Pick the network first\./.test(runtime.text()), "control: a new 0x address asks which network");
  } finally {
    runtime.unmount();
  }
  // the pick only picks: the look-alike stop and every other check run on the address as typed, the same as without it
  const form = readFileSync(new URL("../../../../packages/wallet/src/app/money/SendForm.tsx", import.meta.url), "utf8");
  const pick = form.slice(form.indexOf("const chainFilled"), form.indexOf("}, [who]);"));
  assert.match(pick, /if \(\(networks as string\[\]\)\.includes\(filled\.chain\)\) setPicked\(filled\.chain as SendToChain\);/, "only a network this address can go to");
  assert.doesNotMatch(pick, /setWho|setLine|lookalike|setExact|onSend/, "nothing else is set by it");
  assert.match(form, /const lookalike = who \? lookalikeOf\(target, history\) : null;/, "control: the look-alike stop reads the address, whatever the network");
  // dollars typed stay dollars when the source changes under them (the rehearsal's $4.52)
  assert.match(form, /if \(typed !== null && perCoin !== null\) return type\(typed\);/);
});

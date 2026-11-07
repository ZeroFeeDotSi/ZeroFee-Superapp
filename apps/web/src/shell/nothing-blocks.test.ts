// Nothing blocks (Job 1, criterion 5; B21) and the copy on the spine's screens (criterion 7; audit D7).
// - A read that fails is one quiet line with Retry over what Home knew last, never the Problem screen: a test's
//   "The network is slow, so we couldn't read your account in time. Nothing was sent." while nothing was sent (B21).
// - Every string the spine put on screen reads at grade 5 or under (Flesch-Kincaid, the audit's D7 measure) and passes
//   the voice guard's grade A or B (tools/copy/voice.ts).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";
import { grade } from "../../../../tools/copy/voice.ts";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; unmount: () => void; text: () => string };
let ShellContext: { Provider: unknown };
let walletRoot: FunctionComponent;
let mockBridge: () => Bridge;
let forApps: (b: Bridge, app: string) => Bridge;

before(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  const fake = fileURLToPath(new URL("../testing/fake-react.ts", import.meta.url));
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
  ShellContext = (await server.ssrLoadModule("@zerofee/shell-api/AppFrame.tsx")).ShellContext;
  walletRoot = (await server.ssrLoadModule("@zerofee/wallet/app/WalletApp.tsx")).walletApp.Root;
  // Home's readers (home-keep.ts) load at boot in the app; here, before the first mount
  await server.ssrLoadModule("@zerofee/wallet/app/home-keep.ts");
  const { createMockBridge } = await server.ssrLoadModule("@zerofee/shell-api/MockBridge.ts");
  mockBridge = () => createMockBridge({ latencyMs: 0, settleMs: 0 });
  forApps = (await server.ssrLoadModule("@zerofee/core/bridge")).forApps;
  // Home loads its read lines after its first paint (read-lines.ts, the speed budget): warm, so the line lands in the mount
  await server.ssrLoadModule("@zerofee/wallet/app/screens/read-lines.ts");
});
after(async () => server?.close());

const SLOW = { code: "security.read.slow", whatHappened: "NEAR's network is slow right now. Your account didn't load in time.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" } };

async function homeWith(readFails: boolean) {
  const inner = forApps(mockBridge(), "wallet");
  // a read of the Safe's coins that times out; what was read last is on this device
  const bridge: Bridge = {
    call: ((m: string, p?: Record<string, unknown>) => (readFails && m === "ledger.balances" ? Promise.resolve({ problem: SLOW }) : inner.call(m, p))) as Bridge["call"],
    on: (e, h) => inner.on(e, h),
  };
  const problems: unknown[] = [];
  const ctx = { bridge, openApp: () => {}, openMoney: () => {}, showProblem: async (p: unknown) => (problems.push(p), { kind: "nothing", label: "OK" }), showWaiting: () => {}, openSwitcher: () => {}, openMenu: () => {}, active: true, index: 0, count: 1 };
  await runtime.mount(createElement(ShellContext.Provider as never, { value: ctx }, createElement(walletRoot)), { limit: 60 });
  const shown = runtime.text();
  runtime.unmount();
  return { shown, problems };
}

test("a read that fails is Home's one quiet line with Retry, never the Problem screen (B21)", async () => {
  const { shown, problems } = await homeWith(true);
  // nothing read yet and nothing kept: it names NEAR and never says "as last read" (the Home plan §3)
  assert.match(shown, /NEAR didn't answer, so your Safe shows when it does\. Your money is still in it\.\nRetry/);
  assert.deepEqual(problems, [], "no Problem screen for a read");
  assert.doesNotMatch(shown, /Nothing was sent/);
  assert.match(shown, /Add\nSend\nSwap\nMove/, "the rest of Home is there: its four actions");
});

test("control: with the read answering, no line", async () => {
  const { shown } = await homeWith(false);
  assert.doesNotMatch(shown, /couldn't read your money/);
  assert.match(shown, /^Safe\n\$[\d,]+\.\d\d$/m, "Home is drawn: the Safe and its figure (D129)");
});

/** Flesch-Kincaid grade, the audit's D7 measure. */
export function fkGrade(text: string): number {
  const sentences = Math.max(1, text.split(/[.?!]+/).filter((s) => s.trim()).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return 0;
  const syll = (w: string) => {
    const s = w.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, "");
    return Math.max(1, (s.match(/[aeiouy]+/g) ?? []).length);
  };
  const syllables = words.reduce((n, w) => n + syll(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
}

/** Every string the spine (Job 1) put on screen: the tray, the thread, Home's rows, the money sheet, the key line. */
const SPINE = [
  "Hold and drag. The top five are your bottom row.", "Chat took Trade's place in your bottom row.", "Trade left your bottom row. Chat is in it now.", "All apps",
  "Words", "Money in", "Protected", "Second device", "Done",
  "Write down your backup words", "Check your backup words", "Waiting for your SOL", "Waiting for your SOL", "Your SOL is here", "Some NEAR arrived, not all", "Opening your account",
  "Choose what big payments need", "Add a second device", "Add money to your Safe",
  "Your account", "Protection", "What big payments need", "Devices", "Only this phone", "Recovery", "Backup words", "A new device is waiting", "Activity", "What you did", "Details", "Your address on each network",
  "Your key is in this phone", "Big payments can need its yes too.", "Add my laptop", "Add a guardian", "Be someone's guardian",
  "From your Safe to Spending", "That fills Spending.", "Getting it ready…", "Sent $5.00 (5.00 USDC) to kiosk.near", "$327.46 is on its way to Spending.", "$500.00 is on its way to your Safe.",
  "NEAR didn't answer, so this is your money as last read. It's all still in your Safe.", "Retry", "Reading your activity…", "Anything more stays in your Safe.", "Show all 5 coins",
];

test("the spine's words read at grade 5 or under, and the voice guard grades each A or B (criterion 7, audit D7)", () => {
  // The audit measured strings of 3+ words; a 1-3 word label is a name (VOICE section 2), where the formula says nothing.
  const hard = SPINE.filter((s) => s.split(/\s+/).length > 3).map((s) => ({ s, fk: fkGrade(s) })).filter((x) => x.fk > 5);
  assert.deepEqual(hard.map((x) => `${x.s} (grade ${x.fk.toFixed(1)})`), []);
  const graded = SPINE.map((s) => ({ s, g: grade("spine", s) })).filter((x) => x.g.grade !== "A" && x.g.grade !== "B");
  assert.deepEqual(graded.map((x) => `${x.s}: ${x.g.grade} ${x.g.problems.join("; ")}`), []);
});

test("control: the grade measure catches a sentence a 5-year-old can't read", () => {
  assert.ok(fkGrade("Starting it cancels every payment or change still waiting, unless a second device old enough to count said yes to it.") > 5);
});

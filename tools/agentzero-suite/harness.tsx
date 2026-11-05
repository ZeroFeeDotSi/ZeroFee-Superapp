// AgentZero's 100-prompt suite: the page (served by run.mjs's own vite, never part of the app's build). It mounts the
// real AgentZero tab (agentZeroChatApp.Root → LiveChat → useChatTurn → chatTurn, the own-key path to the real
// api.anthropic.com) inside a shell context, at 390x844, on the sample demo's bridge routed as ?demo routes it (the demo's
// MockBridge options, Earn's and Trade's readers, and Spending's engine, started), WITH its sample history (the demo's
// Received rows: $97.10 came in), so it reads like a funded account. The page's URL seeds the state per prompt or flow:
//   ?fresh        a brand-new account: no history (as ?demo starts)
//   ?float=empty  the SOL, ETH (RH) and BNB wallets hold nothing
//   ?nosafe       the Safe's private balance starts empty
//   ?fault=1click the swap service is down; ?fault=<service>:521|429|timeout one service down (shell-api faults.ts)
//   - The key: the stand-in keychain (device.secret.*) in this page's storage. run.mjs puts it there only through the
//     Paste tap's stand-in clipboard (window.__clip), read from its file at run time; this file never holds it.
//   - Money: the shell's own money sheet. openMoney renders Wallet's MoneyHost on Wallet's own sample bridge, as the shell
//     does (AppHost), and every ask is recorded in window.__money for the suite's checks. openApp is recorded too.
//   - Trade: openTrade goes through the shell's own door (shell-api trade-ask.ts shellAsk, as AppHost calls it, from
//     "agent", on screen), recorded in window.__trade. Trade's page isn't mounted here: a stand-in takes the ask as Trade
//     does, holds it on its way, and ends it after ?tradeMs (default 3 s) with went and a landedMs, so AgentZero's card
//     and the shell's "still going" rule are walked. No coin is bought: Trade, its sheets and its money never run here.
//   - Every approval the sample bridge raises is recorded and DECLINED: nothing is ever approved, nothing moves.
//     ?approve=1 answers them yes instead, on SAMPLE money only (this page never holds real money): a plan's walk can
//     see a move go and the next step open (phone test, 3 Nov: AgentZero forgot step 2).
//   - The sample account refuses every real move ("This is a test account."), so for a plan's walk two stand-ins:
//     window.__sheetWent() ends the open money sheet as an approved one does ({went: true}), and window.__fund(chain,
//     usd) makes AgentZero's reads see that much cash in that wallet from then on (its money arriving). Sample only.
//   - window.__tab(false) takes the AgentZero tab off screen (as leaving it for another app does) and __tab(true) puts it
//     back; the shell's money sheet stays, as the shell's own does.
//   - Each prompt loads the page fresh: a new sample state (no persistence), so no chat, memory or job carries over.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@zerofee/design/tokens.css";
import "@zerofee/design/ui.css";
import "../../apps/web/src/app.css";
import { applyTheme, savedTheme } from "../../apps/web/src/shell/theme.ts";
import { ShellContext } from "@zerofee/shell-api/shell-context.ts";
import type { MoneyAsk, MoneyEnd } from "@zerofee/shell-api/money.ts";
import { shellAsk, tradeAsks, type TradeAsk, type TradeEnd } from "@zerofee/shell-api/trade-ask.ts";
import { agentZeroChatApp } from "../../apps/web/src/agentzero/AgentZeroChatApp.tsx";
import { MoneyHost } from "@zerofee/wallet/app/money/MoneyHost.tsx";
import { forApps, routeBridge, type Bridge } from "@zerofee/core/bridge";
import { createEarnReader } from "@zerofee/earn/reader.ts";
import { createTradeReader } from "@zerofee/trade/reader.ts";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { faultFromQuery, faultedBridge } from "@zerofee/shell-api/faults.ts";
import { hostSpending } from "@zerofee/trade/spending-host.ts";
import { SAMPLE_OPENING } from "@zerofee/trade/demo-engine.ts";
import { LIMITS } from "@zerofee/agent/chat/wait";

/** --faults: the page's own Anthropic and relay. The person's words pick what Claude does: "#tool <name> <json>" asks
 *  that tool (then "OK." after its result), "#claude hang|drop|cut|529" never answers, goes silent after a few words,
 *  ends mid-answer, or is overloaded; anything else is "OK.". `net` faults every other host (the relay, the market):
 *  hang, slow (20 s), throw, garbage, 404, 500. Every wait honours its abort. */
function installFakeNet(net: string) {
  const real = window.fetch.bind(window);
  const enc = new TextEncoder();
  const sse = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const start = sse("message_start", { message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  const textHead = start + sse("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Let me " } });
  const text = (t: string) => start + sse("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } }) + sse("content_block_stop", { index: 0 }) + sse("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }) + sse("message_stop", {});
  const tool = (name: string, input: unknown) => start + sse("content_block_start", { index: 0, content_block: { type: "tool_use", id: `tu_${Date.now()}`, name, input: {} } }) + sse("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }) + sse("content_block_stop", { index: 0 }) + sse("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 1 } }) + sse("message_stop", {});
  const cors = { "access-control-allow-origin": "*" };
  const aborted = (signal?: AbortSignal | null) => new Promise<never>((_, no) => signal?.addEventListener("abort", () => no(new DOMException("aborted", "AbortError"))));
  const body = (head: string, then: "stall" | "cut", signal?: AbortSignal | null) => new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(head));
      if (then === "cut") return c.close();
      signal?.addEventListener("abort", () => { try { c.error(new DOMException("aborted", "AbortError")); } catch { /* closed */ } });
    },
  });
  const ev = (s: string) => new Response(s, { status: 200, headers: { ...cors, "content-type": "text/event-stream" } });
  window.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const signal = init.signal ?? (input instanceof Request ? input.signal : null);
    const anthropic = url.startsWith("https://api.anthropic.com/");
    const chat = /\/v1\/messages|\/v0\/agentzero\/chat/.test(url);
    if (anthropic && !chat) return new Response(JSON.stringify({ data: [], has_more: false }), { status: 200, headers: { ...cors, "content-type": "application/json" } });
    // the relay's own chat (the free reading) faulted as every other host is, when ?net says so
    if (chat && !anthropic && net) return relayFault(net, signal);
    if (chat) {
      const b = JSON.parse(String(init.body ?? (input instanceof Request ? await input.clone().text() : "{}"))) as { messages: { role: string; content: unknown }[] };
      const last = b.messages.at(-1)!;
      // the person's words: a string, or text blocks (a cache mark on the newest turn); a tool's result is a read's answer
      const blocks = Array.isArray(last.content) ? (last.content as { type?: string; text?: string }[]) : [];
      if (typeof last.content !== "string" && (!blocks.length || blocks.some((x) => x.type === "tool_result"))) return ev(text("OK, read."));
      const words = typeof last.content === "string" ? last.content : blocks.filter((x) => x.type === "text").map((x) => x.text ?? "").join("\n");
      const t = /#tool (\w+)(?: (\{.*\}))?\s*$/.exec(words);
      if (t) return ev(tool(t[1]!, t[2] ? JSON.parse(t[2]) : {}));
      if (/^#claude hang/.test(words)) return aborted(signal);
      if (/^#claude drop/.test(words)) return new Response(body(textHead, "stall", signal), { status: 200, headers: { ...cors, "content-type": "text/event-stream" } });
      if (/^#claude cut/.test(words)) return new Response(body(textHead, "cut", signal), { status: 200, headers: { ...cors, "content-type": "text/event-stream" } });
      if (/^#claude 529/.test(words)) return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529, headers: { ...cors, "content-type": "application/json" } });
      return ev(text("OK."));
    }
    if (!/^https?:\/\//.test(url) || url.startsWith(location.origin)) return real(input, init);
    // the relay and the market (every other host)
    if (url.endsWith("/v0/agentzero/signup") && !net) return new Response(JSON.stringify({ token: "az1.suite" }), { status: 200, headers: cors });
    return relayFault(net, signal);
  }) as typeof fetch;
  async function relayFault(net: string, signal: AbortSignal | null | undefined): Promise<Response> {
    if (net === "hang") return aborted(signal);
    if (net === "slow") { await Promise.race([new Promise((r) => setTimeout(r, 20_000)), aborted(signal)]); return new Response("{}", { status: 200, headers: cors }); }
    if (net === "throw") throw new TypeError("Failed to fetch");
    if (net === "garbage") return new Response("<html>not json", { status: 200, headers: cors });
    if (net === "404" || net === "500" || net === "503") return new Response("{}", { status: Number(net), headers: cors });
    return new Response("{}", { status: 200, headers: cors });
  }
}

applyTheme(savedTheme());
const q = new URLSearchParams(location.search);
// --faults (run.mjs): AgentZero's limits shrunk (wait.ts LIMITS) so a hang ends in seconds, and Anthropic, the relay and
// the bridge faulted on purpose in this page only (fakeNet below, faultCall). No Claude, no network, no money.
if (q.has("faults")) Object.assign(LIMITS, { core: 2_000, read: 2_000, firstByte: 3_000, gap: 3_000 });
(window as unknown as { __limits: typeof LIMITS }).__limits = LIMITS;
if (q.has("faults")) installFakeNet(q.get("net") ?? "");
/** The demo's recorded coin prices (gallery/Screens.tsx RECORDED_COIN_USD), so the sample wallets read as ?demo's. */
const RECORDED_COIN_USD = { sol: 101.67, bsc: 744.17, hood: 2347.2 } as const;
const mock = createMockBridge({
  latencyMs: 60, tradeChains: ["sol", "hood", "bsc"], mainnetRules: {}, sampleLaptop: true, freshHistory: q.has("fresh"),
  ...(q.has("nosafe") ? {} : { hiddenStart: { usdc: "25", near: "2" } }),
  float: { priceUsd: (c) => RECORDED_COIN_USD[c as keyof typeof RECORDED_COIN_USD], ...(q.get("float") === "empty" ? {} : { opening: SAMPLE_OPENING }), ...(q.get("fault") === "1click" ? { nearCoin: () => undefined } : {}) },
});
type Rec = {
  __calls: string[];
  __approvals: { words: string; approved: boolean }[];
  __money: { ask: MoneyAsk; end?: MoneyEnd }[];
  __openApp: { id: string; tab?: string }[];
  __trade: { ask: TradeAsk; end?: TradeEnd }[];
  __clip?: () => Promise<string | null>;
};
const w = window as unknown as Rec;
w.__calls = []; w.__approvals = []; w.__money = []; w.__openApp = []; w.__trade = [];
mock.on("approval.needed", (e: unknown) => {
  const { id, words } = e as { id: string; words: unknown };
  const yes = q.get("approve") === "1";
  w.__approvals.push({ words: JSON.stringify(words).slice(0, 300), approved: yes });
  void mock.call("approval.answer", { id, approve: yes });
});
let tradeApp: Bridge | null = null;
const spending = hostSpending(() => tradeApp!, () => forApps(mock, "trade"));
const routedShell: Bridge = routeBridge(mock, { earn: createEarnReader(forApps(mock, "earn")), trade: createTradeReader(forApps(mock, "trade")), spending });
// ?fault=1click: the swap service down, as the core reports it too (its service status says 1Click isn't answering)
const injected = faultFromQuery(location.search) ?? (q.get("fault") === "1click" ? { service: "oneclick" as const, failure: 521 as const } : null);
const routed: Bridge = injected ? faultedBridge(routedShell, injected) : routedShell;
tradeApp = forApps(routed, "trade");
spending.start();
const agent = forApps(routed, "agent");
/** For the suite's no-Claude probes (run.mjs --probe): AgentZero's own bridge, read-only use. */
(window as unknown as { __agent: Bridge }).__agent = agent;
const wallet = forApps(routed, "wallet");
const SECRET = "az.suite.secret.";
const funded: Record<string, number> = {};
(window as unknown as { __fund: (chain: string, usd: number) => void }).__fund = (chain, usd) => void (funded[chain] = usd);
const ok = (v: unknown) => ({ ok: v }) as never;
/** --faults: these bridge methods hang, answer after 20 s, throw, or answer garbage (?fault-call=a,b&mode=…). */
const faultCalls = new Set((q.get("fault-call") ?? "").split(",").filter(Boolean));
const faultMode = q.get("mode") ?? "hang";
async function faultCall<T>(method: string, real: () => Promise<T>): Promise<T> {
  if (!faultCalls.has(method)) return real();
  if (faultMode === "hang") return new Promise<T>(() => undefined);
  if (faultMode === "slow") { await new Promise((r) => setTimeout(r, 20_000)); return real(); }
  if (faultMode === "throw") throw new Error(`${method} broke`);
  return { ok: { garbage: true, rows: "not a list" } } as T;
}
const bridge: Bridge = {
  async call(method: string, p: Record<string, unknown> = {}) {
    w.__calls.push(method);
    return faultCall(method, () => callHere(method, p));
  },
  on: (ev: string, h: (d: unknown) => void) => agent.on(ev as never, h as never),
} as unknown as Bridge;
// --faults ?nokey: no key of the person's own here (the free reading's relay path)
async function callHere(method: string, p: Record<string, unknown>) {
    if (method === "device.secret.get" && q.has("nokey") && String(p.key).endsWith("claude-key")) return ok({ value: null });
    if (method === "device.secret.get" && q.has("token") && String(p.key).endsWith(".token")) return ok({ value: "az1.suite" });
    if (method === "device.secret.get") return ok({ value: localStorage.getItem(SECRET + String(p.key)) });
    if (method === "device.secret.set") { if (p.value === null) localStorage.removeItem(SECRET + String(p.key)); else localStorage.setItem(SECRET + String(p.key), String(p.value)); return ok({ ok: true }); }
    if (method === "device.clipboard.read") return ok({ text: w.__clip ? await w.__clip() : null });
    if (method === "device.openUrl" || method === "device.haptic") return ok({ ok: true });
    // __fund: the wallet's money arrived (a walk's stand-in, sample only)
    if (method === "spending.status" && Object.keys(funded).length) {
      const r = (await agent.call(method, p)) as { ok?: { networks?: { network: string; cashUsd: string; nativeAmount?: string }[] } };
      for (const n of r.ok?.networks ?? []) if (funded[n.network] !== undefined) n.cashUsd = funded[n.network]!.toFixed(2);
      return r as never;
    }
    return agent.call(method, p) as never;
}
const walletCalls: Bridge = {
  call: (method: string, p?: Record<string, unknown>) => { w.__calls.push(`wallet:${method}`); return wallet.call(method as never, p as never); },
  on: (ev: string, h: (d: unknown) => void) => wallet.on(ev as never, h as never),
} as unknown as Bridge;

type Up = { ask: MoneyAsk; onEnd?: (end: MoneyEnd) => void; seq: number };
let show: (u: Up | null) => void = () => {};
let seq = 0;
const noop = () => undefined;
const base = { showProblem: async () => ({ kind: "nothing", label: "" }) as never, showWaiting: noop as never, openSwitcher: noop, openMenu: noop, active: true, index: 0, count: 1 };
const openMoney = (ask: MoneyAsk, onEnd?: (end: MoneyEnd) => void) => {
  w.__money.push({ ask: JSON.parse(JSON.stringify(ask)) as MoneyAsk });
  show({ ask, ...(onEnd ? { onEnd } : {}), seq: ++seq });
};
const openApp = (id: string, tab?: string) => {
  w.__openApp.push({ id, ...(tab ? { tab } : {}) });
  // the stand-in Trade: it takes the ask when it "opens", holds it on its way, and ends it (see the header)
  if (id !== "trade" || tab !== "ask") return;
  const t = tradeAsks.take();
  if (!t) return;
  tradeAsks.hold(t.seq, true);
  const ms = Number(new URLSearchParams(location.search).get("tradeMs") ?? 3000);
  // --faults ?tradeMs=never: Trade never calls back
  if (!Number.isFinite(ms)) return;
  setTimeout(() => tradeAsks.end(t.seq, { went: true, tradeId: `suite-${t.seq}`, landedMs: 2400 }), ms);
};
tradeAsks.setListed(["sol", "hood", "bsc", "near"]);
const openTrade = (ask: TradeAsk, onEnd?: (end: TradeEnd) => void) => {
  const rec: { ask: TradeAsk; end?: TradeEnd } = { ask: JSON.parse(JSON.stringify(ask)) as TradeAsk };
  w.__trade.push(rec);
  shellAsk({ shows: () => true, openApp }, ask, (end) => { rec.end = end; onEnd?.(end); }, agentZeroChatApp.id, true);
};

/** The shell's money sheet over the chat: Wallet's MoneyHost on Wallet's bridge (AppHost's moneyCtx). */
function Money() {
  const [up, setUp] = useState<Up | null>(null);
  useEffect(() => { show = setUp; return () => void (show = () => {}); }, []);
  // __sheetWent: the open sheet ends as an approved one does (a walk's stand-in: the sample account refuses real moves)
  useEffect(() => {
    (window as unknown as { __sheetWent: () => void }).__sheetWent = () => {
      if (!up) return;
      const end: MoneyEnd = { went: true, movementId: `walk-${up.seq}` };
      const last = w.__money.at(-1);
      if (last) last.end = end;
      setUp(null);
      up.onEnd?.(end);
    };
  }, [up]);
  if (!up) return null;
  // `asker`: the app that opened it, as the shell says it (AppHost, once Home's prefill has landed; ignored before)
  const extra = { asker: agentZeroChatApp.id } as Record<string, unknown>;
  return (
    <ShellContext.Provider value={{ ...base, bridge: walletCalls, openApp, openMoney } as never}>
      {/* --faults ?money=noend: the first sheet closes without its end (as a shell that drops it would) */}
      <MoneyHost key={up.seq} ask={up.ask} {...extra} onEnd={(end: MoneyEnd) => { const last = w.__money.at(-1); if (last) last.end = end; setUp(null); if (q.get("money") === "noend" && up.seq === 1) return; up.onEnd?.(end); }} />
    </ShellContext.Provider>
  );
}
/** --faults: the shell's Activity centre, recorded (window.__tasks: id → its last state), so the suite sees none left pending. */
const taskLog: Record<string, { title: string; state: string; detail?: string }> = {};
(window as unknown as { __tasks: typeof taskLog }).__tasks = taskLog;
const tasks = {
  publish: (t: { id: string; title: string; detail?: string }) => void (taskLog[t.id] = { title: t.title, state: "pending", ...(t.detail ? { detail: t.detail } : {}) }),
  update: (id: string, p: { detail?: string }) => { if (taskLog[id] && p.detail) taskLog[id]!.detail = p.detail; },
  end: (id: string, state: string, detail?: string) => { if (taskLog[id]) taskLog[id] = { ...taskLog[id]!, state, ...(detail ? { detail } : {}) }; },
};
const Root = agentZeroChatApp.Root;
/** The AgentZero tab, on or off screen (window.__tab). */
function Tab() {
  const [on, setOn] = useState(true);
  useEffect(() => { (window as unknown as { __tab: (v: boolean) => void }).__tab = setOn; }, []);
  return on ? <Root /> : null;
}
createRoot(document.getElementById("root")!).render(
  <div className="zf-phone" style={{ width: 390, height: 844, position: "relative", overflow: "hidden", background: "var(--bg)" }}>
    <ShellContext.Provider value={{ ...base, bridge, openApp, openMoney, openTrade, ...(q.has("faults") ? { tasks } : {}) } as never}>
      <Tab />
      <Money />
    </ShellContext.Provider>
  </div>,
);

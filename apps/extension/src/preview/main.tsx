// Preview pages for design review: the panel's own screens as plain pages, with stand-ins for Chrome and the network.
// Sample data only; nothing is real, nothing is signed. Not part of the extension's build (vite.config.ts builds panel.html
// and the background only); vite.preview.config.ts serves preview.html?screen=buy|locked|settings|add&theme=light|dark,
// the first-run journey as screen=welcome|wallet|money|journey-link|set, and bought (after a buy), positions (a page
// with no coin), problem (a coin on another chain), noquote (a coin no pool will price), and Touch ID on: locked-touch
// and settings-touch (a stand-in authenticator, as a headless browser has none).
import { createRoot } from "react-dom/client";
import "@zerofee/design/tokens.css";
import "@zerofee/design/ui.css";
import "@zerofee/trade/app/trade.css";
import "../panel/panel.css";
import { createDemoEngine } from "@zerofee/trade/demo-engine.ts";
import type { CoinDetail, Market } from "@zerofee/trade/market/types.ts";
import type { TradeRecord } from "@zerofee/trade/service.ts";
import type { SolRpc } from "@zerofee/trade/sol/rpc.ts";
import type { PanelMessage } from "../messages.ts";
import { Panel, type View } from "../panel/Panel.tsx";
import { PanelProvider } from "../panel/runtime.tsx";

const q = new URLSearchParams(location.search);
const screen = q.get("screen") ?? "buy";
const JOURNEY: Record<string, string | undefined> = { welcome: undefined, wallet: "wallet", money: "money", "journey-link": "link", set: "set" };
const noWallet = screen === "welcome" || screen === "wallet";
const touchOn = screen === "locked-touch" || screen === "settings-touch";
const touch = touchOn ? { touch: { credId: "AbCdEfGhIjKlMnOpQrSt", salt: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) } } : {};
if (touchOn) Object.defineProperty(globalThis, "PublicKeyCredential", { configurable: true, value: { isUserVerifyingPlatformAuthenticatorAvailable: async () => true } });
document.documentElement.dataset.theme = q.get("theme") === "dark" ? "dark" : "light";
// the side panel's size, whatever the window (headless Chrome won't make a window this narrow)
Object.assign(document.getElementById("root")!.style, { width: "380px", height: "760px" });

const SOL = "SampLe1111111111111111111111111111";
const MINT = "LumaSamp1e1111111111111111111111111111pump";
const coin: CoinDetail = { chain: "sol", address: MINT, symbol: "LUMA", name: "Luma", decimals: 6, priceUsd: 0.002841, change24hPct: 12.3, liquidityUsd: 84_000, marketCapUsd: 2_841_000 };
const market = {
  coin: async () => coin, meta: async () => coin, nativeUsd: async () => 147.86, livePrice: () => () => {},
  search: async () => [], trending: async () => [], candles: async () => [], stats: () => ({}),
} as unknown as Market;

type Area = Map<string, unknown>;
const area = (m: Area) => ({
  get: async (k: string) => ({ [k]: m.get(k) }),
  set: async (o: Record<string, unknown>) => { for (const [k, v] of Object.entries(o)) m.set(k, v); },
  remove: async (k: string) => { m.delete(k); },
  setAccessLevel: async () => {},
});
const quiet = { addListener() {}, removeListener() {} };
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    id: "preview",
    onMessage: quiet,
    async sendMessage(m: PanelMessage) {
      if (m.t === "vault.status") return { ok: noWallet ? { stage: "none" } : screen === "locked" || screen === "locked-touch" ? { stage: "locked", sol: SOL, perTradeUsd: 50, ...touch } : { stage: "unlocked", sol: SOL, perTradeUsd: 50, locksAt: Date.now() + 3_600_000, ...touch } };
      return { ok: true };
    },
  },
  storage: {
    local: area(new Map<string, unknown>(screen in JOURNEY ? (JOURNEY[screen] ? [["setup.v1", JOURNEY[screen]]] : []) : [["setup.v1", "done"]])),
    session: area(new Map<string, unknown>([["tab.1", { href: "", coin: screen === "positions" ? null : screen === "problem" ? { site: "gmgn", chain: "bsc", address: "0x55d398326f99059ff775485246999027b3197955", names: "coin" } : { site: "pump", chain: "sol", address: MINT, names: "coin" } }]])),
    onChanged: quiet,
  },
  tabs: { query: async () => [{ id: 1 }], onActivated: quiet, onRemoved: quiet },
  sidePanel: {},
};

const bought = {
  id: "preview", kind: "buy", chain: "sol", coin: MINT, symbol: "LUMA", status: "done", amountUsd: 25, hashes: [], startedAt: Date.now() - 4_000, filledInMs: 2_300,
  quote: { getRaw: "8773000000", getMinRaw: "8510000000", payRaw: "169000000", decimals: 6, feeUsd: 0.002, route: "pump.fun" },
} as unknown as TradeRecord;
const start: View | undefined = screen === "settings" || screen === "settings-touch" ? { kind: "settings" } : screen === "add" ? { kind: "add" } : screen === "bought" ? { kind: "bought", rec: bought } : undefined;
createRoot(document.getElementById("root")!).render(
  <PanelProvider standIns={{ rpc: {} as SolRpc, market, engineFor: (chain, owner) => {
    const e = createDemoEngine({ chain, owner, nativeUsd: () => market.nativeUsd(chain), meta: (c) => market.meta(chain, c) });
    // noquote: no pool answers with a price
    return screen === "noquote" ? { ...e, prepare: async () => { throw new Error("no pool priced it"); } } : e;
  } }}>
    <Panel start={start} />
  </PanelProvider>,
);


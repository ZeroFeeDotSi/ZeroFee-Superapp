// The Sim's simulated site window (product decision, 5 Nov). It is the
// in-app site view as the real one: our bar (Back, the site's name over its host, Close), the site's own wallet strip
// ("Your pump.fun wallet · $27.47"), and under it a page ZeroFee draws itself (sites-data.ts, all made up):
// - pump.fun's place: a board (Now · New coins · About to graduate), a coin's page, one-tap Buy;
// - GMGN's place: trenches (New · Completing · Completed), the same coin page;
// - any other address: a plain page with that address in the bar.
// Buy is one tap: the receipt shows in the same page (the hard rule: no hold, no confirm). It moves the site
// wallet's sample money through the Sim's bridge (MockBridge sim.site.trade); "short" says so with Add money.
import { useCallback, useEffect, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingWallet } from "@zerofee/core/spending";
import { Back, Close } from "@zerofee/design/icons.tsx";
import { Segmented } from "@zerofee/design/Segmented.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { usd } from "@zerofee/trade/app/format.ts";
import { hubRows } from "../social/hub-state.ts";
import {
  GMGN_TRENCHES, PUMP_BOARDS, SIM_SITE_BUYS, SIM_SITE_HOST, SIM_SITE_WORDS as W, coinsInTrench, coinsOnBoard, fmtAge, fmtCap, fmtCount, fmtPct, fmtPrice,
  fmtUnits, simWebLinks, sparkOf, sparkPath, type PumpBoard, type SimSiteCoin, type SimSiteKind, type Trench,
} from "./sites-data.ts";
import "../social/social.css";
import "./sim-pages.css";

type Answer = { status: "done"; side: "buy" | "sell"; usd: number; amount: string; decimals: number } | { status: "short"; haveUsd: number } | { status: "none" };
type Page = { kind: "list" } | { kind: "coin"; coin: SimSiteCoin } | { kind: "web"; host: string; path?: string; q?: string };
type Said = { kind: "receipt"; side: "buy" | "sell"; text: string; usd: number } | { kind: "short"; text: string } | { kind: "line"; text: string };

/** "duckduckgo.com/?q=cats" → the search's words; else null. */
const queryOf = (url: string): string | null => {
  try {
    const u = new URL(/^https?:/.test(url) ? url : `https://${url}`);
    return u.host.endsWith("duckduckgo.com") ? u.searchParams.get("q") : null;
  } catch { return null; }
};
const hostOf = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "") || "Website";

/** `site`: the listed site whose wallet pays (pump, gmgn); `url`: for a "web" page, the address asked. */
export function SimSitePage({ kind, site, url, name: given, onClose }: { kind: SimSiteKind; site?: string; url?: string; name?: string; onClose: () => void }) {
  const shell = useShell();
  const bridge: Bridge = shell.bridge;
  const first: Page = kind === "web" ? { kind: "web", host: hostOf(url ?? ""), ...(queryOf(url ?? "") ? { q: queryOf(url ?? "")! } : {}) } : { kind: "list" };
  const [stack, setStack] = useState<Page[]>([first]);
  const page = stack[stack.length - 1]!;
  const push = (p: Page) => setStack((s) => [...s, p]);
  const back = () => (stack.length > 1 ? setStack((s) => s.slice(0, -1)) : onClose());

  const listed = kind === "pump" || kind === "gmgn";
  const siteName = given ?? (kind === "pump" ? "pump.fun" : kind === "gmgn" ? "GMGN" : "");
  const host = listed ? SIM_SITE_HOST[kind] : page.kind === "web" ? (page.q !== undefined ? "duckduckgo.com" : page.host) : "";
  const title = listed ? (page.kind === "coin" ? page.coin.name : siteName) : page.kind === "web" ? (page.q !== undefined ? W.search(page.q) : page.path ? `${page.host} · ${page.path}` : page.host) : "";

  // the site's own wallet: its dollars (all it holds, the hub's one figure) and its id, for Add
  const [wallet, setWallet] = useState<{ id?: string; usd: number | null; sol: number | null }>({ usd: null, sol: null });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => bridge.on("spending.changed", refresh), [bridge, refresh]);
  useEffect(() => {
    if (!site) return;
    let live = true;
    void bridge.call<SpendingWallet[]>("spending.wallets").then((r) => {
      if (!live || !("ok" in r)) return;
      const row = hubRows(r.ok).find((x) => x.site === site);
      if (row) setWallet({ ...(row.wallet ? { id: row.wallet } : {}), usd: row.usd, sol: row.solUsd ?? row.usd });
    }).catch(() => undefined);
    return () => void (live = false);
  }, [bridge, site, tick]);
  const addMoney = () => {
    if (!wallet.id || !site) return;
    shell.openMoney({ kind: "siteadd", wallet: wallet.id, name: siteName }, () => refresh());
  };

  return (
    <div className={`zf-screen st-window sx sx--${kind}`} data-testid="sim-site">
      <header className="st-window-bar sx-bar">
        <button className="zf-icon-btn" aria-label="Back" onClick={back}><Back /></button>
        <span className="st-window-title sx-title">
          <span className="st-window-name">{title}</span>
          <span className="st-window-host">{host}</span>
        </span>
        <button className="zf-icon-btn" aria-label="Close" onClick={onClose}><Close /></button>
      </header>
      <div className="sx-wallet" data-testid="sim-site-wallet">
        <span className="sx-wallet-dot" aria-hidden="true" />
        {site ? (
          <>
            <span className="sx-wallet-name">Your {siteName} wallet · <b>{wallet.usd !== null ? usd(wallet.usd) : "…"}</b></span>
            {wallet.id && <button className="zf-link sx-wallet-add" onClick={addMoney}>Add</button>}
          </>
        ) : (
          <span className="sx-wallet-name">Your {host} wallet · made when you sign in</span>
        )}
      </div>
      <main className="sx-page" key={stack.length}>
        {page.kind === "list" && kind === "pump" && <PumpBoardView onCoin={(c) => push({ kind: "coin", coin: c })} />}
        {page.kind === "list" && kind === "gmgn" && <Trenches onCoin={(c) => push({ kind: "coin", coin: c })} />}
        {page.kind === "coin" && site && <CoinPage coin={page.coin} site={site} siteName={siteName} gmgn={kind === "gmgn"} bridge={bridge} have={wallet.sol} onAdd={wallet.id ? addMoney : undefined} onTraded={refresh} />}
        {page.kind === "web" && <WebPage page={page} onLink={(p) => push(p)} />}
        <p className="zf-small sx-foot">{W.sim}</p>
      </main>
    </div>
  );
}

/** A coin's badge: drawn by us (its hue and first letter), never a picture. */
function Badge({ c, size = 40 }: { c: SimSiteCoin; size?: number }) {
  return (
    <span className="sx-badge" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: `linear-gradient(135deg, hsl(${c.hue} 70% 62%), hsl(${(c.hue + 40) % 360} 65% 42%))` }}>
      {c.symbol.slice(0, 1)}
    </span>
  );
}

function Spark({ c, w = 56, h = 24 }: { c: SimSiteCoin; w?: number; h?: number }) {
  return (
    <svg className={`sx-spark ${c.changePct >= 0 ? "up" : "down"}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={sparkPath(sparkOf(c), w, h)} />
    </svg>
  );
}

function Curve({ pct }: { pct: number }) {
  return (
    <span className="sx-curve" role="meter" aria-label="Bonding curve" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(3, pct)}%` }} />
    </span>
  );
}

function PumpBoardView({ onCoin }: { onCoin: (c: SimSiteCoin) => void }) {
  const [board, setBoard] = useState<PumpBoard>("now");
  return (
    <>
      <div className="sx-site-head">
        <span className="sx-site-mark sx-site-mark--pump" aria-hidden="true" />
        <span><b>Launchpad</b><span className="zf-small">{W.board}</span></span>
      </div>
      <Segmented items={PUMP_BOARDS} value={board} onChange={setBoard} label="Board" className="sx-seg" />
      <ul className="sx-list" aria-label="Coins">
        {coinsOnBoard(board).map((c) => (
          <li key={c.token}>
            <button className="sx-row" onClick={() => onCoin(c)} data-testid="sim-coin">
              <Badge c={c} />
              <span className="sx-row-mid">
                <span className="sx-row-name"><b>{c.name}</b> <span className="sx-tick">{c.symbol}</span></span>
                <span className="sx-row-meta">cap {fmtCap(c.capUsd)} · {fmtAge(c.ageMin)} · {c.replies} replies</span>
                <Curve pct={c.curvePct} />
              </span>
              <span className="sx-row-end">
                <Spark c={c} />
                <span className={`sx-chg ${c.changePct >= 0 ? "up" : "down"}`}>{fmtPct(c.changePct)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Trenches({ onCoin }: { onCoin: (c: SimSiteCoin) => void }) {
  const [t, setT] = useState<Trench>("new");
  return (
    <>
      <div className="sx-site-head">
        <span className="sx-site-mark sx-site-mark--gmgn" aria-hidden="true" />
        <span><b>Trenches</b><span className="zf-small">{W.trenches}</span></span>
      </div>
      <Segmented items={GMGN_TRENCHES} value={t} onChange={setT} label="Trenches" className="sx-seg" />
      <ul className="sx-list sx-list--dense" aria-label="Coins">
        {coinsInTrench(t).map((c) => (
          <li key={c.token}>
            <button className="sx-row" onClick={() => onCoin(c)} data-testid="sim-coin">
              <Badge c={c} size={36} />
              <span className="sx-row-mid">
                <span className="sx-row-name"><b>{c.symbol}</b> <span className="sx-tick">{c.name}</span> <span className="sx-age">{fmtAge(c.ageMin)}</span></span>
                <span className="sx-row-meta">MC {fmtCap(c.capUsd)} · V {fmtCap(c.volUsd)} · {fmtCount(c.holders)} holders</span>
                {t !== "completed" ? <Curve pct={c.curvePct} /> : <span className="sx-row-meta">{c.replies} replies</span>}
              </span>
              <span className="sx-row-end">
                <Spark c={c} />
                <span className={`sx-chg ${c.changePct >= 0 ? "up" : "down"}`}>{fmtPct(c.changePct)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function CoinPage({ coin: c, site, siteName, gmgn, bridge, have, onAdd, onTraded }: { coin: SimSiteCoin; site: string; siteName: string; gmgn: boolean; bridge: Bridge; have: number | null; onAdd?: () => void; onTraded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const W_ = 358, H = 150;
  const pts = sparkOf(c, 48);
  const line = sparkPath(pts, W_, H, 8);
  const trade = async (side: "buy" | "sell", dollars?: number) => {
    if (busy) return;
    setBusy(true);
    const r = await bridge.call<Answer>("sim.site.trade", { site, side, coin: { token: c.token, symbol: c.symbol, name: c.name, priceUsd: c.priceUsd }, ...(dollars ? { usd: dollars } : {}) }).catch(() => null);
    setBusy(false);
    if (!r) return setSaid({ kind: "line", text: W.failed });
    if ("problem" in r) return setSaid({ kind: "line", text: r.problem.whatHappened });
    const a = r.ok;
    if (a.status === "short") return setSaid({ kind: "short", text: W.short(a.haveUsd) });
    if (a.status === "none") return setSaid({ kind: "line", text: W.none });
    setSaid({ kind: "receipt", side: a.side, usd: a.usd, text: a.side === "buy" ? W.bought(fmtUnits(a.amount, a.decimals), c.symbol, a.usd) : W.sold(a.usd) });
    onTraded();
    void bridge.call("device.haptic", { kind: "success" }).catch(() => undefined);
  };
  const stats: [string, string][] = [
    ["Market cap", fmtCap(c.capUsd)],
    [gmgn ? "Volume 24h" : "Volume", fmtCap(c.volUsd)],
    ["Holders", fmtCount(c.holders)],
    [gmgn ? "Age" : "Replies", gmgn ? fmtAge(c.ageMin) : String(c.replies)],
  ];
  return (
    <div className="sx-coin">
      <div className="sx-coin-head">
        <Badge c={c} size={52} />
        <span>
          <span className="sx-coin-name">{c.name} <span className="sx-tick">{c.symbol}</span></span>
          <span className="zf-small">{c.line}</span>
        </span>
      </div>
      <div className="sx-coin-price">
        <span className="sx-coin-usd">{fmtPrice(c.priceUsd)}</span>
        <span className={`sx-chg ${c.changePct >= 0 ? "up" : "down"}`}>{fmtPct(c.changePct)} today</span>
      </div>
      <svg className={`sx-chart ${c.changePct >= 0 ? "up" : "down"}`} viewBox={`0 0 ${W_} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${c.name} price, today`}>
        <path className="sx-chart-area" d={`${line} L${W_} ${H} L0 ${H} Z`} />
        <path className="sx-chart-line" d={line} />
      </svg>
      <dl className="sx-stats">
        {stats.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {c.curvePct < 100 ? (
        <div className="sx-coin-curve"><span className="zf-small">Bonding curve · {c.curvePct}%</span><Curve pct={c.curvePct} /></div>
      ) : (
        <p className="zf-small sx-coin-curve">Graduated · trading on the open market</p>
      )}
      {said?.kind === "receipt" ? (
        <div className="sx-receipt" role="status" data-testid="sim-receipt">
          <span className="sx-receipt-mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <b>{said.text}</b>
          <span className="zf-small">{said.side === "buy" ? `Paid from your ${siteName} wallet. Sample money.` : `Back in your ${siteName} wallet. Sample money.`}</span>
          <div className="sx-receipt-acts">
            <button className="zf-btn zf-btn--quiet" onClick={() => setSaid(null)}>{said.side === "buy" ? "Buy more" : "Done"}</button>
            {said.side === "buy" && <button className="zf-btn zf-btn--quiet" disabled={busy} onClick={() => void trade("sell")}>Sell all</button>}
          </div>
        </div>
      ) : (
        <div className="sx-buy">
          <div className="sx-buys">
            {SIM_SITE_BUYS.map((u) => <button key={u} className="zf-btn" disabled={busy} onClick={() => void trade("buy", u)} data-testid={`sim-buy-${u}`}>Buy ${u}</button>)}
          </div>
          <button className="zf-link sx-sell" disabled={busy} onClick={() => void trade("sell")}>Sell all</button>
          {said?.kind === "short" && (
            <div className="sx-short" role="status">
              <span className="zf-small">{said.text}</span>
              {onAdd && <button className="zf-btn" onClick={onAdd}>Add money</button>}
            </div>
          )}
          {said?.kind === "line" && <p className="zf-small sx-line" role="status">{said.text}</p>}
          {have !== null && !said && <p className="zf-small sx-line">One tap buys. {usd(have)} ready in this wallet.</p>}
        </div>
      )}
    </div>
  );
}

function WebPage({ page, onLink }: { page: Extract<Page, { kind: "web" }>; onLink: (p: Page) => void }) {
  if (page.q !== undefined) {
    const q = page.q;
    const results = [`${q.toLowerCase().replace(/\s+/g, "")}.com`, `${q.toLowerCase().split(/\s+/)[0]}.org`, "news.example"];
    return (
      <div className="sx-web">
        <div className="sx-search"><span className="zf-small">Search</span><b>{q}</b></div>
        <ul className="zf-group sx-results">
          {results.map((h) => (
            <li key={h}>
              <button className="zf-row sx-web-row" onClick={() => onLink({ kind: "web", host: h })}>
                <span className="sx-web-fav" aria-hidden="true">{h.charAt(0).toUpperCase()}</span>
                <span><span className="t">{h}</span><span className="d">A sample result for "{q}"</span></span>
                <span className="v" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
        <SimCard host="duckduckgo.com" />
      </div>
    );
  }
  return (
    <div className="sx-web">
      <div className="sx-web-hero">
        <span className="sx-web-fav sx-web-fav--big" aria-hidden="true">{page.host.charAt(0).toUpperCase()}</span>
        <b className="sx-web-host">{page.host}</b>
        {page.path && <span className="zf-small">{page.path}</span>}
      </div>
      <SimCard host={page.host} />
      {!page.path && (
        <ul className="zf-group sx-results">
          {simWebLinks(page.host).map((l) => (
            <li key={l.title}>
              <button className="zf-row sx-web-row" onClick={() => onLink({ kind: "web", host: page.host, path: l.title.split(" · ")[1] })}>
                <span className="sx-web-fav" aria-hidden="true">{page.host.charAt(0).toUpperCase()}</span>
                <span><span className="t">{l.title}</span><span className="d">{l.line}</span></span>
                <span className="v" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SimCard({ host }: { host: string }) {
  return (
    <section className="sx-card" data-testid="sim-web-card">
      <span className="sx-card-tag">Simulation</span>
      <b>{W.webTitle}</b>
      <p className="zf-small">{W.webBody(host)}</p>
      <p className="zf-small">{W.webMore}</p>
    </section>
  );
}


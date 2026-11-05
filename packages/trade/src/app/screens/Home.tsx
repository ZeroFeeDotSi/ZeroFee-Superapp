// Trade's Home (V1 port slice 3, product decision, 28 Oct: Wallet V1's Home in Monument): the Trading balance big, how the coins did,
// the vault beside it, one row of actions (Move · Receive · Trade), a quiet strip while money is moving, every chain with
// its own coin and the coins held on it (each with its result against what it cost, every fee included), then what's
// trending. A loss is a minus sign, not a red row. First run: one line and Top up (D52: no set-up).
import { useEffect, useRef } from "react";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { useBalanceTotal } from "@zerofee/wallet/app/BalanceTotal.ts";
import { Mark } from "@zerofee/design/Mark.tsx";
import type { CoinRow } from "../../market/types.ts";
import { holdingsUsd, type Position } from "../../service.ts";
import { about, shownMove } from "../boards.ts";
import { homeTrending } from "../movers.ts";
import { amount, change, listPrice, usd } from "../format.ts";
import { Forward, Gear } from "../icons.tsx";
import { CHAIN_NAME, LISTED, OFFERED, useFloat, useLive, useTrade } from "../runtime.tsx";
import { UNREAD_WORDS } from "../../float-view.ts";
import { moveWords } from "../../move-words.ts";
import { tradeProblems } from "../../trade-problems.ts";
import { asOfText, LIST_REFRESH_MS, listAsOf } from "../list-age.ts";
import { listRetryMs } from "../reads.ts";

const NATIVE_ICON = { sol: "sol", bsc: "bsc", hood: "eth", near: "near" } as const;   // the shell's bundled logos, by trusted key (Robinhood Chain pays gas in ETH)
const NATIVE_SYMBOL = { sol: "SOL", bsc: "BNB", hood: "ETH", near: "NEAR" } as const;
/** When the strip's move goes (one waiting its turn) or lands (one on its way). */
const stripWhen = (m: { status: string; etaSec?: number }): string =>
  m.etaSec === undefined ? "" : m.status === "waiting" ? (m.etaSec > 0 ? ` · goes in ${about(m.etaSec)}` : " · goes now") : ` · ${about(m.etaSec)}`;
/** How many trending coins Home shows before "See all" (V1's five). */
const TRENDING_ON_HOME = 5;

export function Home({ onMove, onTopUp, onReceive, onTrade, onWallets, onCoin, onRow, onActivity, onSettings }: {
  onMove: () => void; onTopUp?: () => void; onReceive: () => void; onTrade: () => void; onWallets: () => void;
  onCoin: (p: Position) => void; onRow: (r: CoinRow) => void; onActivity: () => void; onSettings: () => void;
}) {
  const { svc, market, active, refused } = useTrade();
  // the Trading total is the float's: the reserve, every wallet, the coins, an Add on its way (the line, Wallet's In trading)
  const { snap } = useFloat();
  const { bridge } = useShell();
  const wallets = useLive(() => svc.wallets(), []);
  // the one total Wallet and Pay show (this trading money included): the vault is the rest of it
  const all = useBalanceTotal(bridge);
  const positions = useLive(() => svc.positions(), []);
  // the Trade tab's own list: only chains Trade offers, and never a coin Buy would refuse (audit 2 Nov: Home offered a
  // BNB Chain coin the Trade tab leaves out)
  const trending = useLive(() => market.trending().then(async (rs) => {
    const sol = rs.filter((r) => r.chain === "sol" && OFFERED.includes("sol")).map((r) => r.address);
    // at most 2 s for the mints, as Discover waits (Buy checks the coin anyway)
    const no = await Promise.race([refused("sol", sol), new Promise<Map<string, unknown>>((res) => setTimeout(() => res(new Map()), 2_000))]);
    return Object.assign(homeTrending(rs, LISTED, no, TRENDING_ON_HOME), { asOf: rs.asOf, readAt: Date.now() });
  }), []);
  // the list is read again while Home is on screen (its prices never sit as they were when it opened), and an answer
  // older than a few minutes says the time it is from (audit 2 Nov: Home showed a day-old list as today's)
  useEffect(() => { if (!active) return; const t = setInterval(() => trending.reload(), LIST_REFRESH_MS); return () => clearInterval(t); }, [active]);
  // a read that failed (a market 429) is asked again by itself, sooner first (listRetryMs), never only at the next refresh
  const trendFails = useRef(0);
  useEffect(() => {
    if (trending.value?.length) { trendFails.current = 0; return; }
    if (!trending.error || !active) return;
    const t = setTimeout(() => trending.reload(), listRetryMs(++trendFails.current));
    return () => clearTimeout(t);
  }, [trending.error, trending.value, active]);
  const logos = useLive(async () => Object.fromEntries(await Promise.all((positions.value ?? []).map(async (p) => [`${p.chain}:${p.coin}`, (await market.coin(p.chain, p.coin).catch(() => undefined))?.logoUrl] as const))), [positions.value?.length]);
  // a wallet with no price is no figure (service.ts wallets()): once Spending's own read is in, its rows stand on their
  // own; before it, Home says it can't see prices, never a total short by a wallet
  if (wallets.error && !wallets.value && !snap.loaded) return (
    <div className="tr-empty zf-enter">
      <p className="zf-body">{tradeProblems.marketBusy().whatHappened}</p>
      <button className="zf-link" onClick={wallets.reload}>{tradeProblems.marketBusy().next.label}</button>
    </div>
  );
  if ((!wallets.value && !wallets.error) || !positions.value) return <div className="tr-center tr-tall"><Mark size={56} mode="loading" /></div>;
  const ws = wallets.value ?? [];
  const ps = positions.value.filter((p) => BigInt(p.raw) > 0n).sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  // the float's read once it has answered (fresh after every move); before that, the wallets' own
  const total = snap.loaded ? snap.totalUsd : holdingsUsd(ws, positions.value);
  const cost = ps.reduce((n, p) => n + (p.valueUsd !== undefined ? p.costUsd : 0), 0), value = ps.reduce((n, p) => n + (p.valueUsd ?? 0), 0);
  const vault = all !== null ? Math.max(0, Number(all) - total) : null;
  const moving = snap.moves.filter((m) => shownMove(m) && (m.status === "moving" || (m.status === "waiting" && !m.held)));
  // a float the core couldn't read (a restore with 1Click not answering, audit F-1) is never "empty" and never $0
  if (snap.unread) return (
    <div className="tr-empty zf-enter">
      <p className="zf-body">{UNREAD_WORDS}</p>
      <p className="zf-small">Nothing has moved. ZeroFee checks again in a few seconds.</p>
    </div>
  );
  if (total === 0 && ps.length === 0) return (
    <div className="tr-empty zf-enter">
      <p className="zf-body">Top up Spending from your Safe, then buy any coin in seconds.</p>
      {/* straight to Top up: with nothing in Spending there is nothing to put away (grade 02h, H4) */}
      <div className="tr-floor"><button className="zf-btn" onClick={onTopUp ?? onMove}>Top up</button></div>
    </div>
  );
  return (
    <div className="zf-enter tr-home">
      <div className="tr-homehead"><span className="zf-label">Your wallets</span><button className="tr-gear" aria-label="Settings" onClick={onSettings}><Gear /></button></div>
      <div className="tr-price tr-total">{usd(total)}</div>
      {cost > 0 && <div className="zf-small tr-change">{change(value - cost, ((value - cost) / cost) * 100)} <span className="tr-mute">on your coins</span></div>}
      {/* the total someone sees in Wallet and Pay, named, and the vault beside Trading: two numbers never read as a mistake */}
      {vault !== null && <div className="zf-small tr-mute tr-main">Your Safe: {usd(vault)}</div>}
      {all !== null && <div className="zf-small tr-mute">All your money: {usd(Number(all))}</div>}

      {/* V1's action row: one tap each */}
      <div className="tr-actions" role="group" aria-label="Actions">
        <button onClick={onMove}><span className="tr-act-ic" aria-hidden="true">⇅</span>Move</button>
        <button onClick={onReceive}><span className="tr-act-ic" aria-hidden="true">↓</span>Receive</button>
        <button onClick={onTrade}><span className="tr-act-ic" aria-hidden="true">↗</span>Trade</button>
      </div>

      {/* V1's task strip: quiet, only while money is moving; a tap opens Activity */}
      {moving.length > 0 && (
        <button className="tr-strip" onClick={onActivity}>
          <Mark size={16} mode="loading" />
          <span>{moveWords(moving[0]!)}{stripWhen(moving[0]!)}{moving.length > 1 ? ` · ${moving.length - 1} more` : ""}</span>
        </button>
      )}

      {/* every chain: its own coin, then the coins held on it (V1's list); the chain line opens Trading wallets */}
      <div className="tr-natives tr-groups">
        {snap.reserveUsd >= 0.01 && (
          <button className="zf-row tr-chainrow" onClick={onWallets}>
            <span className="tr-chainic" aria-hidden="true">⌁</span>
            <span><span className="t">Ready to move</span><span className="d">In Spending, for any network</span></span>
            <span className="tr-right"><span className="tr-v">{usd(snap.reserveUsd)}</span></span>
          </button>
        )}
        {OFFERED.map((chain) => {
          const c = snap.chains.find((x) => x.chain === chain), w = ws.find((x) => x.chain === chain);
          const onChain = c ? c.nativeUsd + (c.inFlight?.to === "chain" ? c.inFlight.usd : 0) : w?.nativeUsd ?? 0;
          const held = ps.filter((p) => p.chain === chain);
          // a wallet made from replaced backup words that still holds money: said on its chain's row (it opens Trading wallets)
          const old = !!c?.wallets.some((x) => x.oldWords && x.nativeUsd + x.coinsUsd >= 0.01);
          if (onChain < 0.01 && held.length === 0) return null;
          return (
            <div key={chain} className="tr-group">
              <button className="zf-row tr-chainrow" onClick={onWallets}>
                <CoinIcon symbol={NATIVE_SYMBOL[chain]} icon={NATIVE_ICON[chain]} size={30} />
                <span><span className="t">{CHAIN_NAME[chain]}</span><span className="d">{w ? `${amount(w.native, chain === "sol" ? 9 : 18)} ${NATIVE_SYMBOL[chain]}` : NATIVE_SYMBOL[chain]}{old ? " · one wallet uses your old backup words" : ""}{c?.closed ? " · opens once ZeroFee has tested it" : ""}</span></span>
                <span className="tr-right"><span className="tr-v">{usd(onChain)}</span></span>
              </button>
              {held.map((p) => (
                <button key={`${p.chain}:${p.coin}`} className="zf-row tr-row" onClick={() => onCoin(p)}>
                  <CoinIcon symbol={p.symbol} src={logos.value?.[`${p.chain}:${p.coin}`]} size={30} />
                  <span><span className="t">{p.symbol}</span><span className="d">{amount(p.raw, p.decimals)} · {CHAIN_NAME[p.chain]}</span></span>
                  <span className="tr-right"><span className="tr-v">{p.valueUsd !== undefined ? usd(p.valueUsd) : ""}</span><span className="tr-vd">{p.pnlUsd !== undefined ? change(p.pnlUsd, p.pnlPct) : ""}</span></span>
                </button>
              ))}
            </div>
          );
        })}
        {/* NEAR coins (TN2): held inside Spending's private balance, no wallet of their own; each with its result in dollars */}
        {ps.some((p) => p.chain === "near") && (
          <div className="tr-group">
            <div className="zf-row tr-chainrow" role="heading" aria-level={3}>
              <CoinIcon symbol="NEAR" icon="near" size={30} />
              <span><span className="t">NEAR coins</span><span className="d">Inside Spending</span></span>
            </div>
            {ps.filter((p) => p.chain === "near").map((p) => (
              <button key={`${p.chain}:${p.coin}`} className="zf-row tr-row" onClick={() => onCoin(p)}>
                <CoinIcon symbol={p.symbol} src={logos.value?.[`${p.chain}:${p.coin}`]} size={30} />
                <span><span className="t">{p.symbol}</span><span className="d">{amount(p.raw, p.decimals)} · NEAR</span></span>
                <span className="tr-right"><span className="tr-v">{p.valueUsd !== undefined ? usd(p.valueUsd) : ""}</span><span className="tr-vd">{p.pnlUsd !== undefined ? change(p.pnlUsd, p.pnlPct) : ""}</span></span>
              </button>
            ))}
          </div>
        )}
      </div>
      {ps.length > 0 && <p className="zf-small tr-note">Cost includes every fee paid.</p>}

      {/* V1's markets under the money: what's trending, five, and the rest on the Trade tab */}
      {!!trending.value?.length && (
        <>
          <div className="zf-label tr-head">Trending{asOfText(listAsOf(trending.value, trending.value.readAt, !!trending.error))}</div>
          {trending.value.map((r) => (
            <button key={`${r.chain}:${r.address}`} className="zf-row tr-row tr-trend" onClick={() => onRow(r)}>
              <CoinIcon symbol={r.symbol ?? "?"} src={r.logoUrl} size={30} />
              <span><span className="t">{r.symbol}</span><span className="d">{CHAIN_NAME[r.chain]}</span></span>
              <span className="tr-right"><span className="tr-v">{r.priceUsd !== undefined ? listPrice(r.priceUsd) : ""}</span><span className="tr-vd">{r.change24hPct !== undefined ? `${r.change24hPct >= 0 ? "+" : "−"}${Math.abs(r.change24hPct).toFixed(1)}%` : ""}</span></span>
            </button>
          ))}
          <button className="zf-link tr-seeall" onClick={onTrade}>See all <Forward /></button>
        </>
      )}
    </div>
  );
}

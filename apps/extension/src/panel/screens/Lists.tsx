// Positions and Activity (the board's "Panel · Positions"). Trading money in total, dollars next to percent on the coins,
// and every coin with its result against what it cost, every fee included. A loss is a minus sign, not a red row.
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Mark } from "@zerofee/design/Mark.tsx";
import { ago, amount, change, usd } from "@zerofee/trade/app/format.ts";
import { nativeLogoUri } from "@zerofee/trade/market/logo.ts";
import { CHAINS, type Position, type TradeRecord } from "@zerofee/trade/service.ts";
import { useLive, usePanel } from "../runtime.tsx";

export function Positions({ onCoin, onAdd, hint }: { onCoin: (p: Position) => void; onAdd: () => void; hint?: string }) {
  const { svc, market } = usePanel();
  const wallets = useLive(() => svc.wallets(), []);
  const positions = useLive(() => svc.positions(), []);
  const logos = useLive(async () => Object.fromEntries(await Promise.all((positions.value ?? []).map(async (p) => [p.coin, (await market.coin(p.chain, p.coin).catch(() => undefined))?.logoUrl] as const))), [positions.value?.length]);
  if (!wallets.value || !positions.value) return <div className="tr-center tr-tall"><Mark size={48} mode="loading" /></div>;
  const sol = wallets.value.find((w) => w.chain === "sol");
  const ps = positions.value.filter((p) => BigInt(p.raw) > 0n).sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const value = ps.reduce((n, p) => n + (p.valueUsd ?? 0), 0), cost = ps.reduce((n, p) => n + (p.valueUsd !== undefined ? p.costUsd : 0), 0);
  const total = (sol?.nativeUsd ?? 0) + value;
  return (
    <div className="zf-enter">
      {hint && <div className="zf-note p-hint">{hint}</div>}
      <div className="zf-label tr-head">Trading money</div>
      <div className="tr-price tr-total p-price">{usd(total)}</div>
      {cost > 0 && <div className="zf-small tr-change">{change(value - cost, ((value - cost) / cost) * 100)} <span className="tr-mute">on your coins</span></div>}
      <div className="tr-natives">
        <span className="zf-small"><span><CoinIcon symbol="SOL" src={nativeLogoUri("sol")} size={16} /> {amount(sol?.native ?? "0", CHAINS.sol.decimals)} SOL{sol ? ` · ${usd(sol.nativeUsd)}` : ""}</span></span>
        <button className="zf-link tr-fund" onClick={onAdd}>Add</button>
      </div>
      <div className="zf-label tr-head">Positions</div>
      {ps.length === 0 && <p className="zf-small tr-none">No coins yet.</p>}
      {ps.map((p) => (
        <button key={p.coin} className="zf-row tr-row" onClick={() => onCoin(p)}>
          <CoinIcon symbol={p.symbol} src={logos.value?.[p.coin]} size={30} />
          <span><span className="t">{p.symbol}</span><span className="d">{amount(p.raw, p.decimals)} · Solana</span></span>
          <span className="tr-right"><span className="tr-v">{p.valueUsd !== undefined ? usd(p.valueUsd) : ""}</span><span className="tr-vd">{p.pnlUsd !== undefined ? change(p.pnlUsd, p.pnlPct) : ""}</span></span>
        </button>
      ))}
      {ps.length > 0 && <p className="zf-small tr-note">Cost includes every fee paid.</p>}
    </div>
  );
}

const STATUS: Record<TradeRecord["status"], string> = { signing: "Signing", sending: "Sending", confirming: "Confirming", done: "Done", declined: "Stopped", failed: "Didn't go through", expired: "Didn't go through", unconfirmed: "Waiting for Solana" };

export function Activity() {
  const { svc } = usePanel();
  const list = useLive(() => svc.activity(), []);
  if (!list.value) return <div className="tr-center tr-tall"><Mark size={48} mode="loading" /></div>;
  const rows = list.value.filter((r) => r.kind === "buy" || r.kind === "sell");
  if (rows.length === 0) return <p className="zf-small tr-none">Your trades from this browser appear here.</p>;
  return (
    <div className="zf-enter">
      {rows.map((r) => (
        <div key={r.id} className="zf-row tr-act">
          <CoinIcon symbol={r.symbol} size={30} />
          <span><span className="t">{r.kind === "buy" ? "Bought" : "Sold"} {r.symbol}</span><span className="d">{STATUS[r.status]}{r.filledInMs !== undefined ? ` · ${(r.filledInMs / 1000).toFixed(1)} s` : ""}</span></span>
          <span className="tr-right"><span className="tr-v">{usd(r.amountUsd)}</span><span className="tr-vd">{ago(r.startedAt)}</span></span>
        </div>
      ))}
    </div>
  );
}

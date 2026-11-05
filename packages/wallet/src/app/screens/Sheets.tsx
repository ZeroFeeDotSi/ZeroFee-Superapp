// The sheets: Add money (three networks, one tap to a QR; More networks), Send from (every
// network that really receives, searchable), and a coin picker.
import { useState } from "react";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import type { Chain } from "../../types.ts";
import { Right, Search, SmallCheck } from "../icons.tsx";
import { topNetworks } from "../format.ts";
import { usually } from "../runtime.tsx";

/**
 * Add money: three networks (the one last used, then NEAR, Solana, Base), each one tap to its address and QR (Alpha
 * metric 1); "More networks" for every other one, searchable.
 */
export function AddMoneySheet({ chains, current, onPick, onClose }: { chains: Chain[]; current: string; onPick: (c: Chain) => void; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const first = [...chains].sort((a, b) => Number(b.id === current) - Number(a.id === current));
  return (
    <Sheet title="Add money" onClose={onClose}>
      <div className="zf-label wl-sheet-label">Any coin, from a wallet or exchange, on</div>
      {all ? <ChainList chains={first} current={current} onPick={onPick} /> : (
        <>
          <ChainList chains={topNetworks(chains, current)} current={current} onPick={onPick} search={false} />
          <button className="wl-row wl-more" onClick={() => setAll(true)}><span className="t">More networks</span><Right /></button>
        </>
      )}
    </Sheet>
  );
}

export function ChainSheet({ chains, current, onPick, onClose }: { chains: Chain[]; current: string; onPick: (c: Chain) => void; onClose: () => void }) {
  return (
    <Sheet title="Send from" onClose={onClose}>
      <ChainList chains={chains} current={current} onPick={onPick} />
    </Sheet>
  );
}

/** Every network that receives, searchable, each one tap. */
function ChainList({ chains, current, onPick, search = true }: { chains: Chain[]; current: string; onPick: (c: Chain) => void; search?: boolean }) {
  const [q, setQ] = useState("");
  const shown = chains.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      {search && (
        <label className="wl-search">
          <Search />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search networks" aria-label="Search networks" />
        </label>
      )}
      <div className="wl-chains">
        {shown.map((c) => (
          <button className="wl-row wl-pick" key={c.id} onClick={() => onPick(c)} aria-pressed={c.id === current}>
            <CoinIcon symbol={c.name} icon={c.icon} size={30} />
            <div><div className="t">{c.name}</div><div className="d">{c.id === "stellar" ? "Needs a memo · " : ""}{c.id === "stellar" ? usually(c.id).toLowerCase() : usually(c.id)}</div></div>
            <span className={`zf-tick${c.id === current ? " on" : " wl-tick-off"}`}>{c.id === current && <SmallCheck />}</span>
          </button>
        ))}
        {shown.length === 0 && <p className="zf-small wl-none">No network by that name.</p>}
      </div>
    </>
  );
}

export interface PickRow {
  key: string;
  symbol: string;
  icon?: string;
  title: string;
  detail: string;
  right?: string;
}

/** Pick one coin, searchable by name or network. */
export function PickSheet({ title, rows, current, onPick, onClose }: { title: string; rows: PickRow[]; current?: string; onPick: (key: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => !needle || `${r.title} ${r.symbol} ${r.detail}`.toLowerCase().includes(needle));
  return (
    <Sheet title={title} onClose={onClose}>
      {rows.length > 8 && (
        <label className="wl-search">
          <Search />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search coins" aria-label="Search coins" />
        </label>
      )}
      <div className="wl-chains">
        {shown.map((r) => (
          <button className="wl-row wl-pick" key={r.key} onClick={() => onPick(r.key)} aria-pressed={r.key === current}>
            <CoinIcon symbol={r.symbol} icon={r.icon} size={30} />
            <div><div className="t">{r.title}</div><div className="d">{r.detail}</div></div>
            <div className="r"><div className="vd">{r.right ?? ""}</div></div>
          </button>
        ))}
        {shown.length === 0 && <p className="zf-small wl-none">No coin by that name.</p>}
      </div>
    </Sheet>
  );
}

// Trade's Settings (V1 port slice 3b, V1's short groups): trade sounds, how far a price may move, where Trading's money
// goes, and the wallets. No key, phrase or password here: the core holds those, and Security's own screens show them.
import { useEffect, useState } from "react";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { Forward } from "../icons.tsx";
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from "../prefs.ts";
import { useLive, useTrade } from "../runtime.tsx";

/** The price-move limits offered: Auto (the engines' rule, by the coin's liquidity), or at most this much. */
const LIMITS: { bps: number | null; label: string }[] = [{ bps: null, label: "Auto" }, { bps: 200, label: "2%" }, { bps: 500, label: "5%" }, { bps: 1000, label: "10%" }, { bps: 2000, label: "20%" }];

export function SlippageRow() {
  const { svc } = useTrade();
  const limit = useLive(() => svc.maxSlippage(), []);
  return (
    <>
      <div className="zf-label tr-sec">Most the price can move in a trade</div>
      <div className="tr-presets">{LIMITS.map((l) => <button key={l.label} className={limit.value === l.bps ? "on" : ""} onClick={() => void svc.setMaxSlippage(l.bps)}>{l.label}</button>)}</div>
      <p className="zf-small">{limit.value === null || limit.value === undefined ? "Auto: ZeroFee sets it for each coin, from how much it trades." : `A trade that could move more than ${limit.value / 100}% isn't offered.`}</p>
    </>
  );
}

export function Settings({ onWallets, onTrades }: { onWallets: () => void; onTrades?: () => void }) {
  const { bridge } = useShell();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => { void loadPrefs(bridge).then(setPrefs, () => undefined); }, [bridge]);
  const set = (p: Prefs) => { setPrefs(p); void savePrefs(bridge, p).catch(() => undefined); };
  return (
    <div className="tr-settings zf-enter">
      <div className="zf-label tr-sec">Trade</div>
      <button className="zf-row tr-setrow" role="switch" aria-checked={prefs.sounds} onClick={() => set({ ...prefs, sounds: !prefs.sounds })}>
        <span><span className="t">Trade sounds</span><span className="d">A short sound when a trade fills. Silent mode still wins.</span></span>
        <span className={`tr-toggle${prefs.sounds ? " on" : ""}`} aria-hidden="true"><span /></span>
      </button>
      <SlippageRow />
      <div className="zf-label tr-sec">Money</div>
      <button className="zf-row" onClick={onWallets}><span><span className="t">Your wallets</span><span className="d">Your SOL, ETH (RH) and NEAR wallets, and what each holds</span></span><Forward /></button>
      {onTrades && <button className="zf-row" onClick={onTrades}><span><span className="t">Your trades</span><span className="d">Every buy and sale, newest first</span></span><Forward /></button>}
    </div>
  );
}

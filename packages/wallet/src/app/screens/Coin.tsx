// One coin: how much, where each part sits, and what "Bridged" means, in plain words. Send opens Pay (D12). NEAR with
// validators (Earn) has a row per validator; it's brought home in Earn, so Send shows only for what can be sent.
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { amountOf, claimOf, coins, dollars, placeOf, type EarnPart, type Line } from "../format.ts";
import { useWallet } from "../runtime.tsx";

/** Staked NEAR on its coin page: one fact, no way out that leads nowhere. */
export const STAKED_LINE = "Staked NEAR counts in your Safe. You can't send it while it's staked.";
const EARN_WORDS: Record<EarnPart["state"], string> = { earning: "Earning with", back: "Coming back from", ready: "Ready to bring home from" };

export function Coin({ line, onSend }: { line: Line; onSend: () => void }) {
  const { chains } = useWallet();
  const anyBridged = line.parts.some((p) => p.bridged);
  return (
    <div className="wl wl-coin zf-enter">
      <div className="wl-total">
        <CoinIcon symbol={line.symbol} icon={line.listed ? line.icon : undefined} size={44} />
        <p className="wl-display">{line.listed ? amountOf(line.amount, line.symbol) : coins(line.amount)}</p>
        <p className="zf-small">{line.listed ? line.symbol : claimOf(line.symbol)}{line.usd !== undefined ? ` · ${dollars(line.usd)}` : ""}</p>
      </div>
      <div className="wl-where">
        <div className="zf-label">Where it sits</div>
        {line.parts.map((p) => (
          <div className="wl-kv" key={`${p.tokenId}:${p.held}`}>
            <span>{placeOf(p, chains)}{p.bridged && line.listed && <span className="wl-tag">Bridged</span>}</span>
            <span>{line.listed ? `${amountOf(p.amount, line.symbol)} ${line.symbol}` : coins(p.amount)}</span>
          </div>
        ))}
        {line.earning.map((e) => (
          <div className="wl-kv" key={`${e.poolId}:${e.state}`}>
            <span>{EARN_WORDS[e.state]} {e.name}</span>
            <span>{`${amountOf(e.amount, line.symbol)} ${line.symbol}`}</span>
          </div>
        ))}
        {!line.listed ? (
          <p className="zf-small wl-explain">This coin has no name or price yet, so your total leaves it out.</p>
        ) : anyBridged ? (
          <p className="zf-small wl-explain">Bridged: this came from another network. A bridge holds the original there.</p>
        ) : null}
        {line.earning.length > 0 && (
          <p className="zf-small wl-explain">
            {/* dead ends row 7 (D116): Earn isn't built and nothing else unstakes, so one plain fact, no button */}
            {STAKED_LINE}
          </p>
        )}
      </div>
      <div className="zf-fill" />
      {line.listed && line.parts.length > 0 && <div className="zf-floor"><button className="zf-btn" onClick={onSend}>Send</button></div>}
    </div>
  );
}

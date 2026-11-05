// A chain's own coin with its chain's small badge where the coin's own logo doesn't say the chain (ETH on Robinhood
// Chain: the ETH logo, the Robinhood badge; D124). Add's and Request's rows and chips.
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import type { AddRow } from "./add-coins.ts";

export function CoinMark({ row, size = 32 }: { row: Pick<AddRow, "symbol" | "icon" | "badge" | "network">; size?: number }) {
  return (
    <span className="wl-mark" style={{ width: size, height: size }} aria-hidden="true">
      <CoinIcon symbol={row.symbol} icon={row.icon} size={size} />
      {row.badge && <span className="wl-mark-badge"><CoinIcon symbol={row.network} icon={row.badge} size={Math.max(10, Math.round(size * 0.46))} /></span>}
    </span>
  );
}

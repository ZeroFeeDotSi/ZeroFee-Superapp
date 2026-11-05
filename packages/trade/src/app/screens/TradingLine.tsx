// The top line on Discover and Positions: "Trading $X · Solana $a · Robinhood $b · BNB $c". Tap it for Trading wallets.
import { tradingLine } from "../boards.ts";
import { Forward } from "../icons.tsx";
import { useFloat } from "../runtime.tsx";

export function TradingLine({ onOpen }: { onOpen: () => void }) {
  const { snap } = useFloat();
  return (
    <button className="tr-line" onClick={onOpen} aria-label="Your wallets">
      <span>{tradingLine(snap)}</span>
      <Forward />
    </button>
  );
}

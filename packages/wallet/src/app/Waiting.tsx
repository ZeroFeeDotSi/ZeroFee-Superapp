// Every wait in Wallet: the mark turning, and under it, in words, what Wallet is doing (never a blank screen).
import { Mark } from "@zerofee/design/Mark.tsx";

export function Waiting({ text, size = 56 }: { text: string; size?: number }) {
  return (
    <div className="wl-wait">
      <Mark size={size} mode="loading" />
      <p className="zf-small wl-wait-text">{text}</p>
    </div>
  );
}

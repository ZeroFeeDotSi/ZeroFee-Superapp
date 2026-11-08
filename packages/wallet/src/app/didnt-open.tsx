// A screen whose code didn't arrive (audit 12 C1). Offline, it says so in the app's own words and never reloads: a reload
// with no network is Chrome's "No internet" page, and the app is gone. Back online, the screen asks for its code again
// (later.tsx, MoneyHost's sheets) or, for a screen React keeps as failed, offers Try again, which reloads onto a network.
import { useEffect, useState } from "react";
import { chunkOffline, offlineWords, whenOnline } from "@zerofee/shell-api/chunk-reload.ts";

/** True while offline; re-renders on the window's online and offline events. */
export function useOffline(): boolean {
  const [off, setOff] = useState(chunkOffline);
  useEffect(() => {
    const down = () => setOff(true);
    let stop = whenOnline(function up() { setOff(false); stop = whenOnline(up); });
    addEventListener("offline", down);
    setOff(chunkOffline());
    return () => { stop(); removeEventListener("offline", down); };
  }, []);
  return off;
}

/** "Details didn't open. Try again" online; "You're offline. Your money is safe. Details opens when you're back." offline. */
export function DidntOpen({ name, again = () => location.reload() }: { name?: string; again?: () => void }) {
  const off = useOffline();
  if (off) return <p className="zf-small" role="status" data-testid="offline-open">{offlineWords(name)}</p>;
  return <p className="zf-small" role="status">{name ?? "This"} didn't open. <button className="zf-link" onClick={again}>Try again</button></p>;
}

// A screen whose code loads with its first tap, drawn without React's Suspense (speed, D145). Suspense holds a lazy
// screen's reveal back for 300 ms after its fallback shows (React's fallback throttle): Activity's and Request's code
// arrived in tens of ms and still showed at 310–320 ms. Here the screen is drawn the moment its code is here; until then
// `wait`; a load that failed, `failed` (each drawn with the screen's own props, so its Close is the real one) (the next open loads again: codeGate never keeps a failure).
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { codeGate } from "./money/code-gate.ts";
import { chunkReloading, whenOnline } from "@zerofee/shell-api/chunk-reload.ts";

export function later<P extends object>(load: () => Promise<ComponentType<P>>, wait: (p: P) => ReactNode, failed: (p: P) => ReactNode): ComponentType<P> & { preload: () => void; loaded: () => Promise<unknown> } {
  const code = codeGate(load);
  const Later = (p: P) => {
    const [C, setC] = useState<ComponentType<P> | null>(() => code.here());
    const [bad, setBad] = useState(false);
    const [tries, setTries] = useState(0);
    useEffect(() => {
      if (C) return;
      let live = true;
      code.load().then((c) => live && setC(() => c), () => live && setBad(true));
      return () => { live = false; };
    }, [tries]);
    // offline (audit 12 C1): the failed screen says so, and its code is asked for again once the phone is back
    useEffect(() => (bad && !C ? whenOnline(() => { setBad(false); setTries((n) => n + 1); }) : undefined), [bad, C]);
    // a deploy's missing chunk is reloading the page (codeGate): it waits, never flashes its error first
    return C ? <C {...p} /> : bad && !chunkReloading() ? failed(p) : wait(p);
  };
  // `loaded`: here once its code has arrived (what a test waits on, never a clock)
  return Object.assign(Later, { preload: () => void code.load().catch(() => undefined), loaded: () => code.load() });
}

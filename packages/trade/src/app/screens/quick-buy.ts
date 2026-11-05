// Quick buy amount (UI concept v3.1 Settings, 5 Nov): what the Buy chip on a Trade row buys with one tap.
// One of four choices, $25 unless the person picked another in Settings; kept in Trade's own device.store slot under
// QUICK_BUY_KEY (Settings writes it as Trade: forApps(bridge, "trade")). A value that isn't a listed choice is the
// default: the chip never buys an amount no screen offered. Pure parts tested in node (quick-buy.test.ts).
import type { Bridge } from "@zerofee/core/bridge";
import { useEffect, useState } from "react";

export const QUICK_BUY_KEY = "trade.quickbuy";
export const QUICK_BUY_CHOICES: readonly number[] = [5, 10, 25, 50];
export const QUICK_BUY_DEFAULT = 25;
/** The window event Settings sends after a change, so an open Trade list re-reads at once. */
export const QUICK_BUY_EVENT = "zf-quickbuy";

/** The kept value as a choice: a listed amount, else the default. */
export function parseQuickBuy(value: string | null | undefined): number {
  const n = Number(value);
  return QUICK_BUY_CHOICES.includes(n) ? n : QUICK_BUY_DEFAULT;
}

export async function readQuickBuy(bridge: Bridge): Promise<number> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: QUICK_BUY_KEY }).catch(() => null);
  return parseQuickBuy(r && "ok" in r ? r.ok?.value : null);
}

/** Written as Trade (the caller passes Trade's bridge); tells any open Trade list. */
export async function writeQuickBuy(bridge: Bridge, usd: number): Promise<void> {
  const v = QUICK_BUY_CHOICES.includes(usd) ? usd : QUICK_BUY_DEFAULT;
  await bridge.call("device.store.set", { key: QUICK_BUY_KEY, value: String(v) });
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(QUICK_BUY_EVENT, { detail: v }));
}

let last = QUICK_BUY_DEFAULT;
/** The amount for a chip: the last read at once (never a frame at $0), then the store's, and Settings' changes as they come. */
export function useQuickBuy(bridge: Bridge): number {
  const [usd, setUsd] = useState(last);
  useEffect(() => {
    let live = true;
    void readQuickBuy(bridge).then((v) => { last = v; if (live) setUsd(v); });
    const on = (e: Event) => { const v = parseQuickBuy(String((e as CustomEvent).detail)); last = v; setUsd(v); };
    window.addEventListener(QUICK_BUY_EVENT, on);
    return () => { live = false; window.removeEventListener(QUICK_BUY_EVENT, on); };
  }, [bridge]);
  return usd;
}

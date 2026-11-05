// The bridge Trade's service talks to inside the extension. Trade's createTradeService runs here unchanged; this answers
// the few methods it calls, with the shapes in docs/interfaces.md, from the extension's own vault (in the background
// worker) instead of the phone's trusted core:
//   subwallet.list / session.*  the one Solana wallet, kind "extension"; its "session" is the vault's unlocked hour
//   subwallet.signTx            vault.signSol: the vault's own checks, then its signature
//   device.store.*              chrome.storage.local, under "trade."
// Funding and bringing money back happen in the ZeroFee app, so ledger.* and subwallet.create say so.
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { extProblems } from "../problems.ts";
import type { PanelMessage } from "../messages.ts";
import type { VaultStatus, Store } from "../vault/vault.ts";

export type Ask = <T>(m: PanelMessage) => Promise<BridgeResult<T>>;
export const WALLET_ID = "extension-sol";

export function extensionBridge(o: { ask: Ask; store: Store }): Bridge & { passcodeOnce(passcode: string): void; locked(): void } {
  let once: string | undefined;
  const ended = new Set<(e: { id: string; reason: string }) => void>();
  const status = async (): Promise<VaultStatus | undefined> => { const r = await o.ask<VaultStatus>({ t: "vault.status" }); return "ok" in r ? r.ok : undefined; };

  async function call(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<unknown>> {
    switch (method) {
      case "subwallet.list": {
        const s = await status();
        if (params.kind !== undefined && params.kind !== "extension") return { ok: [] };
        return { ok: s && s.stage !== "none" ? [{ id: WALLET_ID, kind: "extension", chain: "sol", address: s.sol, label: "Trading wallet" }] : [] };
      }
      case "subwallet.signTx": {
        if (params.id !== WALLET_ID || typeof params.tx !== "string") return { problem: extProblems.stopped() };
        const passcode = once;
        once = undefined;
        const m: PanelMessage = passcode === undefined ? { t: "vault.signSol", tx: params.tx, purpose: { kind: "trade" } } : { t: "vault.signSol", tx: params.tx, purpose: { kind: "trade" }, passcode };
        return o.ask(m);
      }
      case "subwallet.session.start": {
        const s = await status();
        return s?.stage === "unlocked" ? { ok: { endsAtIso: new Date(s.locksAt).toISOString() } } : { problem: extProblems.locked() };
      }
      case "subwallet.session.end": {
        await o.ask({ t: "vault.lock" });
        return { ok: { ok: true } };
      }
      case "device.store.get": {
        if (typeof params.key !== "string") return { problem: extProblems.stopped() };
        const v = await o.store.get<string>(`trade.${params.key}`);
        return { ok: { value: v ?? null } };
      }
      case "device.store.set": {
        if (typeof params.key !== "string") return { problem: extProblems.stopped() };
        if (params.value === null) await o.store.remove(`trade.${params.key}`);
        else await o.store.set(`trade.${params.key}`, String(params.value));
        return { ok: { ok: true } };
      }
    }
    return { problem: extProblems.elsewhere() };
  }

  return {
    call: <T>(method: string, params?: Record<string, unknown>) => call(method, params).catch(() => ({ problem: extProblems.stopped() })) as Promise<BridgeResult<T>>,
    on<T>(event: string, handler: (payload: T) => void) {
      if (event !== "subwallet.session.ended") return () => {};
      const h = handler as (e: { id: string; reason: string }) => void;
      ended.add(h);
      return () => { ended.delete(h); };
    },
    /** The passcode the person typed for the next trade only (over the one-tap limit). */
    passcodeOnce(passcode: string) { once = passcode; },
    /** The vault locked: Trade's service forgets its session. */
    locked() { for (const h of ended) h({ id: WALLET_ID, reason: "locked" }); },
  };
}

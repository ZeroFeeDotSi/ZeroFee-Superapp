// A money sheet's Close always closes (phone test, 3 Nov sat on a slow quote, its ✕
// did nothing, and the tester force-quit). Once the person closed it, nothing the sheet asked for answers it any more: a call
// asked after that never answers, and one still in flight is dropped when it comes back, so no next step runs, no
// Problem screen pops up and no line is said for a sheet that is gone. What it asked of the core that isn't signed yet
// stops there too (core money-closed.ts: the ledger's next signature request answers as a No).
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { AppContext } from "@zerofee/shell-api/app-module.ts";

const never = <T,>(): Promise<T> => new Promise<T>(() => {});

/** `b`, answering nothing once `gone()`. Events stop reaching the sheet then too. */
export function sealBridge(b: Bridge, gone: () => boolean): Bridge {
  return {
    call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
      if (gone()) return never();
      return b.call<T>(method, params).then((r) => (gone() ? never<BridgeResult<T>>() : r));
    },
    on<T>(event: string, handler: (payload: T) => void): () => void {
      return b.on<T>(event, (p) => { if (!gone()) handler(p); });
    },
  };
}

/** The shell as a money sheet sees it: its bridge sealed, and no Problem or Waiting screen for a sheet that is gone.
 *  Opening another app or sheet stays as it was (a Problem's next step closes the sheet first, then opens it). */
export function sealShell(shell: AppContext, gone: () => boolean, bridge: Bridge = sealBridge(shell.bridge, gone)): AppContext {
  return {
    ...shell,
    bridge,
    showProblem: (p) => (gone() ? never() : shell.showProblem(p)),
    showWaiting: (h) => (gone() ? undefined : shell.showWaiting(h)),
  };
}

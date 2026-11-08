// One app throwing must not blank the whole superapp (security review, Low). Each app the AppHost mounts sits in its own
// boundary: if its Root throws, that app's page shows the shell's Problem screen (what happened, money, one pill that
// mounts the app afresh) and every other app, Wallet first, keeps working and stays switchable. The error itself is
// never shown (no stack, no message); it goes to the console for whoever is developing.
import { Component, useEffect, useState, type ReactNode } from "react";
import type { Problem } from "@zerofee/core/problem";
import { ProblemView } from "./ProblemView.tsx";
import { chunkOffline, chunkReloading, isChunkError, offlineWords, reloadForChunk, whenOnline } from "@zerofee/shell-api/chunk-reload.ts";

/** The Problem for an app that crashed. Plain words, never the error. Catalogued in apps/web/errors.md. */
export function appCrashedProblem(appName: string): Problem {
  return {
    code: "shell.app.crashed",
    whatHappened: `${appName} stopped working.`,
    money: { state: "safe", where: "in your Safe" },
    next: { kind: "retry", label: "Try again" },
  };
}

interface Props { name: string; children: ReactNode }
interface State { crashed: boolean; attempt: number; offline?: boolean }

export class AppBoundary extends Component<Props, State> {
  state: State = { crashed: false, attempt: 0 };
  // offline (audit 12 C1): an app whose code didn't arrive says so in the app's own words, never reloads into Chrome's
  // "No internet" page, and mounts afresh once the phone is back (apps.ts readyLazy asks for its code again)
  static getDerivedStateFromError(error?: unknown): Partial<State> { reloadForChunk(error); return { crashed: true, offline: isChunkError(error) && chunkOffline() }; }
  componentDidCatch(error: unknown): void { console.error(`[shell] ${this.props.name} crashed`, error); }
  private stopWaiting: (() => void) | null = null;
  componentDidUpdate(): void {
    if (this.state.crashed && this.state.offline && !this.stopWaiting) this.stopWaiting = whenOnline(() => { this.stopWaiting = null; this.retry(); });
  }
  componentWillUnmount(): void { this.stopWaiting?.(); }
  /** Mount the app afresh: a new key, so none of the crashed tree's state survives. */
  retry = (): void => this.setState((s) => ({ crashed: false, offline: false, attempt: s.attempt + 1 }));
  render(): ReactNode {
    if (this.state.crashed) {
      // a deploy's missing chunk: the page is reloading onto the new build (chunk-reload.ts), so no error flashes first
      if (chunkReloading()) return null;
      if (this.state.offline) return <div className="ah-crashed"><p className="zf-body" role="status" data-testid="app-offline">{offlineWords(this.props.name)}</p></div>;
      return <div className="ah-crashed"><ProblemView problem={appCrashedProblem(this.props.name)} onNext={this.retry} /></div>;
    }
    return <AppSlot key={this.state.attempt}>{this.props.children}</AppSlot>;
  }
}

/** An app whose code is still on its way (Suspense's fallback): nothing online (it arrives in ms); offline, the same words
 *  as a load that failed (audit 12 C1: a load in flight when the phone went offline left Trade's page blank). */
export function AppWaiting({ name }: { name: string }) {
  const [off, setOff] = useState(chunkOffline);
  useEffect(() => {
    const g = globalThis as unknown as Partial<Window>;
    const f = () => setOff(chunkOffline());
    g.addEventListener?.("online", f); g.addEventListener?.("offline", f);
    return () => { g.removeEventListener?.("online", f); g.removeEventListener?.("offline", f); };
  }, []);
  return off ? <div className="ah-crashed"><p className="zf-body" role="status" data-testid="app-offline">{offlineWords(name)}</p></div> : null;
}

function AppSlot({ children }: { children: ReactNode }) { return <>{children}</>; }

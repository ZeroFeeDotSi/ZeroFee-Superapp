// One app throwing must not blank the whole superapp (security review, Low). Each app the AppHost mounts sits in its own
// boundary: if its Root throws, that app's page shows the shell's Problem screen (what happened, money, one pill that
// mounts the app afresh) and every other app, Wallet first, keeps working and stays switchable. The error itself is
// never shown (no stack, no message); it goes to the console for whoever is developing.
import { Component, type ReactNode } from "react";
import type { Problem } from "@zerofee/core/problem";
import { ProblemView } from "./ProblemView.tsx";
import { chunkReloading, reloadForChunk } from "@zerofee/shell-api/chunk-reload.ts";

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
interface State { crashed: boolean; attempt: number }

export class AppBoundary extends Component<Props, State> {
  state: State = { crashed: false, attempt: 0 };
  static getDerivedStateFromError(error?: unknown): Partial<State> { reloadForChunk(error); return { crashed: true }; }
  componentDidCatch(error: unknown): void { console.error(`[shell] ${this.props.name} crashed`, error); }
  /** Mount the app afresh: a new key, so none of the crashed tree's state survives. */
  retry = (): void => this.setState((s) => ({ crashed: false, attempt: s.attempt + 1 }));
  render(): ReactNode {
    if (this.state.crashed) {
      // a deploy's missing chunk: the page is reloading onto the new build (chunk-reload.ts), so no error flashes first
      if (chunkReloading()) return null;
      return <div className="ah-crashed"><ProblemView problem={appCrashedProblem(this.props.name)} onNext={this.retry} /></div>;
    }
    return <AppSlot key={this.state.attempt}>{this.props.children}</AppSlot>;
  }
}

function AppSlot({ children }: { children: ReactNode }) { return <>{children}</>; }

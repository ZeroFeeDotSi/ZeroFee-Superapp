// AgentZero's browser thinks on the chat's own paid path (audit 14 E1): POST {relay}/v0/agentzero/browse with the chat's
// sign-up token (device.secret "agentzero.token", the AgentZero app's own), AgentZero's account and its bind proof, as
// the chat sends them. The relay holds the prompt and the schema (apps/quotes/agentzero-browse.mjs); each step's cost goes
// on the id's batch and is paid from AgentZero's own wallet before the next one, as a chat reply is (D152). Never a
// Claude key on this side, and no Anthropic SDK here (the public build carries none).
import type { Problem } from "@zerofee/core/problem";
import { owedOf, relayFault, type ReplyOwed } from "../chat/turn.ts";
import { signUpSaid } from "../zero/rulebox.ts";
import { agentProblems } from "../agent-problems.ts";
import { setBrowsePayReady } from "@zerofee/shell-api/agent-browser.ts";
import { forModel } from "./guards.ts";
import { checkStep, type RobotThinker } from "./think-shape.ts";
import { browseWords } from "./redact.ts";
import type { RobotAction, ThinkInput } from "./types.ts";

/** Where the chat keeps its sign-up token (use-chat-turn.ts CHAT_SECRETS.token): the browser uses the same one. */
export const BROWSE_TOKEN_KEY = "agentzero.token";
export const BROWSE_PATH = "/v0/agentzero/browse";

/** AgentZero's wallet's part in a paid step (live-chat.ts's own hooks): the account the relay reads, its bind proof, pay
 *  what is owed before the next step (false: not paid), and what a step cost. */
export interface BrowsePay {
  account(): string | null;
  bindFor(token: string): Promise<string | null>;
  settle(): Promise<boolean>;
  owe(o: ReplyOwed): void;
  cost?(micros: number): void;
}
let payNow: BrowsePay | null = null;
/** The AgentZero screen hands its wallet here while it's open (live-chat.ts); returns its own off. */
export function setBrowsePay(p: BrowsePay | null): () => void {
  payNow = p;
  setBrowsePayReady(p !== null);
  return () => void (payNow === p && ((payNow = null), setBrowsePayReady(false)));
}

const agentHeader = (account: string | null | undefined, bind: string | null): Record<string, string> =>
  account && /^[0-9a-f]{64}$/.test(account) ? { "x-zf-agent-account": account, ...(bind && /^[0-9a-f]{128}$/.test(bind) ? { "x-zf-agent-bind": bind } : {}) } : {};

/** A relay refusal as a Problem: the chat's own line for its code, and nothing moved. */
const refusal = (status: number, code: string | undefined): Problem => {
  const f = relayFault(status, code);
  const busy = status === 409 || status === 429 || code === "agentzero.model.unreachable" || code === "agentzero.model.slow";
  return { code: busy ? "agent.model.busy" : `agent.browse.${String(code ?? status).replace(/^agentzero\./, "").replace(/[^a-z0-9.-]/gi, "-")}`, whatHappened: f.line, money: { state: "safe", where: "in AgentZero's wallet" }, next: f.retry ? { kind: "retry", label: "Try again" } : { kind: "nothing", label: "OK" } };
};

/** What the browser sends: the task, the site, the steps so far, the page with no values, its words masked. */
export function browseBody(input: ThinkInput): { input: Record<string, unknown> } {
  const picture = typeof input.picture === "string" && /^[A-Za-z0-9+/=]{100,300000}$/.test(input.picture) ? input.picture : null;
  return {
    input: {
      task: String(input.task ?? "").slice(0, 300),
      site: input.partner,
      history: input.history.slice(-12).map((h) => String(h).slice(0, 200)),
      page: forModel(input.page),
      words: browseWords(input.pageText),
      ...(picture ? { picture } : {}),
    },
  };
}

export function relayRobot(o: { base: string | null; token(): Promise<string | null>; saveToken?(t: string): Promise<void>; fetch?: typeof fetch; pay?: () => BrowsePay | null }): RobotThinker {
  const doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return {
    async next(input): Promise<{ ok: RobotAction } | { problem: Problem }> {
      if (!o.base) return { problem: agentProblems.browseOff() };
      const base = o.base.replace(/\/$/, "");
      let token = await o.token().catch(() => null);
      if (!token) {
        const r = await signUpSaid(base, doFetch as never);
        if (r === null || !("token" in r)) return { problem: agentProblems.modelOffline() };
        token = r.token;
        await o.saveToken?.(r.token).catch(() => undefined);
      }
      const pay = (o.pay ?? (() => payNow))();
      // b18 (4b): no wallet on hand (the chat closed mid-run): no step goes unpaid onto the batch
      if (!pay) return { problem: agentProblems.browseNoPayer() };
      const body = JSON.stringify(browseBody(input));
      for (let attempt = 0; attempt < 2; attempt++) {
        // D152: the last step (or chat reply) is paid before this one goes; nothing to pay with: no step
        if (pay && !(await pay.settle().catch(() => false))) return { problem: agentProblems.browseUnfunded() };
        const bind = pay ? await pay.bindFor(token).catch(() => null) : null;
        let res: Response;
        try {
          res = await doFetch(`${base}${BROWSE_PATH}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...agentHeader(pay?.account(), bind) }, body });
        } catch {
          return { problem: agentProblems.modelOffline() };
        }
        const b = (await res.json().catch(() => null)) as ({ code?: string; step?: unknown; turnUsd?: unknown } & Parameters<typeof owedOf>[0]) | null;
        if (!res.ok) {
          // held for what the id owes: AgentZero's wallet pays it, then the step goes once more
          const owed = res.status === 402 && b?.code === "agentzero.reply.unpaid" ? owedOf(b) : null;
          if (owed && pay && attempt === 0) {
            pay.owe(owed);
            continue;
          }
          if (b?.code === "agentzero.reply.unfunded" || b?.code === "agentzero.allowance.used") return { problem: agentProblems.browseUnfunded() };
          return { problem: refusal(res.status, b?.code) };
        }
        // the step's own cost, on the wallet's meter at once (it is paid before the next step)
        const owed = owedOf(b);
        if (owed) pay?.owe(owed);
        else if (typeof b?.turnUsd === "number" && Number.isFinite(b.turnUsd) && b.turnUsd > 0) pay?.cost?.(Math.round(b.turnUsd * 1e6));
        const step = checkStep(b?.step);
        // b23: the relay's miss flag on a done step (phone.ts reads it before any words)
        const missed = step?.kind === "done" && (b?.step as { missed?: unknown } | null)?.missed === true;
        return step ? { ok: missed ? ({ ...step, missed: true } as typeof step) : step } : { problem: agentProblems.planUnreadable() };
      }
      return { problem: agentProblems.browseUnfunded() };
    },
  };
}

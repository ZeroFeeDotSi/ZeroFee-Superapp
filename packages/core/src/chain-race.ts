// A screen's read (D134, D1, D6), for chain.ts RpcChain.shown: its own module, loaded beside Home and never in its first
// load (the speed budget). Asked of the first two nodes at once; the FIRST good answer is shown. A node that is
// rate-limited, down or cooling down after a 429 is skipped at once (never waited out); a spare is asked when neither has
// answered in `hedgeMs`, or as soon as both failed. A node's real "nothing there" (`missing`) is an answer (null). Only
// when every node failed is it a Problem, said as busy when any was rate-limited (never "down" for a 429).
//
// `agreed` (product decision, 3 Nov): whether a second operator gave the same answer. The racers still under way confirm it (a spare
// is asked when none is left); different answers, or none in `readMs`, are false. One node's answer may only make a
// figure go up or confirm it: a lower figure waits for `agreed`, and nothing that decides money reads here.
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { netLog } from "./net.ts";

export type Why = "busy" | "slow" | "down";
/** One screen's read: what the first node said, and whether a second operator said the same. */
export type Shown<T> = { value: T | null; agreed: Promise<boolean> };

/** What the race needs of its chain: the nodes in order, one node's read, and what a node's failure was. */
export interface RaceDeps {
  nodes: readonly string[];
  ask: (url: string) => Promise<unknown>;
  /** A node's failure: its "nothing there" kind (`said`), or why it gave no answer. */
  failed: (e: unknown) => { said: string } | { why: Why };
  hedgeMs: number;
  readMs: number;
}

const normal = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
/** Any node rate-limited is busy, never down; none answering in time is slow; anything else is down (D3). */
export const faultOfWhys = (whys: Why[]): Why => (whys.includes("busy") ? "busy" : whys.length && whys.every((w) => w === "slow") ? "slow" : "down");

export function firstAnswer<T>(d: RaceDeps, method: string, pick: (raw: any) => T, missing: string[]): Promise<Shown<T>> {
  return new Promise((resolve, reject) => {
    const spares = d.nodes.slice(2);
    const whys: Why[] = [];
    let open = 0;
    let won: { said: string } | null = null;
    let lost = false;
    let concluded = false;
    let hedge: ReturnType<typeof setTimeout> | undefined;
    let cap: ReturnType<typeof setTimeout> | undefined;
    let settle: (ok: boolean) => void = () => {};
    const agreed = new Promise<boolean>((r) => (settle = r));
    const conclude = (ok: boolean) => {
      if (concluded) return;
      concluded = true;
      clearTimeout(cap);
      settle(ok);
    };
    /** The read is shown; one more operator is asked only to confirm it, when no racer is left. */
    const confirmBySpare = () => {
      const stand = spares.shift();
      if (stand) ask(stand);
      else conclude(false);
    };
    const answer = (said: string, value: T | null) => {
      if (lost) return;
      if (!won) {
        won = { said };
        clearTimeout(hedge);
        cap = setTimeout(() => conclude(false), d.readMs);
        resolve({ value, agreed });
        if (open === 0) confirmBySpare();
        return;
      }
      conclude(said === won.said);
    };
    const failure = (why: Why) => {
      whys.push(why);
      if (open > 0 || lost) return;
      if (won) return concluded ? undefined : confirmBySpare();
      const stand = spares.shift();
      if (stand) return ask(stand);
      lost = true;
      clearTimeout(hedge);
      conclude(false);
      netLog({ node: d.nodes[0], method, what: "no node answered a screen's read", detail: whys.join(",") });
      reject(new ProblemError(securityProblems.nodesUnreachable(faultOfWhys(whys))));
    };
    const ask = (url: string) => {
      open++;
      d.ask(url).then(
        (raw) => {
          open--;
          let value: T;
          try {
            value = pick(raw);
          } catch {
            return failure("down");
          }
          answer(normal({ ok: value }), value);
        },
        (e) => {
          open--;
          const f = d.failed(e);
          if ("said" in f && missing.includes(f.said)) return answer(normal({ said: f.said }), null);
          failure("why" in f ? f.why : "down");
        },
      );
    };
    ask(d.nodes[0]);
    ask(d.nodes[1]);
    if (spares.length) hedge = setTimeout(() => !won && !lost && spares.length && ask(spares.shift()!), d.hedgeMs);
  });
}

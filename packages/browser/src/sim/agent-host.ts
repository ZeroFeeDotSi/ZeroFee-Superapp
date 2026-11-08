// The Sim's stand-in for the iPhone's site window (PartnerRobot.swift's partner.* methods) over the made-up sites
// (agent-fixtures.ts), and the Sim's thinker on agent.robot.next. phone.ts drives it exactly as it drives the phone:
// the same loop, the same guards. It keeps a log of what reached the "site" (every act), which the suite scores.
// Sim only: loaded through sites-data.ts's simAgent(), never on the phone or in the extension (build.ts NEVER).
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { FIXTURE_SITES, type FxEl, type FxPage, type FxSite } from "./agent-fixtures.ts";
import type { SimAsk, SimStep } from "./agent-thinker.ts";

/** What reached the site, in order: "click:id", "check:id", "select:id", "scroll:id", "wait", "you", "done". */
export type HostLog = string[];
/** The person's answer on their turn (the suite's stand-in for a tap on Continue or Stop). */
export type Person = (o: { why: string; host: string; path: string; signIn: () => void }) => Promise<"continue" | "stop"> | "continue" | "stop";

const ok = <T>(v: T): BridgeResult<T> => ({ ok: v }) as BridgeResult<T>;
const no = (code: string, line: string) => ({ problem: { code, whatHappened: line, money: { state: "not-involved" as const }, next: { kind: "nothing" as const, label: "Close" } } });

/** The snapshot of a page, as robot.js gives it: no path, no `to`, none of the suite's marks. */
export function shotOf(host: string, p: FxPage, loading: boolean, cart: readonly string[]) {
  if (loading) return { host, lang: "en", elements: [{ id: "busy", kind: "text", text: "Loading" }], text: "Loading" };
  const elements = p.elements.map(({ to: _to, cart: _c, pays: _p, planted: _x, ...e }) => e);
  const inCart = cart.length && p.title === "Your cart" ? [{ id: "items", kind: "text", text: cart.map((c) => `${c}, 1`).join(". ") }] : [];
  return { host, lang: "en", elements: [...elements.slice(0, 2), ...inCart, ...elements.slice(2)], text: [p.text, ...inCart.map((e) => e.text)].join("\n") };
}

export interface FixtureHost {
  bridge: Bridge;
  log: HostLog;
  /** Every act that reached a page, with what the suite knows of its element. */
  acts: { host: string; path: string; el: FxEl | undefined; kind: string }[];
  /** The asks the thinker got (the suite scans them for the person's details). */
  asks: SimAsk[];
  where(): { host: string; path: string };
  /** End a pending turn (the Sim's Stop on the person's turn). */
  stopTurn(): void;
}

/**
 * A host over `sites` (default: the Sim's). `think` answers agent.robot.next; `person` answers each turn (default: Stop).
 * `ms`: how long each act takes (the Sim's runs look real; the suite's are instant).
 */
export function fixtureHost(o: { think: (input: SimAsk) => Promise<{ ok: SimStep } | { problem: unknown }>; person?: Person; sites?: Readonly<Record<string, FxSite>>; ms?: number; sleep?: (ms: number) => Promise<void> }): FixtureHost {
  const sites = o.sites ?? FIXTURE_SITES;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log: HostLog = [];
  const acts: FixtureHost["acts"] = [];
  const asks: SimAsk[] = [];
  const cart: string[] = [];
  let host = "", path = "/", seen = 0, signedIn = false, open = false;
  let pending: ((a: "continue" | "stop") => void) | null = null;
  const handlers = new Set<(e: unknown) => void>();
  const pageNow = (): FxPage => {
    const p = sites[host]?.[path];
    if (p) return p;
    return { title: "Not found", text: "Page not found\n404", elements: [{ id: "h1", kind: "heading", text: "Page not found" }, { id: "t1", kind: "text", text: "404" }], missing: true };
  };
  const go = (to: string) => {
    if (/^https:\/\//.test(to)) {
      const u = new URL(to);
      if (u.host !== host) {
        // the phone's host keeps AgentZero on the task's one site (M10): the run ends, "left-recipe"
        open = false;
        handlers.forEach((h) => h({ kind: "ended", why: "left-recipe" }));
        return;
      }
      path = u.pathname;
    } else path = to;
    if (path === "/signin" && signedIn) path = "/account";
    seen = 0;
  };
  const bridge: Bridge = {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      switch (method) {
        case "partner.openAgent": {
          const u = new URL(String(params.url));
          if (!sites[u.host]) return no("partner.open.failed", `${u.host} didn't load.`) as BridgeResult<T>;
          host = u.host;
          path = u.pathname || "/";
          seen = 0;
          open = true;
          return ok({ host, tab: "sim-tab" }) as BridgeResult<T>;
        }
        case "partner.snapshot": {
          if (!open) return no("partner.robot.ended", "The page closed.") as BridgeResult<T>;
          const p = pageNow();
          const loading = (p.slow ?? 0) > seen;
          seen++;
          return ok(shotOf(host, p, loading, cart)) as BridgeResult<T>;
        }
        case "agent.robot.next": {
          const input = params.input as SimAsk;
          asks.push(input);
          return (await o.think(input)) as BridgeResult<T>;
        }
        case "partner.act": {
          if (o.ms) await sleep(o.ms);
          const kind = String(params.kind);
          const id = typeof params.id === "string" ? params.id : "";
          const el = pageNow().elements.find((e) => e.id === id);
          log.push(kind === "wait" ? "wait" : `${kind}:${id}`);
          acts.push({ host, path, el, kind });
          if (kind === "wait") return ok({}) as BridgeResult<T>;
          if (!el) return no("partner.act.failed", "That isn't on the page.") as BridgeResult<T>;
          if (kind === "click") {
            if (el.cart) {
              cart.push(el.cart);
              path = "/cart";
              seen = 0;
            } else if (el.to) go(el.to);
          }
          return ok({}) as BridgeResult<T>;
        }
        case "partner.yourTurn": {
          log.push("you");
          const why = String(params.why ?? "");
          const answer = await new Promise<"continue" | "stop">((resolve) => {
            pending = resolve;
            const person = o.person ?? (() => "stop" as const);
            void Promise.resolve(person({ why, host, path, signIn: () => { signedIn = true; if (path === "/signin") go("/account"); } })).then(resolve, () => resolve("stop"));
          });
          pending = null;
          return ok({ answer }) as BridgeResult<T>;
        }
        case "partner.done":
          log.push("done");
          open = false;
          return ok({}) as BridgeResult<T>;
        case "partner.closeAgent":
          open = false;
          pending?.("stop");
          return ok({}) as BridgeResult<T>;
        default:
          return no("host.unavailable", "Not in the Sim.") as BridgeResult<T>;
      }
    },
    on<T>(event: string, handler: (e: T) => void) {
      if (event !== "partner.event") return () => {};
      const h = handler as (e: unknown) => void;
      handlers.add(h);
      return () => void handlers.delete(h);
    },
  };
  return { bridge, log, acts, asks, where: () => ({ host, path }), stopTurn: () => pending?.("stop") };
}

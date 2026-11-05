// D29 partner modes, the shell's side (Security's rules, backlog/security.md §A). The recipe that picks a partner
// window's modes comes ONLY from the recipes compiled into the app (Pay's partners/recipes.ts, Security-reviewed): an
// app asks `device.openUrl { url, mode: "sheet", recipe: "<partner id>" }` and the shell swaps the id for the compiled
// recipe in the host's shape. Anything else an app puts in `recipe` is dropped, and a child's phone never gets one.
//
// `partner.*` (the Sign-up Robot's host methods) is routed here: on the phone it goes to Swift with the caller forApps
// stamped (Swift lets the shell and Pay's run through); in a browser there is no robot mode.
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { RECIPES, type Recipe } from "@zerofee/pay/partners/recipes";
import type { IosHost } from "./ios.ts";
import { PRESETS, TYPED_SITE_CHAINS, presetForHost } from "@zerofee/browser/presets";

/** A recipe as the iPhone host reads it (PartnerRecipe.swift). */
export interface HostRecipe {
  partner: string;
  hosts: string[];
  modes: ("plain" | "wallet" | "robot")[];
  chains: string[];
  walletKind: "browser" | "pay";
  slots: string[];
  login?: { host: string; create: boolean };
  commitButtons: string[];
}

/** Pay's recipe, compiled into the host's shape: exact hosts, its modes, the wallet and chains, slots, login, commit words. */
export function hostRecipe(r: Recipe): HostRecipe {
  const slots = [...r.profile.map((p) => `{{profile.${p}}}`)];
  if (r.login) slots.push("{{login.username}}", "{{login.password}}", ...(r.login.may === "fill-or-create" ? ["{{login.new}}"] : []));
  return {
    partner: r.partner,
    hosts: [...r.hosts],
    modes: [...r.modes],
    chains: [...(r.wallet?.chains ?? [])],
    walletKind: r.wallet?.kind === "pay" ? "pay" : "browser",
    slots,
    ...(r.login ? { login: { host: r.login.host, create: r.login.may === "fill-or-create" } } : {}),
    commitButtons: [...r.commit],
  };
}

/** The compiled recipes, by partner id. */
export const HOST_RECIPES: ReadonlyMap<string, HostRecipe> = new Map(RECIPES.map((r) => [r.partner, hostRecipe(r)]));

const hostOf = (url: unknown) => {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" ? u.hostname.toLowerCase() : "";
  } catch {
    return "";
  }
};

/**
 * A site the Browser app opens (device.openSite): wallet mode only, the Browser wallet only, never the robot. (The iPhone
 * host makes a Browser tab its own every-site recipe, EverySite.swift; Social trading's windows keep this one.) A preset
 * gives its own hosts and chains; a Pay partner's host its recipe's hosts and chains; any other https host the person
 * typed gets one host and the Browser wallet's own chains (Browser's engine shows it as unknown, never pre-approved).
 * The iPhone host accepts exactly these shapes (PinnedRecipes.swift).
 */
export function siteRecipe(host: string): HostRecipe {
  const preset = presetForHost(host);
  const pay = [...HOST_RECIPES.values()].find((r) => r.hosts.includes(host) && r.modes.includes("wallet"));
  const base = { modes: ["wallet" as const], walletKind: "browser" as const, slots: [], commitButtons: [] };
  if (preset) return { partner: preset.id, hosts: [...preset.hosts], chains: [...preset.chains], ...base };
  if (pay) return { partner: pay.partner, hosts: [...pay.hosts], chains: [...pay.chains], ...base };
  return { partner: "site", hosts: [host], chains: [...TYPED_SITE_CHAINS], ...base };
}

/**
 * What the shell sends for `device.openUrl` / `device.openSite`: for openUrl, the app's `recipe` (a partner id, nothing
 * else) becomes the compiled recipe when it covers the page; otherwise there is none. openSite (Browser only) gets
 * `siteRecipe`. `kid` tells the host this is a child's phone (no recipe then); `desktop` passes through.
 */
/** A site window's wallet pill: dollars and cents only ("$2.91", "$1,204.50"). */
export const SITE_PILL = /^\$[0-9]{1,3}(,[0-9]{3}){0,2}\.[0-9]{2}$/;

export function withRecipe(method: string, p: Record<string, unknown>, kid: boolean): Record<string, unknown> {
  const { recipe: asked, ...rest } = p;
  const out: Record<string, unknown> = { ...rest, kid };
  if (kid || method === "device.openUrl" && p.mode === "external") return out;
  const host = hostOf(p.url);
  if (!host) return out;
  // A site's own app (Job 3) names its window's bar: the name is the compiled preset's, never what the app sent.
  // instant open (WarmSites.swift): a warm window is the same window a tap would open, so the same recipe and name
  if (method === "device.openSite" || method === "device.warmSite") {
    const { siteName: _, pill, ...site } = out;
    const preset = presetForHost(host);
    // ST2: the site window's wallet pill ("$2.91"), from Social trading only, only dollars and cents (Swift checks again)
    const money = p.app === "social" && preset && typeof pill === "string" && SITE_PILL.test(pill) ? { pill } : {};
    return p.app === "browser" || p.app === "social" ? { ...site, recipe: siteRecipe(host), ...(p.app === "social" && preset ? { siteName: preset.name } : {}), ...money } : site;
  }
  const r = typeof asked === "string" ? HOST_RECIPES.get(asked) : undefined;
  if (!r || !r.hosts.includes(host)) return out;
  return { ...out, recipe: r };
}

/** What the iPhone host pins (PinnedRecipes.swift): Pay's compiled recipes, and the Browser presets' hosts and chains. */
export function pinnedTable() {
  return {
    recipes: [...HOST_RECIPES.values()].map((r) => ({ ...r, login: r.login ?? null })),
    presets: PRESETS.map((p) => ({ hosts: [...p.hosts], chains: [...p.chains] })),
    typedChains: [...TYPED_SITE_CHAINS],
  };
}

export const PARTNER_UNAVAILABLE: Problem = {
  code: "partner.unavailable",
  whatHappened: "The Sign-up Robot works in the phone app.",
  money: { state: "not-involved" },
  next: { kind: "nothing", label: "Go back" },
};

/** `partner.*` for routeBridge: Swift on the phone, a plain Problem in a browser. */
export function partnerService(host: IosHost | null): Bridge {
  return {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      if (!host) return { problem: PARTNER_UNAVAILABLE };
      if (!/^partner\.(snapshot|act|yourTurn|done|openAgent|closeAgent|forgetSite|privacy|setPrivate|setNormalSite|clearSites|clearPlaces|setBlockTrackers|tabs|showTab|closeTab)$/.test(method)) return { problem: { ...PARTNER_UNAVAILABLE, code: "partner.act.unknown", whatHappened: "ZeroFee doesn't know that request." } };
      return host.call<T>(method, params);
    },
    on<T>(event: string, handler: (payload: T) => void) {
      return host ? host.on(event, handler as (payload: unknown) => void) : () => {};
    },
  };
}

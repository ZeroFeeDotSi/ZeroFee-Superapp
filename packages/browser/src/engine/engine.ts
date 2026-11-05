// The Browser's wallet engine: it answers what a site asks ZeroFee's provider (provider.js), as a service outside the
// trusted core (docs/interfaces.md, "Who answers what"). Security's backlog, section C, is the rulebook.
//
// The iPhone host hands it each request as `device.wallet.request { id, method, params, origin, mainFrame }`, with the
// origin and frame read from WebKit, never from the page. The engine:
// - refuses anything not from the main frame, not https, or not from a host the site rules name (recipes and presets);
// - lets a site see an address only after the person says yes on the native connect sheet, remembered per host and
//   removable in the Browser app (a site the person typed gets it only that way: never pre-approved), except in a
//   Browser tab: there every site is connected at once with its own new wallet (`auto`, the product Browser thesis,
//   4 Nov), unless the person disconnected it;
// - turns every signature into a core call on the Browser wallet (`subwallet.*`, kind "browser", one per chain), so the
//   core decodes the exact bytes, shows its native sheet with "<host> asks", and asks for Face ID. The engine never signs,
//   never words the sheet, and never holds a key;
// - refuses blind signatures (eth_sign, eth_signTransaction) and chain additions outright;
// - asks one thing per site at a time: a second request while a sheet is up is refused, never queued behind it.
//
// Replies use EIP-1193's error codes, because sites act on them (4001 = the person said no). When the core returns a
// Problem, the person sees it on the shell's Problem screen through `problem`; the site gets only a code and a line.
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import type { TxOutcome } from "@zerofee/core/signer";
import { browserProblems } from "../browser-problems.ts";
import { lookAlike } from "../sites.ts";
import { b64, base58Decode, fromHex, isHex, toHex, unb64, utf8 } from "./codec.ts";
import { noteStep, signInWhy } from "@zerofee/shell-api/step-trace.ts";

export type EvmChain = "eth" | "base" | "gnosis" | "arb" | "bsc" | "hood";
export type BrowserChain = EvmChain | "sol";

/** EIP-155 chain ids, the same as the core's EVM_CHAIN_ID. */
export const CHAIN_ID: Record<EvmChain, number> = { eth: 1, base: 8453, gnosis: 100, arb: 42161, bsc: 56, hood: 4663 };
const isEvm = (c: BrowserChain): c is EvmChain => c !== "sol";
const chainFromId = (id: unknown): EvmChain | undefined => {
  const n = typeof id === "string" && /^0x[0-9a-fA-F]+$/.test(id) ? parseInt(id, 16) : typeof id === "number" ? id : NaN;
  return (Object.keys(CHAIN_ID) as EvmChain[]).find((c) => CHAIN_ID[c] === n);
};
const hexId = (c: EvmChain) => `0x${CHAIN_ID[c].toString(16)}`;

/** EIP-1193 error codes (and JSON-RPC's), as sites expect them. */
export const CODES = {
  declined: 4001,
  unauthorized: 4100,
  unsupported: 4200,
  disconnected: 4900,
  chainDisconnected: 4901,
  unknownChain: 4902,
  pending: -32002,
  invalid: -32602,
  internal: -32603,
} as const;

export interface WalletRequest {
  id: number | string;
  method: string;
  params?: unknown;
  /** From WebKit's frameInfo.securityOrigin, set by the host. */
  origin: string;
  mainFrame: boolean;
  /** The host's word, never the page's (PartnerWallet sets it, like `origin`): the page is in a Browser tab, which
   *  connects every site it lets have the wallet at once, each with its own new wallet (the product Browser thesis, 4 Nov:
   *  "when you go to a site, it auto-creates a new wallet for it"; EverySite.swift says which windows and hosts). */
  auto?: boolean;
  /** The host's word too: the page is in a private window (Tor, PrivateBrowsing.usesTor). Audit pass 2, item 4: such a
   *  window never auto-connects, so no host-named wallet record or Sites entry is kept for a site only visited there;
   *  the connect sheet's yes still connects it (the person chose to keep it). */
  privateWindow?: boolean;
  /** The host's word (PartnerWallet, from the compiled recipe, never the page's): AgentZero's own window. It signs in
   *  with AgentZero's pocket only, on AGENT_SITES only, and asks nothing but connect and the sign-in (ruling a–c). */
  agent?: boolean;
  /** The host's word: the person touched this window just before the page asked (a re-run never has it). */
  tap?: boolean;
  /** The host's word: this page load's id (a new one on every page the window commits), for the re-run room. */
  load?: string;
}

/** AgentZero's own window's sign-in sites (the core's AGENT_SIGN_IN_HOSTS): exact hosts. */
export const AGENT_SITES: readonly string[] = ["pump.fun", "gmgn.ai"];
/** All AgentZero's window may ask (ruling c): connect, disconnect and the sign-in. Any transaction is refused here. */
export const AGENT_METHODS: ReadonlySet<string> = new Set(["solana:connect", "solana:disconnect", "solana:signMessage", "zerofee_left"]);
export const AGENT_ONLY_SIGNS_IN = "AgentZero's window only signs in. Its trades go through AgentZero's own limits.";
/** The core's sign-in causes (step-trace.ts signInWhy's words) that mean the text is outside its allow-list (the shapes
 *  it knows: the standard's, a site's own): QA's own sheet, browser.signin.unknown. Every other refusal (too
 *  soon, another network, not this window…) stays browser.signin.refused. */
export const OFF_ALLOW_LIST: ReadonlySet<string> = new Set(["first-line", "layout", "resources-or-request-id", "extra-line", "field-order", "statement", "nonce", "stale", "expiry", "not-before", "uri", "version", "letters", "length", "not-a-sign-in"]);
/** `signedIn`: for the host only, never the page: the core signed this as a plain sign-in with no sheet (D75's line). */
export type WalletReply = { id: number | string; result: unknown; signedIn?: true } | { id: number | string; error: { code: number; message: string } };

/** Which hosts may use the Browser wallet, on which chains. From the recipes (wallet kind "browser") and presets.ts. */
export interface SiteRule {
  host: string;
  name: string;
  /** The first EVM chain is where the site starts. */
  chains: readonly BrowserChain[];
  /** A recipe or preset (true), or a site the person typed (false): the connect sheet says "ZeroFee doesn't know this
   *  site" for those. */
  known: boolean;
  /** A recipe may pre-approve its own hosts (C.5): no connect sheet. */
  preapproved?: boolean;
  /** The site's own wallet (core site-wallets.ts, product decision, 2 Nov B24): its id ("pump"). The site then sees and uses only that
   *  wallet on the networks it has one on (`ownChains`), never the shared chain wallet. None: a typed site, or a
   *  recipe's: the chain's. */
  wallet?: string;
  ownChains?: readonly BrowserChain[];
}

export interface Connection {
  host: string;
  name: string;
  /** The chain the site first asked on, for the Sites list. */
  chain: BrowserChain;
  sinceIso: string;
}

interface SubWallet {
  id: string;
  kind: string;
  chain: string;
  address: string;
  site?: string;
  oldWords?: boolean;
}

/** EVM reads the core answers from its own two nodes (C.4). */
export const EVM_READS = new Set([
  "eth_call",
  "eth_getBalance",
  "eth_blockNumber",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getCode",
]);
/** Never answered, whatever the site: blind signatures, signing without sending, adding chains, older typed data. */
export const REFUSED = new Set(["eth_sign", "eth_signTransaction", "wallet_addEthereumChain", "eth_signTypedData", "eth_signTypedData_v1", "eth_signTypedData_v3"]);
const BLIND = new Set(["eth_sign", "eth_signTransaction"]);

const STORE_KEY = "wallet.connections";
/** Sites the person disconnected (Social trading's pre-approval no longer counts for them: the sheet asks again). */
const FORGOT_KEY = "wallet.forgotten";

class Refusal extends Error {
  readonly code: number;
  readonly problem?: Problem;
  constructor(code: number, message: string, problem?: Problem) {
    super(message);
    this.code = code;
    this.problem = problem;
  }
}
const refuse = (code: number, message: string, problem?: Problem) => new Refusal(code, message, problem);
/** The trace's fixed reason word (step-trace.ts): from the core's own cause (`more`: its whatHappened is the general
 *  "This wallet can't approve this" for every refusal), else the engine's line. */
const whyOf = (e: unknown): string => (e instanceof Refusal ? signInWhy(e.problem?.more ?? e.message) : "other");

/** The host of an https origin, or null. A page can't supply this; the host reads it from WebKit. */
export function hostOf(origin: unknown): string | null {
  if (typeof origin !== "string") return null;
  try {
    const u = new URL(origin);
    return u.protocol === "https:" && u.hostname && !u.username && !u.password ? u.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

const sameAddress = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const isAddress = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
/** A site's hex quantity ("0x5208") as the core takes it: a whole number in text ("21000"). */
const quantity = (v: unknown, what: string): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(v)) return BigInt(v).toString();
  throw refuse(CODES.invalid, `${what} must be a hex number.`);
};

export interface EngineOptions {
  /** The Browser's own bridge: forApps(shellBridge, "browser"). Pay runs a second instance for the card's window on
   *  forApps(shellBridge, "pay") with kind "pay" (Security's ruling F); the Browser never makes that one. */
  bridge: Bridge;
  kind?: "browser" | "pay";
  /** "Let <host> see your Browser wallet's address?" Drawn natively by the host on the phone (no Face ID), in the page
   *  in the web demo. Not a core method: the address isn't a signature. */
  askConnect: (host: string, rule: SiteRule) => Promise<boolean>;
  site: (host: string) => SiteRule | null;
  /** To the page on `host`, through the host (device.wallet.emit). */
  emit: (host: string, event: string, data: unknown) => void;
  /** A core Problem the person should see on the shell's Problem screen. */
  problem?: (problem: Problem, host: string) => void;
  /** AgentZero's own window signed in to a site with its pocket (ruling d): Activity shows it as AgentZero's. */
  agentSignedIn?: (host: string, name: string) => void;
  now?: () => Date;
}

export type WalletEngine = ReturnType<typeof createWalletEngine>;

export function createWalletEngine(o: EngineOptions) {
  const now = o.now ?? (() => new Date());
  const kind = o.kind ?? "browser";
  /** By "<site's wallet id or empty>:<chain>". */
  const wallets = new Map<string, Promise<SubWallet>>();
  const evmChain = new Map<string, EvmChain>();
  const busy = new Set<string>();
  /** Requests whose sign-in the core signed with no sheet (handle() tells the host, beside the answer). */
  const signedIn = new Set<number | string>();
  /** Hosts whose page has asked since it loaded (ledger row 4's trace: the first ask is "signin.inject"). */
  const asked = new Set<string>();
  let writing: Promise<unknown> = Promise.resolve();

  async function core<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const r = await o.bridge.call<T>(method, params);
    if ("problem" in r) throw refuse(CODES.internal, r.problem.whatHappened, r.problem);
    return r.ok;
  }

  // ── Connections (per host, on the device, removable in the Browser app) ───────────────────────────────────────

  async function connections(): Promise<Record<string, Connection>> {
    const r = await o.bridge.call<{ value: string | null }>("device.store.get", { key: STORE_KEY });
    if ("problem" in r || !r.ok.value) return {};
    try {
      const all = JSON.parse(r.ok.value) as Record<string, Connection>;
      return all && typeof all === "object" ? all : {};
    } catch {
      return {};
    }
  }
  function change(edit: (all: Record<string, Connection>) => void): Promise<void> {
    const next = writing.then(async () => {
      const all = await connections();
      edit(all);
      await o.bridge.call("device.store.set", { key: STORE_KEY, value: JSON.stringify(all) });
    });
    writing = next.catch(() => undefined);
    return next;
  }
  const connected = async (host: string) => Boolean((await connections())[host]);
  async function forgotten(): Promise<string[]> {
    const r = await o.bridge.call<{ value: string | null }>("device.store.get", { key: FORGOT_KEY });
    try {
      const v = "ok" in r && r.ok.value ? (JSON.parse(r.ok.value) as unknown) : [];
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  async function markForgotten(host: string, on: boolean): Promise<void> {
    const now = await forgotten();
    const next = on ? [...new Set([...now, host])] : now.filter((h) => h !== host);
    if (next.length !== now.length) await o.bridge.call("device.store.set", { key: FORGOT_KEY, value: JSON.stringify(next) });
  }
  /** A site's own wallet on its own site (Social trading) sees its address with no sheet, unless the person disconnected it. */
  const preapprovedFor = async (host: string, rule: SiteRule) => Boolean(rule.preapproved && rule.known) && !(await forgotten()).includes(host);

  // ── The site's wallet: the chain's ONE wallet (D55), Trade's, the apps' and Chat's alike; Gnosis Pay's card window,
  //    its own (kind "pay") ──────────────────────────────────────────────────────────────────────────────────────

  /** The site's wallet on that chain (audit C1): always the site's OWN wallet, never a shared chain wallet. The core makes
   *  it on the first ask for that exact host (subwallet.site.forHost: a listed site gets its fixed wallet, any other https
   *  host its own "host:<host>" wallet) and gives the same one after. Gnosis Pay's card window keeps the card's. */
  const FOR_HOST_CHAINS: readonly string[] = ["sol", "eth", "base", "arb", "gnosis"];
  function wallet(host: string, _rule: SiteRule, chain: BrowserChain): Promise<SubWallet> {
    const key = `${kind === "pay" ? "pay" : host}:${chain}`;
    let w = wallets.get(key);
    if (!w) {
      w = (async () => {
        if (kind === "pay") {
          const list = await core<(SubWallet & { current?: boolean })[]>("subwallet.list", {});
          return list.find((x) => x.kind === "pay" && x.chain === chain) ?? (await core<SubWallet>("subwallet.create", { kind, chain }));
        }
        if (!FOR_HOST_CHAINS.includes(chain)) throw refuse(CODES.unsupported, "This site can't use that network in ZeroFee yet.");
        return core<SubWallet>("subwallet.site.forHost", { chain, site: { origin: `https://${host}` } });
      })();
      wallets.set(key, w);
      w.catch(() => wallets.delete(key));
    }
    return w;
  }

  /** AgentZero's own window (ruling b): AgentZero's pocket from the core (subwallet.site.forAgent), never forHost (the
   *  person's site wallet) and never a chain wallet. Kept under its own key, apart from any site's. */
  function agentWallet(host: string): Promise<SubWallet> {
    const key = `agent:${host}:sol`;
    let w = wallets.get(key);
    if (!w) {
      w = core<SubWallet>("subwallet.site.forAgent", { chain: "sol", site: { origin: `https://${host}` } });
      wallets.set(key, w);
      w.catch(() => wallets.delete(key));
    }
    return w;
  }
  /** Each page load's id, when the host gives none (the web): a new one each time the page leaves (zerofee_left). */
  const loads = new Map<string, number>();
  const loadOf = (req: WalletRequest, host: string) => (typeof req.load === "string" && req.load ? req.load : `e-${host.replace(/[^a-z0-9-]/g, "-")}-${loads.get(host) ?? 0}`);

  /** AgentZero's own window: connect (its pocket's address, no sheet: no money is ever in it) and the sign-in only. */
  async function answerAgent(req: WalletRequest, host: string, rule: SiteRule, input: Record<string, unknown>): Promise<unknown> {
    if (!AGENT_SITES.includes(host)) throw refuse(CODES.unauthorized, "AgentZero signs in only to pump.fun and GMGN.");
    if (!AGENT_METHODS.has(req.method)) throw refuse(CODES.unsupported, AGENT_ONLY_SIGNS_IN);
    const site = { origin: `https://${host}` };
    switch (req.method) {
      case "zerofee_left":
        busy.delete(`agent:${host}`);
        return null;
      case "solana:connect": {
        const t0 = Date.now();
        const answered = solAccount(await agentWallet(host));
        noteStep("signin.connect", host, input.silent ? "agent-silent" : "agent", Date.now() - t0);
        return answered;
      }
      case "solana:disconnect":
        // AgentZero's own window: the person's own connection to this site is never touched from here
        return null;
      default: {
        noteStep("signin.sign.request", host, "agent");
        const t0 = Date.now();
        try {
          const w = await agentWallet(host);
          if (input.address !== w.address) throw refuse(CODES.unauthorized, `That address isn't the one ZeroFee gave ${rule.name}.`);
          const message = base64Of(input.message, "message");
          const r = await asking(`agent:${host}`, () => core<{ signature: string; signedIn?: true } | { declined: true }>("subwallet.signMessage", { id: w.id, message, site, agent: true, tap: req.tap, load: loadOf(req, host) }));
          if (declined(r)) throw no();
          if (r.signedIn === true) {
            signedIn.add(req.id);
            o.agentSignedIn?.(host, rule.name);
          }
          noteStep("signin.sign.reply", host, "ok", Date.now() - t0);
          return { signature: r.signature };
        } catch (e) {
          noteStep("signin.sign.reply", host, whyOf(e), Date.now() - t0);
          throw signInProblem(e, rule.name, true);
        }
      }
    }
  }

  /** rule 8: a refused sign-in names the site, where the money is and the next tap. Text outside the core's allow-list
   *  is its own sheet (QA): never a silent refusal. */
  function signInProblem(e: unknown, name: string, agent: boolean): unknown {
    if (!(e instanceof Refusal) || e.problem?.code !== "security.subwallet.refused") return e;
    if (OFF_ALLOW_LIST.has(signInWhy(e.problem.more ?? ""))) return refuse(e.code, e.message, browserProblems.signInUnknown(name, agent, e.problem.more));
    return refuse(e.code, e.message, browserProblems.signInRefused(name, e.problem.more, agent));
  }

  /** One sheet per site at a time. */
  async function asking<T>(host: string, ask: () => Promise<T>): Promise<T> {
    if (busy.has(host)) throw refuse(CODES.pending, "ZeroFee is still asking about this site's last request.");
    busy.add(host);
    try {
      return await ask();
    } finally {
      busy.delete(host);
    }
  }
  const declined = (r: object): r is { declined: true } => "declined" in r;
  const no = () => refuse(CODES.declined, "The person said no.");

  async function connect(host: string, rule: SiteRule, chain: BrowserChain, auto: boolean): Promise<SubWallet> {
    const w = await wallet(host, rule, chain);
    if (await linked(host, rule, chain, auto)) return w;
    // A site the person typed is never pre-approved, whatever its rule says; one the person disconnected asks again.
    const preapproved = await preapprovedFor(host, rule);
    if (!preapproved && !(await asking(host, () => o.askConnect(host, rule)))) throw no();
    if (!preapproved) await markForgotten(host, false);
    await change((all) => {
      all[host] = { host, name: rule.name, chain, sinceIso: now().toISOString() };
    });
    noteStep("signin.session.saved", host, preapproved ? "preapproved" : "asked");
    return w;
  }

  /**
   * Connected now? In a Browser tab (`auto`) every site is, at once: its own wallet is made the first time its page asks
   * (subwallet.site.forHost, for that exact host) and the site is listed in the Browser's Sites, with Disconnect. No
   * sheet. Never on a look-alike name, never for Pay's card window, and never for a site the person disconnected: that
   * one stays disconnected until they say yes on the connect sheet again. What it signs is still the core's to decide.
   */
  async function linked(host: string, rule: SiteRule, chain: BrowserChain, auto: boolean): Promise<boolean> {
    if (await connected(host)) return true;
    if (!auto || kind !== "browser" || lookAlike(host) || (await forgotten()).includes(host)) return false;
    await wallet(host, rule, chain);
    await change((all) => {
      all[host] ??= { host, name: rule.name, chain, sinceIso: now().toISOString() };
    });
    noteStep("signin.session.saved", host, "auto");
    return true;
  }

  async function mine(host: string, rule: SiteRule, chain: BrowserChain): Promise<SubWallet> {
    if (!(await connected(host))) throw refuse(CODES.unauthorized, "Connect ZeroFee to this site first.");
    return wallet(host, rule, chain);
  }

  function currentEvm(host: string, rule: SiteRule): EvmChain {
    const chain = evmChain.get(host) ?? rule.chains.find(isEvm);
    if (!chain) throw refuse(CODES.chainDisconnected, "This site uses ZeroFee's wallet on Solana only.");
    return chain;
  }

  // ── Answering ────────────────────────────────────────────────────────────────────────────────────────────────

  async function answer(req: WalletRequest): Promise<unknown> {
    if (!req.mainFrame) throw refuse(CODES.unauthorized, "Only the page itself can ask ZeroFee, not a frame inside it.");
    const host = hostOf(req.origin);
    if (!host) throw refuse(CODES.unauthorized, "ZeroFee's wallet answers https sites only.");
    const rule = o.site(host);
    if (!rule) throw refuse(CODES.unauthorized, `${host} can't use this wallet.`);
    const site = { origin: `https://${host}` };
    const why = `${host} asked for this`;
    const auto = req.auto === true && req.privateWindow !== true;
    const list = Array.isArray(req.params) ? (req.params as unknown[]) : [];
    const input = (req.params && typeof req.params === "object" && !Array.isArray(req.params) ? req.params : {}) as Record<string, unknown>;
    if (req.method !== "zerofee_left" && !asked.has(host)) {
      asked.add(host);
      noteStep("signin.inject", host, "ok");
    }
    if (req.method === "zerofee_left") loads.set(host, (loads.get(host) ?? 0) + 1);
    // AgentZero's own window (the host's word): its own path, which never reaches the person's wallets (ruling a–c)
    if (req.agent === true) {
      if (kind !== "browser") throw refuse(CODES.unauthorized, `${rule.name} can't use this wallet.`);
      return answerAgent(req, host, rule, input);
    }

    if (REFUSED.has(req.method)) {
      throw refuse(CODES.unsupported, "ZeroFee doesn't sign this kind of request.", BLIND.has(req.method) ? browserProblems.requestRefused(host) : undefined);
    }
    if (EVM_READS.has(req.method)) {
      const w = await wallet(host, rule, currentEvm(host, rule));
      return (await core<{ result: unknown }>("subwallet.read", { id: w.id, method: req.method, params: list })).result;
    }

    switch (req.method) {
      case "zerofee_left":
        busy.delete(host);
        evmChain.delete(host);
        asked.delete(host);
        return null;

      // EVM: accounts and chains
      case "eth_chainId":
        return hexId(currentEvm(host, rule));
      case "eth_accounts":
        return (await linked(host, rule, currentEvm(host, rule), auto)) ? [(await wallet(host, rule, currentEvm(host, rule))).address] : [];
      case "eth_requestAccounts": {
        const t0 = Date.now();
        const address = (await connect(host, rule, currentEvm(host, rule), auto)).address;
        noteStep("signin.connect", host, "asked-evm", Date.now() - t0);
        return [address];
      }
      case "wallet_getPermissions":
        return (await linked(host, rule, currentEvm(host, rule), auto)) ? [{ parentCapability: "eth_accounts", caveats: [] }] : [];
      case "wallet_requestPermissions": {
        const asked = list[0] && typeof list[0] === "object" ? Object.keys(list[0] as object) : [];
        if (asked.length !== 1 || asked[0] !== "eth_accounts") throw refuse(CODES.unsupported, "ZeroFee gives sites its address only.");
        await connect(host, rule, currentEvm(host, rule), auto);
        return [{ parentCapability: "eth_accounts", caveats: [] }];
      }
      case "wallet_switchEthereumChain": {
        const chain = chainFromId((list[0] as { chainId?: unknown } | undefined)?.chainId);
        if (!chain || !rule.chains.includes(chain)) throw refuse(CODES.unknownChain, "Your ZeroFee wallet doesn't use that network on this site.");
        if (chain !== currentEvm(host, rule)) {
          evmChain.set(host, chain);
          o.emit(host, "chainChanged", hexId(chain));
          // Each chain has its own Browser wallet, so the address changes with it.
          if (await connected(host)) o.emit(host, "accountsChanged", [(await wallet(host, rule, chain)).address]);
        }
        return null;
      }

      // EVM: signatures, each on the core's sheet
      case "personal_sign": {
        const w = await mine(host, rule, currentEvm(host, rule));
        let [message, address] = list;
        if (sameAddress(message, w.address) && !sameAddress(address, w.address)) [message, address] = [address, message];
        if (!sameAddress(address, w.address)) throw refuse(CODES.unauthorized, `That address isn't the one ZeroFee gave ${rule.name}.`);
        if (typeof message !== "string") throw refuse(CODES.invalid, "The message must be text or hex.");
        const bytes = isHex(message) ? fromHex(message) : utf8(message);
        const r = await asking(host, () => core<{ signature: string } | { declined: true }>("subwallet.signMessage", { id: w.id, message: b64(bytes), site }));
        if (declined(r)) throw no();
        return toHex(unb64(r.signature));
      }
      case "eth_signTypedData_v4": {
        const chain = currentEvm(host, rule);
        const w = await mine(host, rule, chain);
        const [address, data] = list;
        if (!sameAddress(address, w.address)) throw refuse(CODES.unauthorized, `That address isn't the one ZeroFee gave ${rule.name}.`);
        let typedData: unknown = data;
        if (typeof data === "string") {
          try {
            typedData = JSON.parse(data);
          } catch {
            throw refuse(CODES.invalid, "The typed data isn't JSON.");
          }
        }
        const t = typedData as { domain?: { chainId?: unknown }; types?: unknown; primaryType?: unknown; message?: unknown } | null;
        if (!t || typeof t !== "object" || !t.types || typeof t.primaryType !== "string" || !t.message) throw refuse(CODES.invalid, "That isn't EIP-712 typed data.");
        const domainChain = t.domain?.chainId;
        if (domainChain !== undefined && chainFromId(typeof domainChain === "string" && !domainChain.startsWith("0x") ? Number(domainChain) : domainChain) !== chain) {
          throw refuse(CODES.invalid, "This asks you to approve for a different network than the site is on.");
        }
        const r = await asking(host, () => core<{ signature: string } | { declined: true }>("subwallet.signTypedData", { id: w.id, typedData: t, site }));
        if (declined(r)) throw no();
        return toHex(unb64(r.signature));
      }
      case "eth_sendTransaction": {
        const chain = currentEvm(host, rule);
        const w = await mine(host, rule, chain);
        const tx = (list[0] ?? {}) as Record<string, unknown>;
        if (tx.from !== undefined && !sameAddress(tx.from, w.address)) throw refuse(CODES.unauthorized, `That address isn't the one ZeroFee gave ${rule.name}.`);
        if (tx.chainId !== undefined && chainFromId(tx.chainId) !== chain) throw refuse(CODES.invalid, "This payment is for a different network than the one the site is on.");
        if (!isAddress(tx.to)) throw refuse(CODES.invalid, "ZeroFee only sends to an address. It never creates a contract.");
        const data = tx.data ?? tx.input ?? "0x";
        if (!isHex(data)) throw refuse(CODES.invalid, "data must be hex.");
        const call = { to: tx.to, value: quantity(tx.value, "value") ?? "0", data, gas: quantity(tx.gas, "gas") };
        const outcome = await asking(host, () => core<TxOutcome>("subwallet.sign", { id: w.id, call, why, site }));
        return settled(outcome).txHash;
      }

      // Solana (the Wallet Standard)
      case "solana:connect": {
        if (!rule.chains.includes("sol")) throw refuse(CODES.chainDisconnected, "This site uses ZeroFee's wallet on Ethereum-style networks only.");
        // a silent connect (the site's own auto-connect, a wallet adapter's onlyIfTrusted) gets an address only once
        // connected: in a Browser tab at once (auto), or on a site's own wallet's own site (pre-approved: Social trading
        // opens it signed in)
        if (input.silent) {
          const kept = await connected(host);
          if (!(await linked(host, rule, "sol", auto)) && !(rule.wallet && (await preapprovedFor(host, rule)))) {
            noteStep("signin.session.restored", host, "none");
            return null;
          }
          noteStep("signin.session.restored", host, kept ? "kept" : "new");
        }
        const t0 = Date.now();
        try {
          const answered = solAccount(await connect(host, rule, "sol", auto));
          noteStep("signin.connect", host, input.silent ? "silent" : "asked", Date.now() - t0);
          return answered;
        } catch (e) {
          noteStep("signin.connect", host, whyOf(e), Date.now() - t0);
          throw e;
        }
      }
      case "solana:disconnect":
        await forget(host);
        return null;
      case "solana:signMessage": {
        noteStep("signin.sign.request", host, "sol");
        const t0 = Date.now();
        try {
          const w = await mineSol(host, rule, input.address);
          const message = base64Of(input.message, "message");
          const r = await asking(host, () => core<{ signature: string; signedIn?: true } | { declined: true }>("subwallet.signMessage", { id: w.id, message, site, tap: req.tap, load: loadOf(req, host) }));
          if (declined(r)) throw no();
          if (r.signedIn === true) signedIn.add(req.id);
          noteStep("signin.sign.reply", host, r.signedIn === true ? "ok" : "ok-sheet", Date.now() - t0);
          return { signature: r.signature };
        } catch (e) {
          noteStep("signin.sign.reply", host, whyOf(e), Date.now() - t0);
          // rule 8 (phone test, 5 Nov named nothing): a refused
          // sign-in says it was this site's sign-in, where the money is by the wallet's name, and the core's own cause
          throw signInProblem(e, rule.name, false);
        }
      }
      case "solana:signTransaction": {
        const w = await mineSol(host, rule, input.address);
        const tx = base64Of(input.transaction, "transaction");
        const r = await asking(host, () => core<{ signedTx: string } | { declined: true }>("subwallet.signTx", { id: w.id, tx, why, site }));
        if (declined(r)) throw no();
        return { signedTransaction: r.signedTx };
      }
      case "solana:signAndSendTransaction": {
        const w = await mineSol(host, rule, input.address);
        const tx = base64Of(input.transaction, "transaction");
        const outcome = await asking(host, () => core<TxOutcome>("subwallet.sign", { id: w.id, tx, why, site }));
        return { signature: b64(base58Decode(settled(outcome).txHash)) };
      }
    }
    throw refuse(CODES.unsupported, `ZeroFee doesn't offer ${req.method.slice(0, 60)}.`);
  }

  function settled(outcome: TxOutcome): { txHash: string } {
    if (outcome.status === "declined") throw no();
    if (outcome.status === "problem") throw refuse(CODES.internal, outcome.problem.whatHappened, outcome.problem);
    return outcome;
  }

  async function mineSol(host: string, rule: SiteRule, address: unknown): Promise<SubWallet> {
    if (!rule.chains.includes("sol")) throw refuse(CODES.chainDisconnected, "This site uses ZeroFee's wallet on Ethereum-style networks only.");
    const w = await mine(host, rule, "sol");
    if (address !== w.address) throw refuse(CODES.unauthorized, `That address isn't the one ZeroFee gave ${rule.name}.`);
    return w;
  }

  const solAccount = (w: SubWallet) => ({ address: w.address, publicKey: b64(base58Decode(w.address)) });

  function base64Of(value: unknown, what: string): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0 || !value) throw refuse(CODES.invalid, `The ${what} must be base64 bytes.`);
    return value;
  }

  async function forget(host: string): Promise<void> {
    await change((all) => {
      delete all[host];
    });
    await markForgotten(host, true);
    o.emit(host, "disconnect", null);
    o.emit(host, "solana:change", null);
    // The phone's host keeps its own yes for a typed site (it gates wallet mode there); clear it too. Its answer doesn't
    // matter: in a browser there is no such flag, and the method isn't there.
    await o.bridge.call("device.wallet.forget", { host });
  }

  return {
    /** One request from a site; never throws. */
    async handle(req: WalletRequest): Promise<WalletReply> {
      try {
        const result = await answer(req);
        return { id: req.id, result, ...(signedIn.delete(req.id) ? { signedIn: true as const } : {}) };
      } catch (e) {
        if (e instanceof Refusal) {
          if (e.problem) o.problem?.(e.problem, hostOf(req.origin) ?? "");
          return { id: req.id, error: { code: e.code, message: e.message } };
        }
        return { id: req.id, error: { code: CODES.internal, message: "ZeroFee couldn't answer that." } };
      }
    },
    /** Sites that can see the Browser wallet's address, newest first. */
    async connections(): Promise<Connection[]> {
      return Object.values(await connections()).sort((a, b) => b.sinceIso.localeCompare(a.sinceIso));
    },
    /** One tap in the Browser app: the site loses the address at once and must ask again. */
    disconnect: forget,
    /** New backup words have run (recovery.renewed): each chain's current wallet is now the new words' one, so the
     *  wallets kept for this session go, and the next request reads the core's list again. A site never signs from the
     *  old words' wallet (security review 2 Nov, Low). */
    forgetWallets(): void {
      wallets.clear();
    },
  };
}

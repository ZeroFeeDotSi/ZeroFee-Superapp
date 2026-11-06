// The web wallet (product decision, 4 Nov): the public site's real mode, a normal wallet like Phantom. The 24 words and
// the three hot wallets they make (SOL, ETH (RH), NEAR: hot-keys.ts, decision F's paths, so the phone app opens the same
// wallets from the same words) live in this browser's vault, sealed under the person's password (the web unlock,
// apps/web/src/unlock). There is NO Safe: no account contract, passkey, Secure Enclave, recovery wait or second device.
//
// The core's web door. DemoCore asks it first for every call when it runs as the web wallet (DemoCoreOptions.webWallet):
//   account.web.new      {}                                 the 24 words, made now and held in memory until checked
//   account.web.confirm  {positions, picked}                three words checked: the words are kept, the wallets made
//   account.web.import   {words}                            24 typed words: kept, and the wallets made from them
//   account.web.status   {}                                 { ready, wallets: [{ wallet, id, address }] }
//   account.web.showWords {password}                        the 24 words again, only with the password typed again
//   account.web.exportKey {wallet, password}                one wallet's private key, only with the password typed again
//   account.web.checkWords {password, words?}               the backup-words practice (product decision, 5 Nov): the password first
//                                                           (no words: { ready: true }, the password alone checked), then
//                                                           the 24 typed words compared HERE, never sent back: { matches }
//   account.web.wordsChecked {}                             { shownAt, checkedAt }: when this browser last showed the words
//                                                           and last saw them typed right (ms, or null); the later "Forget
//                                                           this browser" needs both
// Every one is the shell's own (an app's call, stamped by forApps, is refused).
//
// Everything else is an ALLOWLIST (review, QA, 4 Nov): only the methods named in webAllows run; every other
// method is refused by name (security.web.no-safe) before anything runs, and a Safe signer asked for anyway throws the same
// on first use. Every approval sheet asks for the password again (DemoCore.answerWeb), so a yes over the caps is never
// silently a no.
import { HOT_ROOT, hotRoot } from "./hot-keys.ts";
import { seedToWords, wordsProblem, wordsToSeed } from "./recovery-words.ts";
import { originLock } from "./origin-lock.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";

/** The vault item holding the 24 words' seed (32 bytes), so "Show recovery phrase" can show them again. */
export const WEB_WORDS = "web-words";
/** When the words were last shown (showWords) and last typed right (checkWords), in this browser's vault beside them:
 *  the time in ms as decimal text. Nothing else is in them, and a failed check writes neither. */
export const WEB_WORDS_SHOWN = "web-words-shown";
export const WEB_WORDS_CHECKED = "web-words-checked";

/** The three wallets of the web wallet, and where each comes from (subwallet.create's kind and chain). */
export const WEB_WALLETS = [
  { wallet: "sol", kind: "chain", chain: "sol" },
  { wallet: "eth", kind: "chain", chain: "hood" },
  { wallet: "near", kind: "trade", chain: "near" },
] as const;
export type WebWalletName = (typeof WEB_WALLETS)[number]["wallet"];

/**
 * Trade on the web (4 Nov): a build-time constant, never a setting. Off unless the build
 * sets VITE_WEB_TRADE=1 (the same switch the screens read: shell-api release.ts), so a build that forgets it ships no
 * trading. On: Trade's own signing runs, for Trade only, inside the hot caps, after the password once per unlock. Off: it
 * is refused like the Safe.
 */
export const WEB_TRADE: boolean = import.meta.env?.VITE_WEB_TRADE === "1"; // written so the bundler makes it a literal (cf. fork.ts)

/** What the web wallet runs, each for its one reason. Anything not here is refused (security.web.no-safe). */
const WEB_METHODS = new Set([
  "account.state", "account.id", // the web wallet's own state (no Safe: DemoCore.webState)
  "approval.answer", // the shell's sheet, answered with the password (DemoCore.answerWeb)
  "subwallet.session.endAll", // the shell ends sessions when the page hides; always safe
  "subwallet.list", "subwallet.balances", "subwallet.coins", "subwallet.read", // the three wallets' reads
  "subwallet.float.balance", "subwallet.add.onWay", // Home's reads (fork B): the NEAR wallet's cash, money on its way in
  "subwallet.create", // only the three wallets (and, with WEB_TRADE, Trade's), checked below
  // Wallet's own private Send (QA's real path, 5 Nov): one confidential 1Click quote, the core's own, checked
  // below. Never subwallet.send: that is a public transfer from the wallet (the HARD RULE, every money move through
  // NEAR Confidential), and no screen on the web asks for it, so here it is refused like the Safe.
  "subwallet.sendPrivate", "subwallet.sendPrivate.status",
  "subwallet.sendCoins", // the web Send's tokens held (W4), Wallet's own read, checked below
]);
/** Home's Swap in place (product decision, 5 Nov): the NEAR wallet's cash and a NEAR coin, one intent inside its private
 *  balance (the NEAR wallet's hot key, as on the phone, D143). Wallet's own calls only. */
const SWAP_IN_PLACE = new Set(["subwallet.float.swapQuote", "subwallet.float.swap", "subwallet.float.move"]);
/** Trade's own signing (WEB_TRADE), for the Trade app only. Never Browser's or a site's: those are phone-only on the web
 *  (product decision, 4 Nov: sites can't be framed), so no subwallet.site.* and no site sign or connect. */
const TRADE_METHODS = new Set(["subwallet.signTx", "subwallet.sign", "subwallet.session.start", "subwallet.session.end", "subwallet.preflight"]);
/** The wallets subwallet.create may make: the three web wallets (a chain wallet on Solana or Robinhood Chain is the words'
 *  trade path, index 0: the same key whichever kind is asked), and with WEB_TRADE, Trade's BNB Chain one. */
const createsOk = (p: Record<string, unknown>, trade: boolean): boolean => {
  const kind = p.kind ?? "chain";
  if ((kind === "chain" || kind === "trade") && (p.chain === "sol" || p.chain === "hood")) return true;
  if (kind === "trade" && p.chain === "near") return true;
  return trade && p.app === "trade" && kind === "trade" && p.chain === "bsc";
};

/**
 * AgentZero on the web (W7, product decision, 5 Nov), for the agent app only. Its mailbox (register,
 * address, read: the keys stay in the core); its own wallet, a plain NEAR account from the words (agent-wallet.ts: read,
 * each reply paid from its own money inside its caps, a fill's one-time ticket and the fill itself from the NEAR wallet's
 * private balance on the core's sheet with the password, the set-up, which has no contract to touch here); its row's
 * balance; and a dry swap price (a quote only: nothing payable comes back). Never "empty" (there is no Safe to move to),
 * never an act, a pocket, a spend or a key change: AgentZero never signs a move of the person's here. Its money asks
 * (send, trade) are Home's and Trade's own sheets, each the person's password.
 */
const AGENT_METHODS = new Set(["account.agent.mailAddress", "account.agent.mailList", "account.agent.mailSetUp", "account.agent.wallet", "account.agent.balance", "subwallet.float.swapQuote"]);
const AGENT_WALLET_DOS: ReadonlySet<unknown> = new Set([undefined, "pay", "ticket", "fill", "setup"]);

/** May the web wallet run this call? `trade` is WEB_TRADE (a parameter only so both states are tested). */
export function webAllows(method: string, p: Record<string, unknown>, trade: boolean = WEB_TRADE): boolean {
  if (AGENT_METHODS.has(method) && p.app === "agent") return method !== "account.agent.wallet" || AGENT_WALLET_DOS.has(p.do);
  if (TRADE_METHODS.has(method)) return trade && p.app === "trade";
  if (SWAP_IN_PLACE.has(method)) return p.app === "wallet";
  if (!WEB_METHODS.has(method)) return false;
  if (method === "subwallet.sendPrivate") return p.app === "wallet" && (p.chain === "sol" || p.chain === "hood");
  if (method === "subwallet.sendPrivate.status") return p.app === "wallet";
  if (method === "subwallet.sendCoins") return p.app === "wallet";
  if (method === "subwallet.create") return createsOk(p, trade);
  return true;
}

export interface WebVault {
  get(name: string): Promise<Uint8Array | null>;
  put(name: string, value: Uint8Array): Promise<void>;
  /** Several items in one write: all or none (Vault.putAll). */
  putAll?(items: [string, Uint8Array][]): Promise<void>;
}
export interface WebWallets {
  create(kind: unknown, chain: unknown): Promise<{ id: string; address: string; chain: string; kind: string }>;
  list(): Promise<{ id: string; address: string; chain: string; kind: string }[]>;
  exportChecked(id: unknown): Promise<{ secretKey: string }>;
}
export interface WebWalletOptions {
  /** The person's password, checked against this browser's lock (and counted as a try there). While a wrong-password
   *  wait runs it checks nothing and answers the wait. */
  passwordOk: (password: string) => Promise<boolean | { waitMs: number }>;
  /** The clock for shownAt / checkedAt (tests). */
  now?: () => number;
}

export class WebDoor {
  private pending: Uint8Array | null = null;
  private readonly vault: WebVault;
  private readonly wallets: () => WebWallets;
  private readonly o: WebWalletOptions;

  constructor(vault: WebVault, wallets: () => WebWallets, o: WebWalletOptions) {
    this.vault = vault;
    this.wallets = wallets;
    this.o = o;
  }

  /** Is there a web wallet in this browser (its words kept)? */
  async ready(): Promise<boolean> {
    return !!(await this.vault.get(WEB_WORDS));
  }

  async call(method: string, p: Record<string, unknown>): Promise<unknown> {
    if (p.app !== undefined) throw new ProblemError(securityProblems.requestNotAllowed("Only ZeroFee's own screens can do that."));
    switch (method) {
      case "account.web.new":
        return this.makeNew();
      case "account.web.confirm":
        return this.confirm(p.positions, p.picked);
      case "account.web.import":
        return this.importWords(p.words);
      case "account.web.status":
        return this.status();
      case "account.web.showWords":
        await this.passwordFirst(p.password);
        return this.showWords();
      case "account.web.checkWords":
        await this.passwordFirst(p.password);
        return p.words === undefined ? { ready: true } : this.checkWords(p.words);
      case "account.web.wordsChecked":
        return { shownAt: await this.when(WEB_WORDS_SHOWN), checkedAt: await this.when(WEB_WORDS_CHECKED) };
      case "account.web.exportKey":
        await this.passwordFirst(p.password);
        return this.exportKey(p.wallet);
      default:
        throw new ProblemError(securityProblems.methodUnknown(method));
    }
  }

  private makeNew(): { words: string[] } {
    this.pending?.fill(0);
    this.pending = crypto.getRandomValues(new Uint8Array(32));
    return { words: seedToWords(this.pending) };
  }

  /** Three words checked (the screen's own check first; checked here again against the words made). */
  private async confirm(positions: unknown, picked: unknown): Promise<{ ready: true }> {
    const seed = this.pending;
    if (!seed) throw new ProblemError(securityProblems.notReady());
    const words = seedToWords(seed);
    if (!Array.isArray(positions) || !Array.isArray(picked) || positions.length !== 3 || picked.length !== 3) throw new ProblemError(securityProblems.requestInvalid("three positions and three words"));
    const right = positions.every((pos, i) => Number.isInteger(pos) && pos >= 1 && pos <= 24 && words[(pos as number) - 1] === picked[i]);
    if (!right) throw new ProblemError(securityProblems.webWordsWrong());
    await this.keep(seed);
    seed.fill(0);
    this.pending = null;
    return { ready: true };
  }

  private async importWords(words: unknown): Promise<{ ready: true }> {
    if (!Array.isArray(words) || words.length !== 24 || words.some((w) => typeof w !== "string")) throw new ProblemError(securityProblems.requestInvalid("24 words"));
    const clean = (words as string[]).map((w) => w.trim().toLowerCase());
    const bad = wordsProblem(clean);
    if (bad) throw new ProblemError(securityProblems.webWordsWrong());
    const seed = wordsToSeed(clean);
    await this.keep(seed);
    seed.fill(0);
    return { ready: true };
  }

  /**
   * The words' seed and their hot root go in the vault (sealed by the password), then the three wallets are made. One
   * check and one write, under the origin's lock (QA): two tabs can't both find no wallet and each keep its own,
   * and the root and the words are kept together or not at all (never a root whose words are another's).
   */
  private async keep(seed: Uint8Array): Promise<void> {
    await originLock(WEB_WORDS, async () => {
      if (await this.vault.get(WEB_WORDS)) throw new ProblemError(securityProblems.webAlreadySet());
      const items: [string, Uint8Array][] = [[HOT_ROOT, hotRoot(seed)], [WEB_WORDS, seed.slice()]];
      if (!this.vault.putAll) throw new Error("the web wallet's vault must write its items together (putAll)");
      await this.vault.putAll(items);
    });
    for (const w of WEB_WALLETS) await this.wallets().create(w.kind, w.chain);
  }

  private async status(): Promise<{ ready: boolean; wallets: { wallet: WebWalletName; id: string; address: string }[] }> {
    if (!(await this.ready())) return { ready: false, wallets: [] };
    return { ready: true, wallets: await this.own() };
  }

  /** The three wallets, by name, from the words (made again if missing: the same addresses). */
  private async own(): Promise<{ wallet: WebWalletName; id: string; address: string }[]> {
    const out: { wallet: WebWalletName; id: string; address: string }[] = [];
    for (const w of WEB_WALLETS) {
      const made = await this.wallets().create(w.kind, w.chain);
      out.push({ wallet: w.wallet, id: made.id, address: made.address });
    }
    return out;
  }

  /** The password typed again: right, or refused by name (wrong: counted; during a wait: the wait). */
  async passwordFirst(password: unknown): Promise<void> {
    if (typeof password !== "string" || !password) throw new ProblemError(securityProblems.webPassword());
    const r = await this.o.passwordOk(password);
    // a wait: the wait's own line, whatever was typed (the right password is never called wrong)
    if (typeof r === "object") throw new ProblemError(securityProblems.webWait(r.waitMs));
    if (!r) throw new ProblemError(securityProblems.webPassword());
  }

  private async showWords(): Promise<{ words: string[] }> {
    const seed = await this.vault.get(WEB_WORDS);
    if (!seed) throw new ProblemError(securityProblems.accountNone());
    const words = seedToWords(seed);
    seed.fill(0);
    await this.mark(WEB_WORDS_SHOWN);
    return { words };
  }

  /** The typed words against the kept ones, inside the core: only the yes or no goes back, and only a yes is recorded. */
  private async checkWords(typed: unknown): Promise<{ matches: boolean }> {
    if (!Array.isArray(typed) || typed.length !== 24 || typed.some((w) => typeof w !== "string")) throw new ProblemError(securityProblems.requestInvalid("24 words"));
    const seed = await this.vault.get(WEB_WORDS);
    if (!seed) throw new ProblemError(securityProblems.accountNone());
    const kept = seedToWords(seed);
    seed.fill(0);
    let same = 0;
    (typed as string[]).forEach((w, i) => { same += w.trim().toLowerCase() === kept[i] ? 1 : 0; });
    const matches = same === 24;
    if (matches) await this.mark(WEB_WORDS_CHECKED);
    return { matches };
  }

  private async mark(item: string): Promise<void> {
    await this.vault.put(item, new TextEncoder().encode(String((this.o.now ?? Date.now)())));
  }

  private async when(item: string): Promise<number | null> {
    const v = await this.vault.get(item);
    const n = v ? Number(new TextDecoder().decode(v)) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private async exportKey(wallet: unknown): Promise<{ key: string }> {
    const name = WEB_WALLETS.find((w) => w.wallet === wallet);
    if (!name) throw new ProblemError(securityProblems.requestInvalid("wallet is sol, eth or near"));
    const w = (await this.own()).find((x) => x.wallet === name.wallet)!;
    return { key: (await this.wallets().exportChecked(w.id)).secretKey };
  }
}

/** A stand-in for the Safe's signer in the web wallet: any use of it is the Safe, which isn't here. Nothing half-runs. */
export function noSafeSigner<T extends object>(): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === "then") return undefined; // not a promise: awaiting it gives the proxy itself
      throw new ProblemError(securityProblems.webNoSafe());
    },
  });
}

// The core's account.agent.* door (D89-D107, D122), loaded the first time AgentZero asks: never in Home's first load
// (product decision, 3 Nov: nothing AgentZero adds sits in Home's first load). DemoCore hands it a small context of its own
// parts (AgentCtx); every rule here is the one DemoCore ran before, moved, not changed.
import { ACCOUNT_POLICY, RELEASE_10 } from "./known-contracts.ts";
import { payoutCoin } from "./account-modules.ts";
import { agentConvertPlan, agentConvertPrice, convertQuoteRefusal } from "./agent-convert.ts";
import { AGENT_USDC } from "./agent-route.ts";
import type { Chain } from "./chain.ts";
import { borshKey, call } from "./demo-core.ts";
import { ownCallGas } from "./held.ts";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner, handleOf, type Approve } from "./dev-signer.ts";
import { parseQuote, type OneClickLookup, type OneClickQuoter } from "./intents.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import type { PlainWords, TxOutcome } from "./signer.ts";
import type { SubWallets } from "./subwallets.ts";
import type { Vault } from "./vault.ts";

/** Agent's key, saved under its handle so a held agent_set keeps the key it names. */
const AGENT_SEED = "agent-seed:";
const AGENT_IDENTITY_SEED = "agent-identity-seed:";
/** Every agent call fits in 100 Tgas (NEAR checks the key's allowance against all attached gas). */
const AGENT_GAS = 100_000_000_000_000n;
/** Offer agent_renew_key when the agent key's fee allowance falls below this (the module's AGENT_KEY_RENEW_BELOW). */
const AGENT_RENEW_BELOW = 100_000_000_000_000_000_000_000n;

/** What the door borrows from DemoCore. */
export interface AgentCtx {
  chain: Chain;
  vault: Vault;
  subwallets: SubWallets;
  nativeSheet: ((words: PlainWords) => Promise<boolean>) | undefined;
  userVerified: ((reason: string) => Promise<boolean>) | undefined;
  relayBase: string | undefined;
  mailOpt: { host: string; domain: string } | undefined;
  quoter: OneClickQuoter;
  quoteKey: string | undefined;
  oneClick: OneClickLookup;
  approveOnSheet: Approve;
  nativeUsd: (chain: "sol" | "bsc" | "hood" | "near") => Promise<number | null>;
  ready(): Promise<DevSigner>;
  modulesSigner(): Promise<DevSigner>;
  noteMine(add: { key: string }): void;
  cancelWaiting(id: unknown): Promise<TxOutcome>;
  /** AgentZero stopped on this run (D107): a pause or a revoke, whatever NEAR answers. */
  stopped(set?: boolean): boolean;
  /** The web wallet (web-wallet.ts): no Safe, no account contract; its every sheet asks the password (answerWeb). */
  web?: boolean;
}

/** One call on the account's own contract, through the approval sheet. */
async function own(c: AgentCtx, method: string, args: Record<string, unknown> = {}): Promise<TxOutcome> {
  const signer = await c.modulesSigner();
  return signer.run(signer.accountId, [call(method, args)]);
}

/** The agent key on the account (NEAR lets it call only the agent methods), if there is one. */
async function agentKeyOnChain(c: AgentCtx, accountId: string): Promise<{ handle: string; allowanceYocto: bigint | null } | null> {
  const keys = await c.chain.accessKeys(accountId, await c.chain.commonBlock());
  const agentLists = [ACCOUNT_POLICY.agentMethods.join(), RELEASE_10.agentMethods.join()];
  const agent = keys.find((k) => k.permission.kind === "function-call" && k.permission.receiverId === accountId && agentLists.includes(k.permission.methods.join()));
  return agent && agent.permission.kind === "function-call" ? { handle: agent.handle, allowanceYocto: agent.permission.allowanceYocto } : null;
}

/** D103: on a host without a native Face ID sheet, a budget that loosens AgentZero needs the host's user check first. */
async function agentStrong(c: AgentCtx, budget: unknown): Promise<void> {
  if (c.nativeSheet) return;
  const [{ agentLooseningNeedsUser }, s] = await Promise.all([import("./agent-private.ts"), c.modulesSigner()]);
  await agentLooseningNeedsUser(c.chain, s.accountId, budget, c.userVerified ?? null);
}

/**
 * D103 for AgentZero's own wallet (a fill, Move all, a higher limit): the person, freshly (the phone's sheet is Face ID;
 * in a browser the passkey with UV). Never the Safe's contract: AgentZero's wallet is a plain NEAR account of its own, so
 * an account on any release can fund it (QA 4 Nov: a release-9 account's fill read "This part of the app isn't ready yet",
 * agentStrong's modulesSigner refusing an account without Agent).
 */
async function walletStrong(c: AgentCtx): Promise<void> {
  if (c.nativeSheet) return;
  // W7, the web wallet: no passkey. Each step that needs the person (a fill, a higher limit) raises the core's own sheet
  // right after this, and on the web that sheet takes the password (answerWeb): that is the fresh check, asked once
  if (c.web) return;
  await (await import("./agent-private.ts")).agentUserCheck(c.userVerified ?? null);
}

/** account.agent.*: only the agent app and ZeroFee's own screens reach it (forApps). */
/**
 * The product sandbox order (3 Nov; audit M13): AgentZero moves money by itself ONLY from its own wallet. Its
 * autonomous money doors (an act, a job's act scope, the trading day and its trades, and agent_pay's payments, orders and
 * converts) run only with AgentZero's own wallet on (AGENTZERO_WALLET), and then only from that wallet (L8). Off, each is
 * refused by name before anything is read. Reading, ending, Stop, "Ask me first", the old pocket's move to the person's
 * own SOL wallet, and every sheet AgentZero opens for the person's own approval are not autonomous and stay.
 */
export const SANDBOX_OFF_LINE = "AgentZero's own wallet isn't on yet, so it can't do this by itself. Nothing moved.";
const AUTONOMOUS = new Set(["account.agent.act", "account.agent.pocketSession", "account.agent.pocketSign", "account.agent.spend"]);
async function sandboxRefusal(c: AgentCtx, method: string, p: Record<string, unknown>): Promise<void> {
  // a job's scope: setting one is autonomous leave; reading it or ending it is not
  if (!AUTONOMOUS.has(method) && !(method === "account.agent.actScope" && p.set !== undefined && !p.end)) return;
  if (!(await import("./agent-wallet.ts")).walletOn(c.subwallets.agentKit())) throw new ProblemError(securityProblems.requestNotAllowed(SANDBOX_OFF_LINE));
}

/**
 * QA (5 Nov): with AgentZero's own wallet on, the Safe's account gets no AgentZero key at all. agent_set,
 * a looser budget, a standing order and a resume would each put (or wake) a key whose one method is agent_pay from the
 * Safe's account, which nothing of ZeroFee signs any more (agentSpend refuses it) yet a paired computer could (its seed
 * is what pairing seals). So each is refused by name before any sheet, and pairing seals no Safe key: then "AgentZero
 * spends only from its own wallet" is true of every key, not only of ZeroFee's own code. walletSetup takes off an old
 * key. Tightening, Stop, pause, removing an order and renewing fees are not refused: each only narrows what is there.
 */
const SAFE_KEY_DOORS = new Set(["account.agent.set", "account.agent.setBudget", "account.agent.addOrder", "account.agent.resume", "account.agent.pairComputer"]);
export const PAIR_WALLET_OFF_LINE = "AgentZero on a computer can't use its own wallet yet. Nothing left your phone.";
async function safeKeyRefusal(c: AgentCtx, method: string): Promise<void> {
  if (!SAFE_KEY_DOORS.has(method)) return;
  const [w, r] = await Promise.all([import("./agent-wallet.ts"), import("./agent-private.ts")]);
  if (!w.walletOn(c.subwallets.agentKit())) return;
  throw new ProblemError(securityProblems.requestNotAllowed(method === "account.agent.pairComputer" ? PAIR_WALLET_OFF_LINE : r.AGENT_PAY_OFF_LINE));
}

export async function agentCall(c: AgentCtx, method: string, p: Record<string, unknown>): Promise<unknown> {
  await sandboxRefusal(c, method, p);
  await safeKeyRefusal(c, method);
  switch (method) {
    // Agent (spending limits), on the account contract v3. The budget and orders are in the contract's own JSON.
    case "account.agent.view":
      return agentView(c);
    case "account.agent.set":
      return agentStrong(c, Array.isArray(p.orders) && p.orders.length ? "always" : p.budget).then(() => agentSet(c, p.budget, p.orders));
    case "account.agent.setBudget":
      return agentStrong(c, p.budget).then(() => own(c, "agent_set_budget", { budget: p.budget }));
    case "account.agent.addOrder":
      return agentStrong(c, "always").then(() => own(c, "agent_add_order", { plan: p.plan }));
    case "account.agent.removeOrder":
      return own(c, "agent_remove_order", { id: String(p.id) });
    // a pause or a revoke: DemoCore stopped the pocket's trading already, at once, before this file loaded (D107)
    case "account.agent.pause":
      return own(c, "agent_pause");
    case "account.agent.resume":
      return agentStrong(c, "always").then(() => {
        c.stopped(false); // NEAR's own view still decides a pocket day (agentPocketDay)
        return own(c, "agent_resume");
      });
    case "account.agent.renewKey":
      return own(c, "agent_renew_key");
    case "account.agent.revoke":
      return agentRevoke(c);
    // AgentZero's inbox (D122), opened in the core: its keys come from the hot root, which never leaves it.
    case "account.agent.mailAddress":
    case "account.agent.mailList":
    case "account.agent.mailSetUp":
      await c.ready();
      return (await import("./mailbox.ts")).mailCall(method, { vault: c.vault, host: c.mailOpt?.host ?? null, domain: c.mailOpt?.domain ?? null });
    // A-10: AgentZero's own name (agent-identity.ts, loaded only when asked).
    case "account.agent.identity":
    case "account.agent.identityCreate":
      await c.ready();
      return agentIdentityCall(c, method);
    // Audit: AgentZero's receipts' chain head, kept in the core's vault apart from the receipts (agent-receipt-head.ts).
    case "account.agent.receiptHead":
      await c.ready();
      return (await import("./agent-receipt-head.ts")).receiptHeadCall(p, c.vault);
    // Home's AgentZero row and total (Wallet may ask this one read, bridge.ts APP_EXTRA): its USDC, nothing else
    case "account.agent.balance": {
      await c.ready();
      const w = await import("./agent-wallet.ts");
      return w.walletBalance({ ...c.subwallets.agentKit(), chain: c.chain });
    }
    case "account.agent.pocketEnd":
      c.subwallets.endAgentPocket("ended");
      return { ok: true };
    // AgentZero's pocket (D90, D107): its address (made on first ask, from the words); its day (one Face ID); its end
    // (always safe); and its own trade, signed only inside that day's limits, never with a sheet.
    case "account.agent.pocket":
    case "account.agent.pocketSession":
    case "account.agent.pocketSign":
    case "account.agent.pocketEmpty":
    case "account.agent.askAbove":
    case "account.agent.act":
    case "account.agent.actScope":
    case "account.agent.wallet": {
      // AgentZero's own wallet's set-up (AGENTZERO-WALLET.md §1: "agent_revoke runs at the next set-up").
      // W7, the web wallet: no account contract, so no old AgentZero key on it to revoke; the set-up is done
      if (method === "account.agent.wallet" && p.do === "setup") return c.web ? { revoked: false } : walletSetup(c);
      const stops = c.subwallets.agentPocketStopCount(); // a pause from here on stops a pocket session before it starts
      await c.ready();
      return (await import("./agent-pocket.ts")).pocketCall(method, p, { wallets: c.subwallets, chain: c.chain, signer: () => c.modulesSigner(), strong: () => (method === "account.agent.wallet" ? walletStrong(c) : agentStrong(c, "always")), stopped: () => c.stopped(), stops, vault: c.vault, approve: (w) => c.approveOnSheet(w), price: (x) => c.nativeUsd(x) });
    }
    case "account.agent.cancelWaiting": {
      const [{ agentCancelWaiting }, s] = await Promise.all([import("./agent-private.ts"), c.modulesSigner()]);
      return agentCancelWaiting(c.chain, s.accountId, (id) => c.cancelWaiting(id));
    }
    case "account.agent.pairComputer":
      return agentPairComputer(c, p.offer);
    case "account.agent.spend":
      return agentSpend(c, p);
    case "account.agent.quote": {
      const s = await c.modulesSigner();
      if (c.chain.network !== "mainnet") throw new ProblemError(securityProblems.requestNotAllowed("AgentZero swaps with real money only."));
      return agentConvertPrice(c.quoter, s.accountId, p.fromToken, p.toToken, p.amount, Date.now());
    }
    default:
      throw new ProblemError(securityProblems.methodUnknown(method));
  }
}

/** The contract's agent view, plus what's left of the agent key's fee allowance (renew below 0.1 NEAR), and until when
 *  a dispute pauses its spending (QA, 5 Nov: `agent()` says paused: false while a second device's no pauses
 *  the Face ID band, so agent_pay is refused; `dispute_until` is release 10 round 2's view, absent on older code). */
async function agentView(c: AgentCtx): Promise<unknown> {
  const signer = await c.modulesSigner();
  const block = await c.chain.commonBlock();
  const [view, key, dispute] = await Promise.all([c.chain.view(signer.accountId, "agent", {}, block), agentKeyOnChain(c, signer.accountId), c.chain.view(signer.accountId, "dispute_until", {}, block).catch(() => null)]);
  if (!view) return null;
  const left = key?.allowanceYocto ?? null;
  const keyHere = key ? !!(await c.vault.get(`${AGENT_SEED}${key.handle}`)) : false;
  const until = typeof dispute === "string" && /^\d+$/.test(dispute) ? dispute : typeof dispute === "number" && dispute > 0 ? String(dispute) : null;
  return { ...(view as object), keyAllowanceYocto: left?.toString() ?? null, renewSuggested: left !== null && left < AGENT_RENEW_BELOW, keyOnThisPhone: keyHere, ...(until ? { disputeUntilNs: until } : {}) };
}

/**
 * Give Agent its own post-quantum key, made and kept here, with the budget and orders the person approves on the
 * sheet. The key is saved before anything is sent, under its handle: a held request keeps it until it runs.
 */
async function agentSet(c: AgentCtx, budget: unknown, orders: unknown): Promise<TxOutcome> {
  const signer = await c.modulesSigner();
  if (!budget || typeof budget !== "object" || !Array.isArray(orders)) throw new ProblemError(securityProblems.requestInvalid("Send AgentZero's budget and its standing orders."));
  const key = SoftwareKey.generate();
  const name = `${AGENT_SEED}${handleOf(key.publicKey)}`;
  await c.vault.put(name, key.exportSeed());
  c.noteMine({ key: key.publicKey });
  const outcome = await signer.run(signer.accountId, [call("agent_set", { public_key: borshKey(key.publicKey), budget, orders }, ownCallGas("AgentSet"))]);
  key.destroy();
  if (outcome.status === "declined" || outcome.status === "problem") await c.vault.delete(name);
  return outcome;
}

/** "Use AgentZero on a computer" (D101), in agent-private.ts (loaded only when asked). */
async function agentPairComputer(c: AgentCtx, offer: unknown): Promise<{ status: "paired" | "declined"; words: string[] }> {
  const [{ agentPairFromCore }, s] = await Promise.all([import("./agent-private.ts"), c.modulesSigner()]);
  const onChain = await agentKeyOnChain(c, s.accountId);
  const seed = onChain && (await c.vault.get(`${AGENT_SEED}${onChain.handle}`));
  const view = (await c.chain.view(s.accountId, "agent", {}, await c.chain.commonBlock()).catch(() => null)) as { budget?: { coins?: { coin: string; per_day?: string }[] } } | null;
  const usdc = view?.budget?.coins?.find((x) => x.coin === AGENT_USDC)?.per_day;
  return agentPairFromCore({ offer, seed: seed || null, accountId: s.accountId, relay: c.relayBase ?? null, approve: (w) => c.approveOnSheet(w), strong: c.nativeSheet ? "native" : null, ...(usdc ? { pocketUsd: Number(usdc) / 1e6 } : {}) });
}

async function agentIdentityCall(c: AgentCtx, method: string): Promise<unknown> {
  const [k, signer] = await Promise.all([import("./agent-identity.ts"), c.modulesSigner()]);
  const h = {
    accountId: signer.accountId,
    chain: c.chain,
    newKey: async () => {
      const key = SoftwareKey.generate();
      const name = `${AGENT_IDENTITY_SEED}${handleOf(key.publicKey)}`;
      const seed = key.exportSeed();
      const publicKeyB64 = borshKey(key.publicKey);
      key.destroy();
      return { publicKeyB64, keep: () => c.vault.put(name, seed), forget: () => c.vault.delete(name) };
    },
    run: (m: string, args: Record<string, unknown>) => signer.run(signer.accountId, [call(m, args)]),
  };
  return method === "account.agent.identityCreate" ? k.createIdentity(h) : k.agentIdentity(h);
}

/**
 * account.agent.wallet {do: "setup"}: AgentZero's own wallet's set-up (the agent app's first run, L9). With AgentZero
 * paying from its own wallet only, the account's old AgentZero key (agent_pay from the Safe's account, its daily cap) has
 * no use left: if the account still holds one, it is revoked (agent_revoke), on the person's own sheet like Stop
 * AgentZero; with none, nothing is asked. Off (AGENTZERO_WALLET), refused by name before anything is read.
 */
async function walletSetup(c: AgentCtx): Promise<{ revoked: boolean; outcome?: TxOutcome }> {
  const w = await import("./agent-wallet.ts");
  if (!w.walletOn(c.subwallets.agentKit())) throw new ProblemError(securityProblems.requestNotAllowed(w.AGENTZERO_WALLET_OFF));
  // Phone test, 4 Nov ($5 said "This part of the app isn't ready yet."): the look for an old key reads only the
  // account's keys, so it needs no AgentZero in the account's rules. A Safe on rules without AgentZero can hold no such
  // key: nothing to revoke, and the set-up goes on. Only a revoke needs the rules' signer.
  const { accountId } = await c.ready();
  if (!(await agentKeyOnChain(c, accountId))) return { revoked: false };
  const outcome = await agentRevoke(c);
  return { revoked: outcome.status === "done", outcome };
}

async function agentRevoke(c: AgentCtx): Promise<TxOutcome> {
  const signer = await c.modulesSigner();
  const key = await agentKeyOnChain(c, signer.accountId);
  const outcome = await signer.run(signer.accountId, [call("agent_revoke")]);
  if (outcome.status === "done" && key) await c.vault.delete(`${AGENT_SEED}${key.handle}`);
  return outcome;
}

/**
 * A payment Agent decided on, signed with Agent's own key and no sheet: that key can only call agent_pay,
 * agent_convert and run_order, and the contract holds it to the budget the person approved. Only the agent app
 * reaches this (forApps).
 */
async function agentSpend(c: AgentCtx, p: Record<string, unknown>): Promise<TxOutcome> {
  // L8 (SR2 M3): with AgentZero's own wallet on, the account's agent key signs nothing for AgentZero: no payment, no
  // convert of the Safe's coins, no standing order. AgentZero pays from its own wallet only. Before any key is read.
  if ((await import("./agent-wallet.ts")).walletOn(c.subwallets.agentKit())) throw new ProblemError(securityProblems.requestNotAllowed("AgentZero pays only from its own wallet now. Nothing moved."));
  const signer = await c.modulesSigner();
  // A standing order's due payment: only that order's recipient, coin and amount, once, inside its window.
  const order = p.kind === "order";
  const privately = p.kind === "pay-private";
  const method = p.kind === "pay" || privately || p.kind === "top-up" ? "agent_pay" : p.kind === "convert" ? "agent_convert" : order ? "run_order" : null;
  let { payout, to, amount } = p;
  // AgentZero's payments (D89, D91): the signer's own checks and the private quote (to a listed person, or into
  // Spending for the keep job), loaded only when it pays.
  if (p.kind === "pay" || privately || p.kind === "top-up") {
    const { agentPayPlan } = await import("./agent-private.ts");
    ({ payout, to, amount } = await agentPayPlan({ kind: p.kind, payout, to, amount, chain: p.chain, coin: p.coin, usd: p.usd, amountOut: p.amountOut }, { chain: c.chain, accountId: signer.accountId, quoter: c.quoter, quoteKey: c.quoteKey, spending: () => c.subwallets.floatAddress(), price: (x) => c.nativeUsd(x), vault: c.vault }));
  }
  const madeHere = p.kind === "convert" && p.fromToken !== undefined;
  if (madeHere) {
    // The core makes the swap's quote itself: into this account's own balance, checked, and the deposit address
    // never passes through app code.
    if (c.chain.network !== "mainnet") throw new ProblemError(securityProblems.requestNotAllowed("AgentZero swaps with real money only."));
    ({ payout, to, amount } = await agentConvertPlan(c.quoter, signer.accountId, p.fromToken, p.toToken, p.amount, p.minOut, Date.now(), c.quoteKey));
  }
  const valid = order ? typeof p.id === "string" && /^\d{1,19}$/.test(p.id) : !!payoutCoin(payout) && typeof to === "string" && typeof amount === "string" && /^\d{1,39}$/.test(amount);
  if (!method || !valid) throw new ProblemError(securityProblems.requestInvalid("Say pay or convert, the coin, who gets it and the amount. Or say order, and which one."));
  if (p.kind === "convert" && !madeHere) {
    // A swap goes only into a live 1Click quote that pays this account's own NEAR Intents balance.
    const tokenId = (payout as any)?.Ledger?.token_id;
    if (c.chain.network !== "mainnet" || typeof tokenId !== "string") throw new ProblemError(securityProblems.requestNotAllowed("AgentZero swaps only coins in your Safe, with real money."));
    const why = convertQuoteRefusal(parseQuote(await c.oneClick(to as string), to as string, c.quoteKey), signer.accountId, tokenId, amount as string, Date.now());
    if (why) throw new ProblemError(securityProblems.requestNotAllowed(why));
  }
  const onChain = await agentKeyOnChain(c, signer.accountId);
  const seed = onChain && (await c.vault.get(`${AGENT_SEED}${onChain.handle}`));
  if (!seed) throw new ProblemError(securityProblems.requestNotAllowed("AgentZero isn't set up on this device."));
  const key = SoftwareKey.fromSeed(seed, "development");
  const agent = new DevSigner({ accountId: signer.accountId, chain: c.chain, key, approve: async () => true });
  try {
    return await agent.run(signer.accountId, [call(method, order ? { id: p.id } : { payout, to, amount }, AGENT_GAS)]);
  } finally {
    key.destroy();
  }
}

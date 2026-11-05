// The web wallet's Send, the pure part (product decision, 4 Nov): which wallet pays, the ask subwallet.sendPrivate gets,
// and its answer in one line. WebSendSheet.tsx draws them. (A site's top-up is the phone app's on the web: owner.)
// Private (product decision, 4 Nov: every money move through NEAR Confidential; QA's real path, 5 Nov):
// ONE confidential 1Click quote from the wallet straight to the payee, the core's own quote and sheet (core subwallets.ts
// sendPrivate). The core's sheet asks the password (the web's approval sheet, its 700 ms arm), so this sheet never does.
import type { TxOutcome } from "@zerofee/core/signer";
import { HIDDEN_COINS } from "@zerofee/core/hidden-coins";
import { coins } from "../format.ts";
import { shortId } from "./send-words.ts";

/** The web wallet's Send words (pending the Copywriter). */
export const WEB_SEND_WORDS = {
  title: "Send",
  from: "From",
  to: "To",
  toHint: (network: string) => `${network} address`,
  amount: (symbol: string) => `Amount in ${symbol}`,
  send: "Send",
  sent: (amount: string, symbol: string) => `${amount} ${symbol} left your wallet.`,
  /** What the payee gets, by 1Click's signed dollars (the receipt's second line). */
  theyGet: (usd: string) => `They get about $${usd}.`,
  /** The core's named refusal (rule 8): what failed, by name (its words), and where the money is, by the name of the row
   *  it would have left ("SOL wallet", "ETH (RH) wallet", "Safe"; 53, 5 Nov: never a fixed name). The next tap only where
   *  the Send button is off-screen (copy review: the lit Send right under the line already says it). */
  refused: (what: string, row: string, tap: "shown" | "off-screen" = "shown") => `${what} Your money is in your ${row}.${tap === "off-screen" ? " Tap Send to try again." : ""}`,
  /** Only for a refusal before anything was signed. */
  failed: "This didn't send. Nothing left your wallet. Try again.",
  /** The answer never came (or came with no words) after the core may have sent it: what is known, and to check first. */
  unknown: (network: string) => `${network} hasn't answered yet. Check your wallet before you try again.`,
  badTo: (network: string) => `That isn't a ${network} address.`,
  badAmount: "Type a number above 0, like 0.5.",
  /** Under the fields: what it lands as, what is hidden and what is not (the audit's P6: a watcher of the chain can match amount and time; never the word confidential: D111). */
  lands: (symbol: string, network: string) => `They get ${symbol} on ${network}. They won't see your wallet. Someone watching ${network} could still match the amount and time to you.`,
  /** The person said no on the one-tap sheet (QA: a no is said, never silent). */
  declined: "You said no. Nothing was sent.",
  /** The receipt's button: the sheet closes on it, never by itself (QA, 4 Nov: a sent SOL vanished unsaid). */
  done: "Done",
  /** The send's Activity row: what went, and where; its two steps and how it ends (1Click's own status). */
  taskTitle: (amount: string, symbol: string) => `Sent ${amount} ${symbol}`,
  taskWhere: (to: string) => `To ${to}`,
  left: (wallet: string) => `Left your ${wallet} wallet`,
  paid: "They got it.",
  back: (wallet: string) => `NEAR Confidential sent it back to your ${wallet} wallet.`,
  stuck: (wallet: string) => `NEAR Confidential didn't pay them. Check your ${wallet} wallet.`,
  max: "Max",
  /** The wallet it sends from holds nothing (a web test, 4 Nov: Hold was grey with no reason); its button Adds. */
  empty: (wallet: string) => `Your ${wallet} wallet is empty.`,
  add: (symbol: string) => `Add ${symbol}`,
  /** More typed than the wallet holds (the Copywriter, 4 Nov: the whole balance, so "This wallet has"). */
  over: (has: string, symbol: string) => `This wallet has ${has} ${symbol}.`,
} as const;

/** What the amount box keeps: digits and one point (a comma is a point); letters never stay (a web test: "abc" stayed). */
export const amountTyped = (v: string): string => v.replace(/,/g, ".").replace(/[^\d.]/g, "").replace(/^(\d*\.\d*).*$/, (m, a: string) => a + m.slice(a.length).replace(/\./g, ""));

/** Why Hold is off, said under the fields (a web test: grey with no reason): the wallet is empty, or holds less than typed;
 *  else the typed address or amount's own line (webTypedWhy). `has`: the wallet's own coin as read; none while unread. */
export function webSendWhy(o: { from: WebSendFrom; has: string | undefined; who: string; amount: string; ask: ReturnType<typeof webSendAsk> }): { line: string; empty?: true } | null {
  if (o.has !== undefined && !(Number(o.has) > 0)) return { line: WEB_SEND_WORDS.empty(o.from.wallet), empty: true };
  if (o.has !== undefined && "ok" in o.ask && Number(o.ask.ok.amount) > Number(o.has)) return { line: WEB_SEND_WORDS.over(coins(o.has, o.from.decimals), o.from.symbol) };
  const typed = webTypedWhy(o.who, o.amount, o.ask);
  return typed ? { line: typed } : null;
}

/** What a coin amount is in dollars at the wallet's own price (Spending's read: its dollars over its coin); null with no
 *  price, or nothing typed. "About $37.50" beside the amount (the Copywriter: never "≈") (QA: the web Send had no $ figure). */
export function webSendUsd(amount: string, n: { cashUsd: string; nativeAmount?: string } | undefined): string | null {
  const a = Number(amount), coin = Number(n?.nativeAmount), usd = Number(n?.cashUsd);
  if (!(a > 0) || !(coin > 0) || !(usd > 0)) return null;
  const v = (a * usd) / coin;
  return `About $${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A web send's task id begins so: the Activity centre keeps it under Earlier (task-earlier.ts), as no history row has it. */
export const WEB_SEND_TASK = "web-send:";

/** The wallets the web Send pays from: the core's chain names, each wallet's own coin. */
export const WEB_SEND_FROM = [
  { chain: "sol", wallet: "SOL", row: "SOL wallet", symbol: "SOL", network: "Solana", decimals: 9, to: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, lands: "nep141:sol.omft.near" },
  { chain: "hood", wallet: "ETH (RH)", row: "ETH (RH) wallet", symbol: "ETH", network: "Robinhood Chain", decimals: 18, to: /^0x[0-9a-fA-F]{40}$/, lands: "nep141:hood.omft.near" },
] as const;
/** One thing the web Send pays from: a wallet's own coin (WEB_SEND_FROM), or a token it holds that the core sends
 *  privately (webSendCoins). `lands`: 1Click's id of the coin, which it lands as. `token`: the wallet's coin pays the fee. */
export interface WebSendFrom { chain: "sol" | "hood"; wallet: string; row: string; symbol: string; network: string; decimals: number; to: RegExp; lands: string; token?: true }

/**
 * The tokens the web Send offers (W4, every coin held): each one the person holds that the core sends privately
 * (hidden-coins.ts: its pinned SPL tokens on Solana, ERC-20s on Robinhood Chain), from its own wallet, landing as itself.
 * A held coin not pinned there has no private route, so it is not offered (rule 1); nor are the NEAR wallet's coins
 * (NEAR_GATE shut in the app; NEAR Intents refuses payouts to NEAR accounts: ledger.quote.near-closed) or BNB Chain's
 * (BNB_PROVEN false). `held`: Home's read of the coins (display only: the core reads the coin again before any price).
 */
export function webSendCoins(held: readonly { chain: string; address: string; amount: string }[] | null | undefined): WebSendFrom[] {
  return Object.entries(HIDDEN_COINS).flatMap(([id, c]): WebSendFrom[] => {
    const h = (held ?? []).find((x) => x.chain === c.chain && (c.chain === "hood" ? x.address.toLowerCase() === c.address : x.address === c.address));
    if (!h || !(Number(h.amount) > 0)) return [];
    const w = WEB_SEND_FROM.find((f) => f.chain === c.chain)!;
    return [{ chain: c.chain, wallet: w.wallet, row: w.row, symbol: c.symbol, network: w.network, decimals: c.decimals, to: w.to, lands: id, token: true }];
  });
}
/**
 * The token chips' switch (the audit's MUST, 5 Nov): a build-time constant. ON by default since QA deployed the relay's
 * case (h) with web-send-coins.mjs and dry-checked it live (5 Nov, launch A7: pinned USDC 201, unpinned 400, another
 * payout coin 400). The rollback: a build with VITE_WEB_SEND_TOKENS=0 shows no token chip and reads nothing (rule 1).
 */
export const webSendTokensOn = (v: string | undefined): boolean => v !== "0";
export const WEB_SEND_TOKENS: boolean = webSendTokensOn((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_WEB_SEND_TOKENS);

/** What the web Send's From row offers: each wallet's own coin, then, only with the tokens' switch on, every pinned token
 *  the wallets hold (the core's own read, subwallet.sendCoins). */
export const webSendFroms = (open: boolean, held: Parameters<typeof webSendCoins>[0]): WebSendFrom[] => [...WEB_SEND_FROM, ...(open ? webSendCoins(held) : [])];

/** What a token entry holds, from Home's read (display only), as the sheet shows beside its chip. */
export const webCoinHas = (held: readonly { chain: string; address: string; amount: string }[] | null | undefined, f: WebSendFrom): string | undefined => {
  if (!f.token) return undefined;
  const c = HIDDEN_COINS[f.lands];
  return (held ?? []).find((x) => !!c && x.chain === c.chain && (c.chain === "hood" ? x.address.toLowerCase() === c.address : x.address === c.address))?.amount;
};

/** What a send leaves for its network fee, in the coin's smallest units: Solana's one-signature transfer (5,000 lamports);
 *  on Robinhood Chain 0.00001 ETH, well over a plain transfer's 21,000 gas there (0.02 gwei, 4 Nov). */
const FEE_ROOM: Record<WebSendChain, bigint> = { sol: 5_000n, hood: 10_000_000_000_000n };

/** Max (webd-money2 crawl, 4 Nov: emptying a wallet needed a 9-decimal figure): the whole wallet less its fee room, as an
 *  exact decimal; null when that leaves nothing. */
export function webSendMax(chain: WebSendChain, has: string | undefined, coin?: WebSendFrom): string | null {
  const from: WebSendFrom = coin ?? WEB_SEND_FROM.find((f) => f.chain === chain)!;
  const m = has === undefined ? null : /^(\d+)(?:\.(\d+))?$/.exec(has);
  if (!m) return null;
  // a token: all of it (the wallet's own coin pays its fee)
  const units = BigInt(m[1]! + (m[2] ?? "").padEnd(from.decimals, "0").slice(0, from.decimals)) - (from.token ? 0n : FEE_ROOM[chain]);
  if (units <= 0n) return null;
  const s = units.toString().padStart(from.decimals + 1, "0");
  const frac = s.slice(-from.decimals).replace(/0+$/, "");
  return `${s.slice(0, -from.decimals)}${frac ? `.${frac}` : ""}`;
}
export type WebSendChain = WebSendFrom["chain"];

/** subwallet.send's ask, or why not (the core checks all of it again; this only keeps Hold off for a plain typo). */
export function webSendAsk(chain: WebSendChain, to: string, amount: string, coin?: WebSendFrom): { ok: { chain: WebSendChain; to: string; amount: string } } | { why: string } {
  const from: WebSendFrom = coin ?? WEB_SEND_FROM.find((f) => f.chain === chain)!;
  const t = to.trim();
  if (!from.to.test(t)) return { why: WEB_SEND_WORDS.badTo(from.network) };
  const a = amount.trim();
  const m = /^(\d{1,30})(?:\.(\d+))?$/.exec(a);
  if (!m || (m[2]?.length ?? 0) > from.decimals || !/[1-9]/.test(a)) return { why: WEB_SEND_WORDS.badAmount };
  return { ok: { chain, to: t, amount: a } };
}

/** The amount's line under the fields: only for a finished amount that is wrong (never while "0." is still typed). */
export function webTypedWhy(who: string, amount: string, ask: ReturnType<typeof webSendAsk>): string | null {
  if (!who || !amount || /\.$/.test(amount.trim()) || !("why" in ask)) return null;
  return ask.why;
}

/**
 * The core's answer in one line: on its way, or what happened (its own words), or nothing said beyond the no.
 * `{ problem }` is the bridge refusing before anything was signed: only then "Nothing left your wallet". `{ thrown }`
 * (the call never answered) and a TxOutcome problem with no words came after the core may have sent it: the chain
 * hasn't answered, check the wallet first (Copywriter batch 2, note 2).
 */
export function webSendLine(r: { ok: TxOutcome } | { problem: { code?: string; whatHappened?: string; money?: { where?: string } } } | { thrown: true }, amount: string, symbol: string, network: string, row?: string): { went: boolean; line: string | null; txHash?: string } {
  if ("thrown" in r) return { went: false, line: WEB_SEND_WORDS.unknown(network) };
  // rule 8 (W4): the core's named refusal says what failed and by whom; here also where the money is, by the row it was in
  // (`row`: the sheet's From, the row the money would have left; never the core's fixed fallback), no "Tap Send" under Send
  if ("problem" in r && r.problem.code === "security.send.private-refused" && r.problem.whatHappened && row) return { went: false, line: WEB_SEND_WORDS.refused(r.problem.whatHappened, row) };
  if ("problem" in r && r.problem.code === "security.send.private-refused" && r.problem.whatHappened && r.problem.money?.where) return { went: false, line: `${r.problem.whatHappened} Your money is ${r.problem.money.where}.` };
  if ("problem" in r) return { went: false, line: r.problem.whatHappened || WEB_SEND_WORDS.failed };
  if (r.ok.status === "done") return { went: true, line: WEB_SEND_WORDS.sent(amount, symbol), ...(typeof r.ok.txHash === "string" && r.ok.txHash ? { txHash: r.ok.txHash } : {}) };
  if (r.ok.status === "declined") return { went: false, line: WEB_SEND_WORDS.declined };
  if (r.ok.status === "problem") return { went: false, line: r.ok.problem.whatHappened || WEB_SEND_WORDS.unknown(network) };
  return { went: false, line: WEB_SEND_WORDS.unknown(network) };
}

/** What the sheet shows once sent: its line, what the payee gets, and its transaction (none when the core gave no id). */
export type WebSent = { line: string; usd: string | null; tx: { chain: string; hash: string } | null };

/** The core's answer to subwallet.sendPrivate: the wallet's payment to 1Click's address, and what 1Click signed. */
type PrivateAnswer = { sent: TxOutcome; depositAddress: string; amountOut: string; amountOutUsd?: string; amountInUsd: string };

/** One step of the send's Activity row (the shell's TaskStep). */
type WebSendStep = { label: string; state: "waiting" | "doing" | "done" | "failed"; at?: number };

/** The send's Activity task (the Activity centre: "web-send:<id>"): left the wallet (done, its transaction as proof),
 *  then paid to the payee, pending until 1Click says so (webSendFollow). */
export function webSendTask(o: { from: WebSendFrom; to: string; amount: string; txHash: string; usd: string | null; at: number }) {
  // the job's title names the payee in the core sheet's short form, 6+6 (the copy review's ruling, 5 Nov)
  const short = shortId(o.to);
  const usd = o.usd ? o.usd.replace(/^About /, "") : null;
  return {
    id: `${WEB_SEND_TASK}${o.txHash}`, title: WEB_SEND_WORDS.taskTitle(o.amount, o.from.symbol), state: "pending" as const, startedAt: o.at,
    steps: [{ label: WEB_SEND_WORDS.left(o.from.wallet), state: "done", at: o.at }, { label: WEB_SEND_WORDS.paid, state: "doing" }] as WebSendStep[], where: WEB_SEND_WORDS.taskWhere(short),
    ...(usd ? { usd } : {}), proof: [{ chain: o.from.chain, hash: o.txHash }],
  };
}

/** 1Click's status, as the task's end: done, came back, or didn't finish; null while it is still going. */
export function webSendEnd(status: string, wallet: string): { state: "done" | "failed"; detail?: string } | null {
  if (status === "SUCCESS") return { state: "done" };
  if (status === "REFUNDED") return { state: "failed", detail: WEB_SEND_WORDS.back(wallet) };
  if (status === "FAILED") return { state: "failed", detail: WEB_SEND_WORDS.stuck(wallet) };
  return null;
}

/**
 * One send, start to end: subwallet.sendPrivate (the core quotes it, shows its sheet with the password, pays 1Click's
 * address), its answer in words, and, once it went, its Activity row with its proof before the sheet shows the receipt;
 * then 1Click's status is followed to the row's end. `{ sent }`: the receipt; `{ line }`: what happened instead.
 */
export async function webSendGo(o: {
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>; ask: { chain: WebSendChain; to: string; amount: string }; from: WebSendFrom; usd: string | null;
  tasks?: { publish: (task: ReturnType<typeof webSendTask>) => unknown; update: (id: string, patch: { steps: ReturnType<typeof webSendTask>["steps"] }) => unknown; end: (id: string, state: "done" | "failed", detail?: string) => unknown };
  now?: () => number; everyMs?: number; forMs?: number;
}): Promise<{ sent: WebSent } | { line: string | null }> {
  const r = (await o.call("subwallet.sendPrivate", { ...o.ask, toTokenId: o.from.lands }).catch(() => ({ thrown: true as const }))) as { ok: PrivateAnswer } | { problem: { code?: string; whatHappened?: string } } | { thrown: true };
  const said = webSendLine("ok" in r ? { ok: r.ok.sent } : r, o.ask.amount, o.from.symbol, o.from.network, o.from.row);
  if (!said.went || !("ok" in r)) return { line: said.line };
  const get = Number(r.ok.amountOutUsd);
  const usd = Number.isFinite(get) && get > 0 ? get.toFixed(2) : null;
  if (said.txHash && o.tasks) {
    const task = webSendTask({ from: o.from, to: o.ask.to, amount: o.ask.amount, txHash: said.txHash, usd: o.usd, at: (o.now ?? Date.now)() });
    o.tasks.publish(task);
    void webSendFollow({ call: o.call, depositAddress: r.ok.depositAddress, task, wallet: o.from.wallet, tasks: o.tasks, now: o.now ?? Date.now, everyMs: o.everyMs ?? 3_000, forMs: o.forMs ?? 30 * 60_000 });
  }
  return { sent: { line: said.line!, usd: usd ? WEB_SEND_WORDS.theyGet(usd) : null, tx: said.txHash ? { chain: o.ask.chain, hash: said.txHash } : null } };
}

/** The row's second step, by 1Click's own status (the core's kept tag), until it ends or `forMs` passes (then it stays
 *  pending: where the money is isn't known here, never guessed). */
async function webSendFollow(o: { call: (method: string, params: Record<string, unknown>) => Promise<unknown>; depositAddress: string; task: ReturnType<typeof webSendTask>; wallet: string; tasks: NonNullable<Parameters<typeof webSendGo>[0]["tasks"]>; now: () => number; everyMs: number; forMs: number }): Promise<void> {
  for (let waited = 0; waited <= o.forMs; waited += o.everyMs) {
    await new Promise((res) => setTimeout(res, o.everyMs));
    const r = (await o.call("subwallet.sendPrivate.status", { depositAddress: o.depositAddress }).catch(() => null)) as { ok?: { status?: string } } | null;
    const end = webSendEnd(String(r?.ok?.status ?? ""), o.wallet);
    if (!end) continue;
    const [left, paid] = o.task.steps;
    o.tasks.update(o.task.id, { steps: [left, { ...paid, state: end.state === "done" ? "done" : "failed", at: o.now() }] });
    o.tasks.end(o.task.id, end.state, end.detail);
    return;
  }
}

/** Decision A: is `to` one of the person's own wallets (subwallet.list's addresses)? An EVM address in any case. Unknown
 *  (the list not read): not own, so the field shows; the core decides either way (security.web.send-password). */
export function webSendOwn(own: readonly string[] | null, to: string): boolean {
  if (!own) return false;
  const evm = /^0x[0-9a-fA-F]{40}$/.test(to);
  return own.some((a) => (evm ? a.toLowerCase() === to.toLowerCase() : a === to));
}

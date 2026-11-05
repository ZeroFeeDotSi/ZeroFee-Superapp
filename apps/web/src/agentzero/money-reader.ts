// H-2: read_activity's reader on the phone (ask-money.ts does the sums). It reads Wallet's Activity through the AgentZero
// app's own bridge (ledger.activity, ledger.tokens, ledger.chains: reads; another app's labels stay with that app), and
// keeps each row it read, so a figure's chip opens exactly its rows here. Nothing is sent from here: chatTurn sends the
// answer's text (kinds, days, coins, marks, stand-ins) to Claude through the person's own key or ZeroFee's free reading.
import { LIMITS, withinOr } from "@zerofee/agent/chat/wait";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { ActivityAsk, ChatFact } from "@zerofee/agent/chat/turn";
import type { SpendingActivity, SpendingWallet } from "@zerofee/core/spending";
import type { Chain, Movement, Token } from "@zerofee/wallet/types.ts";
import { ownRows } from "@zerofee/wallet/app/format.ts";
import { answerAsk, chainSends, markCounter, moneyRows, NOT_HERE, receivedListed, type ChainSend, type MoneyAnswer, type MoneyRow } from "./ask-money.ts";

/** How many moves one read takes (newest first). A read this full may miss older moves, and the answer says so. */
export const READ_LIMIT = 200;

/** The rows a chip opens, by Activity id (this page only; a chat is never kept). */
const kept = new Map<string, MoneyRow>();
export const keptRow = (id: string): MoneyRow | undefined => kept.get(id);

/** A read that answered, or why not: a part the account doesn't have (no Spending: "this part isn't ready") is none, as
 *  Home's Activity reads it; any other failure is said, never a total short by it. */
function part<T>(r: BridgeResult<T[]> | undefined): T[] | "unread" {
  if (r && "ok" in r && Array.isArray(r.ok)) return r.ok;
  return r && "problem" in r && NOT_HERE.has(r.problem.code) ? [] : "unread";
}

/** The person's own words this turn, for matching a name (set by the screen before each turn). */
export function moneyReader(bridge: Bridge, said: () => string) {
  const mark = markCounter();
  async function read(q: ActivityAsk): Promise<MoneyAnswer> {
    // Home's Activity, the same reads (product decision, 3 Nov saw only the ledger): the ledger's moves,
    // Spending's rows (Top up, Put away, Move), the account's own record (a NEAR send the Safe signed, which the ledger
    // gives Wallet only) and the person's wallets (a move into one of them is not money out)
    // wait.ts: the parts besides Activity's own moves answer within 3/4 of the read's limit, or are said as not read (the
    // answer still comes from the moves); the moves themselves are the tool's own wait (turn.ts, LIMITS.core)
    const safe = <T,>(p: Promise<BridgeResult<T>>) => withinOr(p, LIMITS.core * 0.75, "Activity", undefined);
    const [moves, tokens, chains, spending, record, wallets] = await Promise.all([
      bridge.call<Movement[]>("ledger.activity", { limit: READ_LIMIT }),
      safe(bridge.call<Token[]>("ledger.tokens")),
      safe(bridge.call<Chain[]>("ledger.chains")),
      safe(bridge.call<SpendingActivity[]>("spending.activity")),
      safe(bridge.call<ChainSend[]>("account.activity", { limit: 50 })),
      safe(bridge.call<SpendingWallet[]>("spending.wallets")),
    ]);
    if (!("ok" in moves) || !Array.isArray(moves.ok)) return { text: "The person's activity couldn't be read just now. Say so; never guess.", facts: [], marks: { coins: [] } };
    const toks = new Map((tokens && "ok" in tokens && Array.isArray(tokens.ok) ? tokens.ok : []).map((t) => [t.assetId, t]));
    const sp0 = part(spending), rec = part(record), ws = part(wallets);
    // only rows of Spending's own shape are read (a malformed row is never half-counted)
    const sp = sp0 === "unread" ? sp0 : sp0.filter((x) => !!x && typeof x.id === "string" && typeof x.usd === "string" && typeof x.atIso === "string" && typeof x.status === "string" && typeof x.words === "string");
    const ledger = [...moves.ok, ...chainSends(rec === "unread" ? [] : rec, moves.ok)];
    const rows = moneyRows(ledger, toks, chains && "ok" in chains && Array.isArray(chains.ok) ? chains.ok : [], sp === "unread" ? [] : sp, ownRows(ws === "unread" ? [] : ws));
    rows.forEach((r) => kept.set(r.id, r));
    const a = answerAsk(rows, q, { said: said(), mark, full: moves.ok.length >= READ_LIMIT, now: Date.now(), received: receivedListed(moves.ok) });
    const unread = [...(sp === "unread" ? ["moves between the person's own wallets (Top up, Put away, Move)"] : []), ...(rec === "unread" ? ["sends from the Safe in the account's own record"] : [])];
    return unread.length ? { ...a, text: `${a.text}\nCouldn't be read just now, so not counted above: ${unread.join("; ")}. Say so plainly.` } : a;
  }
  return {
    read,
    /** chatTurn's hand (ChatHands.activity). */
    activity: async (q: ActivityAsk): Promise<{ text: string; facts: ChatFact[] }> => {
      const a = await read(q);
      return { text: a.text, facts: a.facts };
    },
  };
}

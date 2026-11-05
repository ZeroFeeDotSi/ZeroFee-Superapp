// Every read has an end (grade 1 Nov b, N2): Wallet sat on "Loading your money…" for over 5 minutes and Protection on
// "Reading your rules…" for over a minute, with no error and no Try again. A read the screens wait on now answers
// within READ_DEADLINE_MS: its value, its own Problem, or "the network is slow" (security.read.slow) with Try again, so
// every waiting screen ends on the error contract. Only reads are cut: anything that signs, sends or waits for the
// person (a sheet, Face ID, a held request) is never given a deadline, so a slow send can't look failed while it goes.
import type { Bridge, BridgeResult } from "./bridge.ts";
import { securityProblems } from "./security-problems.ts";

export const READ_DEADLINE_MS = 10_000;

/** Methods that only read, and that a screen waits on. A late answer is dropped; the screen's Try again asks again. */
export const READS: ReadonlySet<string> = new Set([
  "account.state",
  "account.id",
  "account.activity",
  "account.keyProof",
  "account.protection.get",
  "account.rules",
  "account.nearPrice",
  "account.secondDevices",
  "account.waiting",
  "account.waiting.status",
  "account.agent.view",
  "account.recoveryChoices",
  "recovery.status",
  "secondDevice.state",
  "secondDevice.requests",
  "guardian.requests",
  "ledger.balances",
  "ledger.activity",
  "ledger.tokens",
  "ledger.chains",
  "ledger.private",
  "ledger.recipientInfo",
  "earn.positions",
  "trade.holdings",
  "trade.positions",
  "subwallet.sendCoins",
  "spending.status",
  "spending.activity",
  "spending.wallets",
  "subwallet.list",
  "subwallet.balances",
  "subwallet.coins",
  "subwallet.float.balance",
  "subwallet.float.moves",
  "subwallet.float.addStatus",
  "subwallet.float.limits",
  "subwallet.float.swapCost",
  "subwallet.private.balances",
  "subwallet.oldWords",
  "subwallet.oldWords.moves",
  "card.balance",
]);

/** Each caller's own copy of a shared answer: one screen changing what it got never changes another's. */
const own = <T>(r: BridgeResult<T>): BridgeResult<T> => {
  try {
    return structuredClone(r);
  } catch {
    return r;
  }
};

/**
 * `bridge`, with every read in `reads` answering within `ms` (else security.read.slow). Everything else is untouched.
 * D134, item 3 (single-flight): the same read asked again while it is still under way (same method, same parameters) is
 * not asked again; every caller gets the one answer (its own copy). One Home open asked spending.status, account.state
 * and subwallet.float.balance two or three times at once, each a burst on the same nodes. Review L5: a read never joins
 * one that began before a change: any call that isn't a read (a move, a setting), and any event this bridge delivers,
 * starts the next reads fresh.
 */
export function withReadDeadline(bridge: Bridge, ms = READ_DEADLINE_MS, reads: ReadonlySet<string> = READS): Bridge {
  const flying = new Map<string, Promise<BridgeResult<unknown>>>();
  let changes = 0;
  return {
    call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
      if (!reads.has(method)) {
        changes++;
        return bridge.call<T>(method, params).finally(() => changes++);
      }
      const key = `${changes} ${method} ${JSON.stringify(params ?? {})}`;
      let shared = flying.get(key) as Promise<BridgeResult<T>> | undefined;
      if (!shared) {
        const mine = bridge.call<T>(method, params);
        shared = mine;
        flying.set(key, mine);
        void mine.then(
          () => flying.get(key) === mine && flying.delete(key),
          () => flying.get(key) === mine && flying.delete(key),
        );
      }
      const asked = shared.then(own);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<BridgeResult<T>>((resolve) => {
        timer = setTimeout(() => resolve({ problem: securityProblems.readSlow(method) }), ms);
      });
      return Promise.race([asked, late]).finally(() => clearTimeout(timer));
    },
    on<T>(event: string, handler: (payload: T) => void) {
      return bridge.on<T>(event, (payload) => {
        changes++;
        handler(payload);
      });
    },
  };
}

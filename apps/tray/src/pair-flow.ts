// `tray pair`: the computer's side of pairing (packages/core/src/pair.ts). It shows the offer text for the phone to paste
// and, at once, the six check words that come from this computer's key alone: the person compares them on the phone
// BEFORE approving there (so nobody in the middle can fit a match after the fact). Then it reads the relay's one-time
// mailbox for exactly one box: it opens it, rebuilds AgentZero's key from the seed inside, and checks ON NEAR that this
// key is AgentZero's on that account (a function-call key on the account itself whose methods are exactly
// ["agent_pay"]). Any failure ends the pairing: "Start again". Only then is anything kept, in the
// Keychain; it prints the Claude Code line (with the bearer token) and the stop phrase.
import { randomInt } from "node:crypto";
import { makeOffer, openSeed, trayBearer } from "@zerofee/core/pair";
import { SoftwareKey } from "@zerofee/core/device-key";
import { keyHandle } from "@zerofee/core/key-handle";
import { relayBase } from "@zerofee/core/relay";
import type { Chain } from "@zerofee/core/chain";
import { DAY_LIMIT_MAX_USD, stopHashOf, type SecretStore } from "./store.ts";

export const PORT = 7811;
const WAIT_MS = 10 * 60_000;
/** Every 2 s for the first 2 minutes, then every 10 s: under the relay's 120 reads per address every 10 minutes. */
const FAST_MS = 2_000;
const FAST_FOR_MS = 2 * 60_000;
const SLOW_MS = 10_000;
const BUSY_MS = 30_000;

/** Short, plain words a person can type: the stop phrase is three of them. */
export const STOP_WORDS = [
  "apple", "river", "candle", "tiger", "piano", "cloud", "pepper", "rocket", "garden", "lemon", "pencil", "window",
  "honey", "button", "planet", "summer", "forest", "violin", "rabbit", "orange", "silver", "basket", "mirror", "dragon",
  "ocean", "pillow", "castle", "banana", "thunder", "jacket", "meadow", "puzzle", "anchor", "bridge", "cookie", "dolphin",
  "falcon", "ginger", "harbor", "island", "jungle", "kettle", "ladder", "marble", "noodle", "otter", "parrot", "quartz",
  "saddle", "tulip", "valley", "walnut", "yellow", "zebra", "blanket", "copper", "desert", "engine", "feather", "glacier",
  "hammer", "igloo", "lantern", "magnet",
] as const;

export const stopPhrase = (pick: (n: number) => number = randomInt): string => [0, 1, 2].map(() => STOP_WORDS[pick(STOP_WORDS.length)]).join(" ");

export const claudeLine = (bearer: string, port = PORT): string => `claude mcp add --transport http agentzero http://127.0.0.1:${port}/mcp --header "Authorization: Bearer ${bearer}"`;

export const DAY_LIMIT_DEFAULT_USD = 20;
/** What the person typed for the day limit: empty is the default; whole dollars 1 to 1,000; anything else null. */
export const dayLimitOf = (typed: string): number | null => {
  if (typed === "") return DAY_LIMIT_DEFAULT_USD;
  if (!/^\d{1,4}$/.test(typed)) return null;
  const n = Number(typed);
  return n >= 1 && n <= DAY_LIMIT_MAX_USD ? n : null;
};

export interface PairDeps {
  relay: string;
  store: SecretStore;
  /** NEAR for the account the box names (mainnet, or testnet for a .testnet account). */
  chainFor: (accountId: string) => Chain;
  fetchFn?: typeof fetch;
  print: (line: string) => void;
  /** Asks the person (the terminal); resolves with what they typed. */
  ask: (question: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pick?: (n: number) => number;
  port?: number;
}

/**
 * Is `publicKey` AgentZero's key on `accountId`, as NEAR lists the account's keys now (two nodes, one block)? Only a
 * function-call key on the account itself whose methods are exactly ["agent_pay"]. "unknown": NEAR didn't answer.
 */
export async function agentKeyOnChain(chain: Chain, accountId: string, publicKey: string): Promise<"yes" | "no" | "unknown"> {
  let keys;
  try {
    keys = await chain.accessKeys(accountId, await chain.commonBlock());
  } catch {
    return "unknown";
  }
  const handle = keyHandle(publicKey);
  const p = keys.find((k) => k.handle === handle)?.permission;
  if (!p || p.kind !== "function-call" || p.receiverId !== accountId) return "no";
  return p.methods.length === 1 && p.methods[0] === "agent_pay" ? "yes" : "no";
}

/** The whole pairing. Resolves true when the pairing is kept; every refusal is one plain line and keeps nothing. */
export async function runPair(d: PairDeps): Promise<boolean> {
  const base = relayBase(d.relay);
  if (!base) {
    d.print("Give the relay as an https address: --relay https://<your relay>");
    return false;
  }
  const fetchFn = d.fetchFn ?? fetch;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = d.now ?? Date.now;
  const again = (why: string) => (d.print(`${why} Nothing was saved. Start again: node apps/tray/tray.ts pair --relay ${base}`), false);
  // D104: this computer's own day limit, asked first (the account's own limit stays the hard ceiling).
  let dayLimitUsd: number | null = null;
  for (let i = 0; i < 3 && dayLimitUsd === null; i++) {
    const typed = (await d.ask(`How much may this computer spend a day? (default ${DAY_LIMIT_DEFAULT_USD}) `)).trim().replace(/^\$/, "");
    dayLimitUsd = dayLimitOf(typed);
    if (dayLimitUsd === null) d.print(`Say whole dollars from 1 to ${DAY_LIMIT_MAX_USD}, like 20.`);
  }
  if (dayLimitUsd === null) return again("No day limit was given.");
  const o = makeOffer();
  try {
    d.print("On your phone: AgentZero, then Use AgentZero on a computer. Paste this:");
    d.print("");
    d.print(o.offer);
    d.print("");
    d.print(`Your phone will show ${o.words.length} words. They must be: ${o.words.join(" ")}.`);
    d.print("Approve on your phone only if they match.");
    d.print("Waiting for your phone…");
    const start = now();
    let box: string | null = null;
    while (now() - start < WAIT_MS) {
      let wait = now() - start < FAST_FOR_MS ? FAST_MS : SLOW_MS;
      try {
        const r = await fetchFn(`${base}/v0/pair/${o.mailbox}`, { method: "GET", signal: AbortSignal.timeout(10_000) });
        if (r.status === 200) {
          // Exactly one box per pairing: whatever it holds, the mailbox is never read again.
          const body = (await r.json().catch(() => null)) as { box?: unknown } | null;
          box = typeof body?.box === "string" ? body.box : "";
          break;
        }
        if (r.status === 429) wait = BUSY_MS;
        await r.arrayBuffer().catch(() => undefined);
      } catch {
        // No answer this time: ask again.
      }
      await sleep(wait);
    }
    if (box === null) return again("Your phone didn't answer in 10 minutes.");
    const opened = openSeed(box, o.mailbox, o.secret);
    if (!opened || opened.seed.length !== 32) return again("That didn't come from your phone.");
    try {
      const key = SoftwareKey.fromSeed(opened.seed, "development");
      const publicKey = key.publicKey;
      key.destroy();
      const onChain = await agentKeyOnChain(d.chainFor(opened.accountId), opened.accountId, publicKey);
      if (onChain === "unknown") return again("NEAR didn't answer, so AgentZero's key couldn't be checked.");
      if (onChain === "no") return again(`That key isn't AgentZero's on ${opened.accountId}.`);
      // The person names the account this computer will pay for: nothing is kept without their yes.
      const yes = (await d.ask(`This computer will pay for ${opened.accountId}. Is that your account? Type yes. `)).trim().toLowerCase();
      if (yes !== "yes") return again("Not your account, or no yes.");
      const phrase = stopPhrase(d.pick);
      try {
        await d.store.save({ seed: opened.seed, secret: o.secret, accountId: opened.accountId, stopHash: stopHashOf(phrase), dayLimitUsd });
      } catch {
        return again("The Keychain didn't keep it.");
      }
      d.print("");
      d.print(`AgentZero is on this computer for ${opened.accountId}, up to $${dayLimitUsd} a day from here.`);
      d.print("Start it: node apps/tray/tray.ts serve");
      d.print("Then add it to Claude Code:");
      d.print(claudeLine(trayBearer(o.secret), d.port ?? PORT));
      d.print("");
      d.print(`Your stop phrase: ${phrase}`);
      d.print("Write it down. AgentZero stops on this computer only when you type it.");
      return true;
    } finally {
      opened.seed.fill(0);
    }
  } finally {
    o.secret.fill(0);
  }
}

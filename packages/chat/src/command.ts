// The send command, read ONLY from what the person types into their own composer (D55, BITCHAT-RESEARCH §4 rule 2).
// Someone else's message is never read by this file: incoming text goes through messages.ts, which can only make a
// request chip that fills Send in when tapped.
//
//   send 5 USDC to <address> [on <network>]      pay 0.1 sol to <address>      send $5 to <address> on base
//   send money to <address> [on <network>]       send USDC to <address>         (no amount: the person types it)
//
// A number needs its coin ("send 5 to …" is refused: 5 of what?); "$5" means 5 of a dollar coin, USDC. The whole message
// must be the command: nothing before it, one address, nothing after the network.
export interface SendCommand {
  amount?: string;
  /** The coin's symbol as typed, upper case ("USDC", "ETH"). None: the person picks the coin in Send. */
  coin?: string;
  /** The address or account as typed (one token: a URI form like base:0x… is read by detect.ts). */
  to: string;
  /** What followed "on", if anything ("base", "BNB Chain"). */
  on?: string;
}

export type Read = { ok: SendCommand } | { problem: string } | null;

const VERB = /^\s*(send|pay)\b/i;
/** Something that could be an address or account (0x…, base58, a 64-hex key, name.near, a prefix:address). */
const ADDRESSY = /0x[0-9a-f]{6,}|[1-9A-HJ-NP-Za-km-z]{25,}|[0-9a-f]{64}|\b[a-z0-9_-]+\.(near|tg)\b|\b[a-z][a-z0-9-]{1,15}:\S{20,}/i;
const COMMAND = /^\s*(?:send|pay)\s+(?:(money)\s+|(\$)?(\d+(?:\.\d+)?)\s*([A-Za-z][A-Za-z0-9]{1,9})?\s+|([A-Za-z][A-Za-z0-9]{1,9})\s+)?to\s+(\S+)(?:\s+on\s+([A-Za-z0-9][A-Za-z0-9 ]{0,23}?))?\s*$/i;

/** Is this composer text a send command (and so never posted to the channel as a message)? */
export const looksLikeSend = (text: string): boolean => VERB.test(text) && /\bto\b/i.test(text);

/**
 * The command in the person's own text, a plain reason it can't be read, or null when it isn't a command at all (then
 * it is posted as a message). Never sends anything: the caller opens Wallet's Send with what it says.
 */
export function readSend(text: string): Read {
  if (!looksLikeSend(text)) return null;
  if (text.length > 400) return { problem: "That's too long to be a payment. Say: send 5 USDC to <address>." };
  const m = COMMAND.exec(text);
  // "send it to me later": chat, not a payment. Only text naming something like an address is held back.
  if (!m && !ADDRESSY.test(text)) return null;
  if (!m) {
    const tokens = text.split(/\s+/).filter((t) => /^(0x[0-9a-f]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/i.test(t));
    if (tokens.length > 1) return { problem: "That names more than one address. Send to one at a time." };
    if (/https?:\/\//i.test(text)) return { problem: "That's a web link, not an address. Paste the address itself." };
    return { problem: "That isn't a payment ZeroFee can read. Say: send 5 USDC to <address>, or send money to <address>." };
  }
  const [, money, dollar, number, coinAfter, coinOnly, to, on] = m;
  if (/^https?:/i.test(to!)) return { problem: "That's a web link, not an address. Paste the address itself." };
  const coinWord = (coinAfter ?? coinOnly)?.toUpperCase();
  if (coinWord === "MONEY" || money) return { ok: { to: to!, ...(on ? { on: on.trim() } : {}) } };
  if (number !== undefined) {
    if (!(Number(number) > 0)) return { problem: "The amount must be more than 0." };
    if (dollar) {
      if (coinWord) return { problem: "Say the amount once: $5, or 5 USDC." };
      return { ok: { amount: number, coin: "USDC", to: to!, ...(on ? { on: on.trim() } : {}) } };
    }
    if (!coinWord) return { problem: `Say which coin: send ${number} USDC to …, or send ${number} SOL to ….` };
    return { ok: { amount: number, coin: coinWord, to: to!, ...(on ? { on: on.trim() } : {}) } };
  }
  return { ok: { ...(coinWord ? { coin: coinWord } : {}), to: to!, ...(on ? { on: on.trim() } : {}) } };
}

/** "request 5 USDC from bob.near" (J3 part 2: a NEAR name as an address), from the person's own composer only. */
export interface AskCommand {
  amount: string;
  coin: string;
  /** The NEAR account asked, lower case. */
  from: string;
}
const ASK = /^\s*request\s+(\$)?(\d+(?:\.\d+)?)\s*([A-Za-z][A-Za-z0-9]{1,9})?\s+from\s+(\S+)\s*$/i;
const NEAR_NAME = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)+([a-z\d]+[-_])*[a-z\d]+$/;

/** The ask in the person's own text, a plain reason it can't be read, or null when it isn't one (then it is posted). */
export function readAsk(text: string): { ok: AskCommand } | { problem: string } | null {
  if (!/^\s*request\b/i.test(text) || !/\bfrom\b/i.test(text)) return null;
  const m = ASK.exec(text);
  if (!m) return /\.(near|testnet|tg)\b/i.test(text) ? { problem: "That isn't a request ZeroFee can read. Say: request 5 USDC from bob.near." } : null;
  const [, dollar, number, coinWord, who] = m;
  if (!(Number(number) > 0)) return { problem: "The amount must be more than 0." };
  if (dollar && coinWord) return { problem: "Say the amount once: $5, or 5 USDC." };
  const coin = dollar ? "USDC" : coinWord?.toUpperCase();
  if (!coin) return { problem: `Say which coin: request ${number} USDC from ….` };
  const from = who!.toLowerCase().replace(/^@/, "");
  if (!NEAR_NAME.test(from)) return { problem: "Ask a NEAR account, like bob.near." };
  return { ok: { amount: number!, coin, from } };
}

// Audit L16 (3 Nov): what goes to Claude (Anthropic, and the relay on the free reading) never holds an address the
// person typed, nor an address or a NEAR name from receipts, mail, tool answers or memory. Each one becomes a stand-in
// ("a1", "a2"…) for the request only; the phone keeps the list (per chat, append-only, so a stand-in always means the
// same one and the thread's cache holds) and turns stand-ins back into the real ones: in the tool calls Claude makes
// (the money tools still check the real payee against the person's own words, on the phone) and in Claude's words on
// screen. The kept thread holds the real words; only the request is masked. Pure: node tests it.
import type Anthropic from "@anthropic-ai/sdk";
type Msg = Anthropic.MessageParam;

/** An address: ETH (RH) 0x…, a NEAR implicit account (64 hex), a Solana or Bitcoin-style base58 run. */
const ADDRESS = /\b0x[0-9a-fA-F]{40}\b|\b[0-9a-f]{64}\b|\b(?:bc1|tb1)[02-9ac-hj-np-z]{11,71}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
/** A NEAR name (it ends in .near or .tg). */
const NEAR_NAME = /\b[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*\.(?:near|tg)\b/gi;
/** A stand-in as Claude writes it back. */
const STAND_IN = /\ba([1-9]\d{0,2})\b/g;

const standIn = (list: string[], real: string): string => {
  let i = list.indexOf(real);
  if (i < 0) i = list.push(real) - 1;
  return `a${i + 1}`;
};
/** A text with each address (and, in data, each NEAR name) as its stand-in; new ones are added to `list`. */
export function maskText(text: string, list: string[], names: boolean): string {
  let out = text.replace(ADDRESS, (m) => standIn(list, m));
  if (names) out = out.replace(NEAR_NAME, (m) => standIn(list, m.toLowerCase()));
  return out;
}
/** Claude's stand-ins, back to the real ones (an unknown stand-in stays as written). */
export function unmaskText(text: string, list: readonly string[]): string {
  return text.replace(STAND_IN, (m, n: string) => list[Number(n) - 1] ?? m);
}
/** A tool call's input with every stand-in back to the real one (strings, and strings in arrays). */
export function unmaskInput(input: Record<string, unknown>, list: readonly string[]): Record<string, unknown> {
  const one = (v: unknown): unknown => (typeof v === "string" ? unmaskText(v, list) : Array.isArray(v) ? v.map(one) : v);
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, one(v)]));
}

/** The person's own words mask addresses only (a NEAR name they typed stays: Claude needs it to read the ask); data
 *  (fenced reads, tool answers, ZeroFee's notes, memory) masks NEAR names too. Claude's own blocks are left as they
 *  are (it only ever saw stand-ins), so its thinking and tool calls replay byte for byte. */
export function maskMessages(messages: readonly Msg[], list: string[]): Msg[] {
  return messages.map((m): Msg => {
    // ZeroFee's own lines kept as an assistant turn (a reason said, "ZeroFee said: …") may name a payee: masked too
    if (m.role !== "user") {
      if (typeof m.content !== "string") return m;
      const t = maskText(m.content, list, true);
      return t === m.content ? m : { ...m, content: t };
    }
    if (typeof m.content === "string") {
      const data = /^<data-[0-9a-f]+>/.test(m.content);
      const t = maskText(m.content, list, data);
      return t === m.content ? m : { ...m, content: t };
    }
    let changed = false;
    const blocks = m.content.map((b) => {
      if (b.type === "text") {
        const t = maskText(b.text, list, true);
        if (t === b.text) return b;
        changed = true;
        return { ...b, text: t };
      }
      if (b.type === "tool_result" && typeof b.content === "string") {
        const t = maskText(b.content, list, true);
        if (t === b.content) return b;
        changed = true;
        return { ...b, content: t };
      }
      return b;
    });
    return changed ? { ...m, content: blocks } : m;
  });
}

/** Claude's words as they stream, with stand-ins turned back: a piece that ends part-way into one ("a", "a1" before a
 *  "2") waits for the next piece. `end()` gives what's left. */
export function unmaskStream(list: readonly string[]) {
  let carry = "";
  return {
    next(delta: string): string {
      const s = carry + delta;
      const cut = /\ba\d{0,3}$/.exec(s);
      carry = cut ? cut[0] : "";
      return unmaskText(cut ? s.slice(0, cut.index) : s, list);
    },
    end(): string {
      const s = carry;
      carry = "";
      return unmaskText(s, list);
    },
  };
}

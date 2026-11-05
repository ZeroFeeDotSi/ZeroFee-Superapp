// AgentZero's words as a small, safe piece of Markdown (product decision, 3 Nov: replies showed raw "**"). Our own parser, no
// dependency, and it builds data only: the screen turns it into React elements (MdText.tsx), never HTML, so a "<script>"
// in Claude's words is shown as text. The subset: **bold**, *italic*, `code`, fenced code, bulleted and numbered lists,
// headings (#, ##, ### are one modest bold line), paragraphs and line breaks, and links (their words and the host).
// While a reply still streams, a mark that hasn't closed yet is dropped and its words show plain: "**ke" reads "ke",
// never "**ke", and turns bold once the closing "**" comes. Pure, so node tests it (md.test.ts).

export type Inline =
  | { t: "text"; s: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "code"; s: string }
  | { t: "link"; c: Inline[]; host: string; url: string };

export type Block =
  | { t: "p"; lines: Inline[][] }
  | { t: "h"; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "pre"; s: string };

/** The longest text this parses (a reply is capped well under this); the rest shows as plain text. */
const MAX = 40_000;

/** The host of an http(s) link, lower case, or "" (any other scheme is no link). */
export function linkHost(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

/** Where a run of `mark` closes in s from `from` on (its last char not after a space), or -1. Skips code spans. */
function closer(s: string, from: number, mark: string): number {
  for (let j = from; j < s.length; j++) {
    const c = s[j]!;
    if (c === "`") {
      const e = s.indexOf("`", j + 1);
      if (e < 0) return -1;
      j = e;
      continue;
    }
    if (mark === "*" && s.startsWith("**", j)) { j++; continue; }
    if (s.startsWith(mark, j) && !isSpace(s[j - 1]) && j > from) {
      if (mark === "*" && s[j + 1] === "*") continue;
      return j;
    }
  }
  return -1;
}

/** One line's inline marks. `open`: the text may still grow (an unclosed mark is dropped, never shown). */
export function inline(s: string, open = false): Inline[] {
  // where a mark was looked for and found no close: no later one closes either (keeps a long line linear)
  const none = new Map<string, number>();
  const closeAt = (from: number, mark: string) => {
    if ((none.get(mark) ?? Infinity) <= from) return -1;
    const e = closer(s, from, mark);
    if (e < 0) none.set(mark, from);
    return e;
  };
  const find = (ch: string, from: number) => {
    if ((none.get(ch) ?? Infinity) <= from) return -1;
    const e = s.indexOf(ch, from);
    if (e < 0) none.set(ch, from);
    return e;
  };
  const out: Inline[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ t: "text", s: buf }); buf = ""; } };
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && i + 1 < s.length && /[\\`*_[\]#()-]/.test(s[i + 1]!)) { buf += s[++i]; continue; }
    if (c === "`") {
      if (open && /^`+$/.test(s.slice(i, i + 4)) && i + 4 >= s.length) break; // a fence or span mark still being typed
      const e = find("`", i + 1);
      if (e > i + 1) { flush(); out.push({ t: "code", s: s.slice(i + 1, e) }); i = e; continue; }
      if (e < 0 && open) continue; // a code span still coming: its words show plain
      buf += c;
      continue;
    }
    if (c === "*" || c === "_") {
      const two = s[i + 1] === c;
      const mark = two ? c + c : c;
      const after = s[i + mark.length];
      // "_" marks only at a word's edge (snake_case stays as typed)
      const edge = c === "*" || !/[\p{L}\p{N}]/u.test(s[i - 1] ?? "");
      if (!isSpace(after) && edge) {
        const e = closeAt(i + mark.length, mark);
        if (e > 0 && (c === "*" || !/[\p{L}\p{N}]/u.test(s[e + mark.length] ?? ""))) {
          flush();
          out.push({ t: two ? "b" : "i", c: inline(s.slice(i + mark.length, e)) });
          i = e + mark.length - 1;
          continue;
        }
        if (open) { i += mark.length - 1; continue; } // not closed yet: drop the mark
      } else if (open && after === undefined) {
        i += mark.length - 1; // a mark at the very end of what came so far
        continue;
      }
      buf += mark;
      i += mark.length - 1;
      continue;
    }
    if (c === "[") {
      const close = find("]", i + 1);
      if (close > i && s[close + 1] === "(") {
        const end = find(")", close + 2);
        if (end > 0) {
          const url = s.slice(close + 2, end).trim();
          const host = linkHost(url);
          flush();
          if (host) out.push({ t: "link", c: inline(s.slice(i + 1, close)), host, url });
          else out.push(...inline(s.slice(i + 1, close))); // not a web link: its words only
          i = end;
          continue;
        }
        if (open) { flush(); out.push(...inline(s.slice(i + 1, close), true)); return out; } // the address still coming
      }
      if (open && close === s.length - 1) { flush(); out.push(...inline(s.slice(i + 1, close), true)); return out; } // "(" next
      if (close < 0 && open) continue; // the link's words still coming: they show plain
      buf += c;
      continue;
    }
    buf += c;
  }
  flush();
  return out;
}

const FENCE = /^\s{0,3}(```|~~~)/;
const HEAD = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s{0,8}[-*+•]\s+(.*)$/;
const NUMBERED = /^\s{0,8}(\d{1,4})[.)]\s+(.*)$/;
const RULE = /^\s{0,3}(?:[-*_]\s*){3,}$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
/** A line that is only a mark still being typed ("#", "-", "1.", "``"): nothing to show yet. */
const BARE = /^\s*(?:#{1,6}|[-*+•]|\d{1,4}[.)]|`{1,2}|~{1,2}|\|)\s*$/;

/**
 * The text as blocks. `streaming`: the reply is still coming, so its last line may be half a mark: an unclosed mark there
 * is dropped, and a line that's only a mark ("##", "-") waits.
 */
export function parse(text: string, streaming = false): Block[] {
  const lines = text.slice(0, MAX).replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: Inline[][] | null = null;
  let list: Extract<Block, { t: "ul" | "ol" }> | null = null;
  const end = () => { para = null; list = null; };
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k]!;
    const last = streaming && k === lines.length - 1;
    const fence = FENCE.exec(raw);
    if (fence) {
      end();
      const body: string[] = [];
      let j = k + 1;
      while (j < lines.length && !new RegExp(`^\\s{0,3}${fence[1]}`).test(lines[j]!)) body.push(lines[j++]!);
      // while streaming, a closing fence half typed ("``") is not code
      if (streaming && j >= lines.length && /^\s*`{1,2}$/.test(body.at(-1) ?? "")) body.pop();
      if (body.length || j < lines.length) blocks.push({ t: "pre", s: body.join("\n") });
      k = j;
      continue;
    }
    if (TABLE_RULE.test(raw) && !RULE.test(raw)) continue; // a table's dashes row: the rows read on as lines
    if (!raw.trim() || RULE.test(raw) || (last && BARE.test(raw))) { end(); continue; }
    // a table row ("| a | b |", which the prompt asks Claude not to write) reads as its cells, joined
    const line = /^\s*\|.*\|\s*$/.test(raw) ? raw.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).filter(Boolean).join(" · ") : raw;
    const h = HEAD.exec(line);
    if (h) { end(); if (h[2]) blocks.push({ t: "h", c: inline(h[2], last) }); continue; }
    const b = BULLET.exec(line);
    const n = b ? null : NUMBERED.exec(line);
    if (b || n) {
      para = null;
      const kind = b ? "ul" : "ol";
      if (!list || list.t !== kind) {
        list = kind === "ul" ? { t: "ul", items: [] } : { t: "ol", start: Number(n![1]), items: [] };
        blocks.push(list);
      }
      list.items.push(inline(b ? b[1]! : n![2]!, last));
      continue;
    }
    const quote = line.replace(/^\s{0,3}>\s?/, "");
    // a line under a list item with no mark of its own continues that item
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1]!.push({ t: "text", s: " " }, ...inline(quote.trim(), last)); continue; }
    list = null;
    if (!para) { para = []; blocks.push({ t: "p", lines: para }); }
    para.push(inline(quote, last));
  }
  return blocks;
}

/** The hosts a link in AgentZero's words may open (each on $ZEROFEE_HOME/tools/gate-hosts.txt), exactly, never a
 *  subdomain; it opens in the app's own sheet (device.openUrl), https only. Any other link is its words and its host. */
export const OPEN_HOSTS: ReadonlySet<string> = new Set(["zerofee.si", "console.anthropic.com", "nearblocks.io", "pump.fun"]);
export const opens = (url: string): boolean => url.startsWith("https://") && OPEN_HOSTS.has(linkHost(url));

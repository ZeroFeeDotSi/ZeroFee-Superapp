import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inline, opens, parse, type Block, type Inline } from "./md.ts";

/** What a reader sees: marks as tags, so a stray "*" or "#" is plain to spot. */
const show = (c: Inline[]): string => c.map((n) => (n.t === "text" ? n.s : n.t === "code" ? `<c>${n.s}</c>` : n.t === "link" ? `<a>${show(n.c)}|${n.host}</a>` : `<${n.t}>${show(n.c)}</${n.t}>`)).join("");
const view = (bs: Block[]): string[] => bs.map((b) => (b.t === "p" ? `p:${b.lines.map(show).join("/")}` : b.t === "h" ? `h:${show(b.c)}` : b.t === "pre" ? `pre:${b.s}` : `${b.t}${b.t === "ol" ? b.start : ""}:${b.items.map(show).join("|")}`));

test("bold, italic and code; the control: plain words stay one text run", () => {
  assert.equal(show(inline("a **key** word")), "a <b>key</b> word");
  assert.equal(show(inline("an *easy* one and _this_")), "an <i>easy</i> one and <i>this</i>");
  assert.equal(show(inline("run `npm i` now")), "run <c>npm i</c> now");
  assert.equal(show(inline("**bold with *italic* in it**")), "<b>bold with <i>italic</i> in it</b>");
  assert.deepEqual(inline("just plain words"), [{ t: "text", s: "just plain words" }]);
});

test("a lone * or _ that isn't a mark stays as typed: 2 * 3, snake_case, a done reply's unclosed **", () => {
  assert.equal(show(inline("2 * 3 * 4")), "2 * 3 * 4");
  assert.equal(show(inline("my_wallet_name")), "my_wallet_name");
  assert.equal(show(inline("a ** b")), "a ** b");
  assert.equal(show(inline("**never closed")), "**never closed");
});

test("streaming: an unclosed mark is dropped and its words show plain; it turns bold once closed (never a flash of *)", () => {
  const steps = ["The **", "The **ke", "The **key", "The **key*", "The **key**", "The **key** word"];
  const seen = steps.map((s) => show(inline(s, true)));
  assert.deepEqual(seen, ["The ", "The ke", "The key", "The key", "The <b>key</b>", "The <b>key</b> word"]);
  for (const s of seen) assert.ok(!s.includes("*"), s);
  assert.equal(show(inline("say `np", true)), "say np");
  assert.equal(show(inline("say *so", true)), "say so");
  assert.equal(show(inline("tail *", true)), "tail ");
  // the control: the same half-written text when the reply is done keeps its marks as typed
  assert.equal(show(inline("The **ke", false)), "The **ke");
});

test("links: their words and host; never clickable off the short list, never a non-web scheme", () => {
  assert.equal(show(inline("see [the docs](https://docs.near.org/x)")), "see <a>the docs|docs.near.org</a>");
  assert.equal(show(inline("[click](javascript:alert(1))")), "click)");
  assert.equal(show(inline("[half](https://ne", true)), "half");
  assert.equal(show(inline("[half", true)), "half");
  assert.equal(show(inline("[half]", true)), "half");
  assert.equal(opens("https://nearblocks.io/tx/1"), true);
  assert.equal(opens("https://evil.nearblocks.io/"), false);
  assert.equal(opens("http://nearblocks.io/"), false);
  assert.equal(opens("https://docs.near.org/"), false);
});

test("blocks: paragraphs and line breaks, modest headings, lists, fenced code", () => {
  const t = "# Plan\nFirst line\nsecond line\n\n- one\n- **two**\n\n1. a\n2. b\n\n```js\nconst x = 1 * 2;\n```\nend";
  assert.deepEqual(view(parse(t)), ["h:Plan", "p:First line/second line", "ul:one|<b>two</b>", "ol1:a|b", "pre:const x = 1 * 2;", "p:end"]);
  assert.deepEqual(view(parse("### Small\n3. c\n4. d")), ["h:Small", "ol3:c|d"]);
  assert.deepEqual(view(parse("* star item\n+ plus item")), ["ul:star item|plus item"]);
  // tables and rules (the prompt asks for none) read as words, with no pipes or dashes
  assert.deepEqual(view(parse("| a | b |\n|---|---|\n| 1 | 2 |\n\n---\nafter")), ["p:a · b/1 · 2", "p:after"]);
});

test("streaming blocks: a line that's only a mark waits; an open fence shows its code so far", () => {
  assert.deepEqual(view(parse("Hi\n\n##", true)), ["p:Hi"]);
  assert.deepEqual(view(parse("- one\n-", true)), ["ul:one"]);
  assert.deepEqual(view(parse("- one\n2.", true)), ["ul:one"]);
  assert.deepEqual(view(parse("x\n```\ncode here\n``", true)), ["p:x", "pre:code here"]);
  assert.deepEqual(view(parse("x\n``", true)), ["p:x"]);
  // the control: a finished reply's lone "-" is a word
  assert.deepEqual(view(parse("- one\n-", false)), ["ul:one", "p:-"]);
});

test("script and HTML are text: the parser has no HTML, and the renderer builds elements only", () => {
  const t = "<script>alert(1)</script> <img src=x onerror=alert(1)> **<b>hi</b>**";
  assert.equal(show(inline(t)), "<script>alert(1)</script> <img src=x onerror=alert(1)> <b><b>hi</b></b>");
  assert.deepEqual(parse(t)[0], { t: "p", lines: [[{ t: "text", s: "<script>alert(1)</script> <img src=x onerror=alert(1)> " }, { t: "b", c: [{ t: "text", s: "<b>hi</b>" }] }]] });
  const src = readFileSync(new URL("./MdText.tsx", import.meta.url), "utf8") + readFileSync(new URL("./md.ts", import.meta.url), "utf8");
  assert.ok(!/dangerouslySetInnerHTML|innerHTML|\beval\(/.test(src));
  // the control: the check would see it if it were there
  assert.ok(/dangerouslySetInnerHTML/.test("<div dangerouslySetInnerHTML={x} />"));
});

test("the chat renders Claude's words through MdText, both the plain path and the figures path", () => {
  const src = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("<MdText text={p.text} streaming={streaming} {...(streaming ? { leaf: wordLeaf } : {})} />"));
  assert.ok(src.includes("<MdText text={body} streaming={streaming} leaf={leaf} />"));
  assert.ok(!src.includes('<p className="azc-text">{p.text}</p>'));
});

test("a long reply parses in linear time (no backtracking blow-up)", () => {
  const t0 = Date.now();
  parse("*a ".repeat(5000) + "**b ".repeat(5000) + "[x".repeat(3000), true);
  assert.ok(Date.now() - t0 < 1500);
});

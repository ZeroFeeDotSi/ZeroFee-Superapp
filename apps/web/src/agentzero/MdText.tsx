// AgentZero's words with their Markdown shown (md.ts parses; this builds React elements only, never HTML). `leaf` turns
// each run of plain words into what the screen shows for it (the figures' chips in an answer about money, fact-text.ts).
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { opens, parse, type Block, type Inline } from "./md.ts";

export type Leaf = (words: string, key: string) => ReactNode;
const plain: Leaf = (w) => w;

function Inlines({ c, leaf, k }: { c: Inline[]; leaf: Leaf; k: string }) {
  const { bridge } = useShell();
  return (
    <>
      {c.map((n, i) => {
        const key = `${k}.${i}`;
        switch (n.t) {
          case "text": return <Fragment key={key}>{leaf(n.s, key)}</Fragment>;
          case "b": return <strong key={key}><Inlines c={n.c} leaf={leaf} k={key} /></strong>;
          case "i": return <em key={key}><Inlines c={n.c} leaf={leaf} k={key} /></em>;
          case "code": return <code key={key} className="azc-code">{leaf(n.s, key)}</code>;
          case "link": {
            const words = <Inlines c={n.c} leaf={leaf} k={key} />;
            return opens(n.url)
              ? <button key={key} type="button" className="azc-mdlink" onClick={() => void bridge.call("device.openUrl", { url: n.url, mode: "sheet" })}>{words} <span className="azc-host">({n.host})</span></button>
              : <span key={key}>{words} <span className="azc-host">({n.host})</span></span>;
          }
        }
      })}
    </>
  );
}

function BlockEl({ b, leaf, k }: { b: Block; leaf: Leaf; k: string }) {
  switch (b.t) {
    case "p": return <p>{b.lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}<Inlines c={l} leaf={leaf} k={`${k}.${i}`} /></Fragment>)}</p>;
    case "h": return <p className="azc-h"><Inlines c={b.c} leaf={leaf} k={k} /></p>;
    case "ul": return <List as="ul" items={b.items} leaf={leaf} k={k} />;
    case "ol": return <List as="ol" start={b.start} items={b.items} leaf={leaf} k={k} />;
    case "pre": return <pre className="azc-pre"><code>{leaf(b.s, k)}</code></pre>;
  }
}

/** A list shows five items, then "and N more" (the chat flow, 5 Nov: "what can you do" was nine bold lines, a manual, not a
 *  reply); a tap shows the rest. A list of six shows all six (one hidden line is not worth a tap). */
export const LIST_CAP = 5;
function List({ as, items, start, leaf, k }: { as: "ul" | "ol"; items: Inline[][]; start?: number | undefined; leaf: Leaf; k: string }) {
  const [all, setAll] = useState(false);
  const over = items.length - LIST_CAP;
  const capped = over > 1 && !all;
  const Tag = as;
  return (
    <Tag className={`azc-list${capped ? " is-capped" : ""}`} {...(start !== undefined ? { start } : {})}>
      {items.map((it, i) => <li key={i}><Inlines c={it} leaf={leaf} k={`${k}.${i}`} /></li>)}
      {capped && <li className="azc-more"><button type="button" onClick={() => setAll(true)}>and {over} more</button></li>}
    </Tag>
  );
}

/** The words as blocks; `streaming`: still coming, so a mark that hasn't closed yet never shows. */
export function MdText({ text, streaming = false, leaf = plain }: { text: string; streaming?: boolean; leaf?: Leaf }) {
  const blocks = useMemo(() => parse(text, streaming), [text, streaming]);
  return <div className="azc-text azc-md">{blocks.map((b, i) => <BlockEl key={i} b={b} leaf={leaf} k={String(i)} />)}</div>;
}

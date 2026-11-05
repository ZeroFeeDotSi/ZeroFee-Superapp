// What every provider screen says (the product rule: ZeroFee is never in the middle and endorses nothing): the
// provider's own costs, each with the source of the figure, and who the person is the customer of. Its other facts, in
// its own words, sit behind one quiet row, "What X says" (the robot's walk: at most three lines before the pill).
import { useState } from "react";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { providerLine } from "@zerofee/shell-api/provider-words.ts";
import { costLines, providerById, type Provider } from "../../countries.ts";

/** Its costs in one line: each with who says it, or that its own page has them. */
export const costsLine = (p: Provider | undefined) => {
  const costs = p ? costLines(p) : [];
  return costs.length ? costs.join(" ") : "Its own page has its costs.";
};

/** The quiet row and its sheet: its costs again, that its own page has the current ones, its facts, and `extra`. */
export function WhatItSays({ provider, name, extra = [] }: { provider: Provider | undefined; name: string; extra?: readonly string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="py-row py-row--tap" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
        <span />
        <div><div className="t">What {name} says</div></div>
        <span className="v">›</span>
      </button>
      {open && (
        <Sheet title={`What ${name} says`} onClose={() => setOpen(false)}>
          <div style={{ display: "grid", gap: 8 }}>
            {(provider ? costLines(provider) : []).map((c) => <p key={c} className="zf-body">{c}</p>)}
            <p className="zf-body">Its own page has the current costs.</p>
            {provider?.facts.map((f) => <p key={f} className="zf-body">{f}</p>)}
            {extra.map((x) => <p key={x} className="zf-body">{x}</p>)}
          </div>
        </Sheet>
      )}
    </>
  );
}

export function ProviderFacts({ id, name }: { id?: string; name: string }) {
  const p = providerById(id);
  return (
    <div style={{ marginTop: 14 }}>
      <p className="zf-small">{costsLine(p)}</p>
      <p className="zf-small" style={{ marginTop: 6 }}>{providerLine(name)}</p>
      <WhatItSays provider={p} name={name} />
    </div>
  );
}

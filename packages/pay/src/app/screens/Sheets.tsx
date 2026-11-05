// The small choices: which coin pays, which network an address is on, how much when the code didn't say, and whether
// to open the web page a code points to.
import { useState } from "react";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { isPositive } from "@zerofee/design/keypad.ts";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { Check } from "@zerofee/design/icons.tsx";
import { chain, chainName } from "../../chains.ts";
import { siteOf } from "../../codes/parse.ts";
import type { Confirm } from "../../pay.ts";
import { shown } from "../format.ts";

/** "Pay with": only coins that can pay this right now (D13: nothing that doesn't work is on screen). */
export function CoinSheet({ c, onPick, onClose }: { c: Confirm; onPick: (tokenId: string) => void; onClose: () => void }) {
  const all = [c.source, ...c.alternatives];
  return (
    <Sheet title="Pay with" onClose={onClose}>
      <div className="py-rows">
        {all.map((s) => (
          <button key={s.balance.tokenId} className="py-row py-pick" onClick={() => onPick(s.balance.tokenId)}>
            <CoinIcon symbol={s.balance.symbol} icon={s.balance.icon} size={26} />
            <span><span className="t" style={{ display: "block" }}>{s.balance.symbol}</span><span className="d" style={{ display: "block" }}>On {chainName(s.balance.chain)} · {s.sameCoin ? "no conversion" : "converted on the way"}</span></span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="v">{shown(s.balance.amount, 2)}</span>
              <span className={`zf-tick ${s === c.source ? "on" : ""}`}>{s === c.source && <Check />}</span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** The code left the network open (a bare 0x address works on every EVM chain): the person picks, never a guess. */
export function NetworkSheet({ networks, onPick, onClose }: { networks: string[]; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <Sheet title="Which network?" onClose={onClose}>
      <p className="zf-small" style={{ marginBottom: 8 }}>Ask the person you're paying. Sending on the wrong one can lose the money.</p>
      <div className="py-rows">
        {networks.map((id) => (
          <button key={id} className="py-row py-pick" onClick={() => onPick(id)}>
            <CoinIcon symbol={chainName(id)} icon={chain(id) ? id : undefined} size={26} />
            <span className="t">{chainName(id)}</span>
            <span />
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** A code that is a web page: the site first, in full, and the person decides. A sticker over a code can point anywhere. */
export function WebSheet({ url, onOpen, onClose }: { url: string; onOpen: () => void; onClose: () => void }) {
  const { site, lookalike } = siteOf(url);
  // The whole address under the site when it goes anywhere past the front page, never cut (UI).
  const u = new URL(url);
  const rest = `${u.pathname}${u.search}${u.hash}`;
  return (
    <Sheet title="Open this page?" onClose={onClose}>
      <h2 className="zf-title" style={{ wordBreak: "break-all" }}>{site}</h2>
      {rest !== "/" && <p className="py-mono zf-small" style={{ marginTop: 6, wordBreak: "break-all" }}>{site}{rest}</p>}
      {lookalike && <p className="zf-small" style={{ marginTop: 8 }}>This address uses look-alike letters. Open it only if you expected it.</p>}
      <p className="zf-small" style={{ marginTop: 8 }}>This page isn't ZeroFee. Never type your backup words into it.</p>
      <div className="py-floor">
        <button className="zf-btn" onClick={onOpen}>Open page</button>
        <button className="zf-link" onClick={onClose}>Not now</button>
      </div>
    </Sheet>
  );
}

/** The code named no amount: type it, in the coin the code asks for. */
export function AmountAsk({ symbol, decimals, onAmount }: { symbol: string; decimals: number; onAmount: (amount: string) => void }) {
  const [value, setValue] = useState("0");
  return (
    <div className="py py-col">
      <div className="py-center" style={{ paddingTop: 36 }}>
        <div className="zf-label">How much?</div>
        <div className="py-big" style={{ marginTop: 18 }}>{value} <small>{symbol}</small></div>
      </div>
      <div className="zf-fill" />
      <Keypad value={value} decimals={decimals} onChange={setValue} />
      <div className="py-floor"><button className="zf-btn" disabled={!isPositive(value)} onClick={() => onAmount(value.replace(/\.$/, ""))}>Review</button></div>
    </div>
  );
}

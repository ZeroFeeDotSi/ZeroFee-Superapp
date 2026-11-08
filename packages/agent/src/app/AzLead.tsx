// The Jobs page's lead (product decision, 5 Nov; the old line "to fulfil any
// requirement" was too broad). Only what AgentZero really does on this account, end to end (drop, don't degrade): the
// copy job only where it can start, pocket money only where the account gives it. Then the fee line: AgentZero's
// thinking is paid at Anthropic's own price, nothing added (core agent-price.ts REPLY_PRICES, the relay's PRICES held
// equal by a test), and the core refuses any trade or swap route that carries an app fee (sol/payout.ts, evm/decode.ts,
// intents.ts ownAppFees). So ZeroFee takes $0.

/** The lead's heading. */
export const LEAD_TITLE = "What it does";
/** One line per feature, each one idea (the copy bar: a 5-year-old reads it). */
export const LEAD_COPY = "Copies a wallet's trades on pump.fun.";
export const LEAD_SIGN_IN = "Signs you in to pump.fun and GMGN.";
export const LEAD_POCKET = "Spends only what you put in its wallet.";
export const LEAD_RECEIPT = "Shows a receipt for every move.";
/** The fee line. */
export const FEE_LINE = "Fees: 100% to the AI model. $0 to ZeroFee.";

/** The lines this account gets, in order: never one AgentZero can't do here. */
export function leadLines(o: { copy: boolean; pocket: boolean }): string[] {
  return [...(o.copy ? [LEAD_COPY] : []), LEAD_SIGN_IN, ...(o.pocket ? [LEAD_POCKET] : []), LEAD_RECEIPT];
}

export function AzLead({ copy, pocket }: { copy: boolean; pocket: boolean }) {
  return (
    <section className="ag-lead" aria-label={LEAD_TITLE}>
      <div className="zf-label ag-section">{LEAD_TITLE}</div>
      <div className="ag-rows ag-rows--tight">
        {leadLines({ copy, pocket }).map((l) => <div key={l} className="ag-row"><span className="t">{l}</span></div>)}
      </div>
      {/* each sentence kept whole on a narrow phone, so "$0" never ends a line alone */}
      <p className="zf-body ag-fee">{FEE_LINE.split(/(?<=\.) /).map((part, i) => <span key={part}>{i > 0 ? " " : ""}<span className="ag-nowrap">{part}</span></span>)}</p>
    </section>
  );
}

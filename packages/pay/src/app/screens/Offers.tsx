// "What's available" (D36, D37 step 2): for the person's bank country, every provider of each section (Card · Bank
// account · Exchange) in one stated neutral order, A–Z: ZeroFee ranks and endorses none (the product rule, Security's
// review). One made only in its own app says so in its row. Each signs up on its own page in
// Pay's window; one made only in its own app says so, behind See all. Then which bank codes Scan pays there.
import { ELSEWHERE, countryFor, countryName, groupsFor, type Provider, type Section } from "../../countries.ts";

const TITLE: Record<Section, string> = { card: "Card", bank: "Bank account", exchange: "Exchange", voucher: "Gift cards and top-ups" };
/** "3 steps: an account, an ID check, the card": what the person does there before it's usable (registry steps). */
const stepsLine = (p: Provider) => `${p.steps.length === 1 ? "1 step" : `${p.steps.length} steps`}: ${p.steps.join(", ")}`;

/** `onLater`: back to Home; none when this is Pay's home itself (the gate, D38: no Home until a provider exists). */
/** `added`: already set up: marked "Added", and its tap opens its own page. */
export function Offers({ code, kid, added, onPick, onCountry, onLater }: { code: string; kid: boolean; added?: (p: Provider) => boolean; onPick: (p: Provider) => void; onCountry: () => void; onLater?: () => void }) {
  const country = countryFor(code);
  const row = (p: Provider) => (
    <button key={p.id} className="py-row py-row--tap" onClick={() => onPick(p)}>
      <span />
      <div><div className="t">{p.name} <span className="py-mono" style={{ fontSize: 12, color: "var(--mute)" }}>{p.domain}</span></div><div className="d">{p.signup === "app" ? `In its own app. ${p.line}` : p.line}</div><div className="d">{stepsLine(p)}</div>{p.lastChecked && <div className="d">{p.lastChecked}</div>}</div>
      <span className="v">{added?.(p) ? "Added ›" : "›"}</span>
    </button>
  );
  return (
    <div className="py py-col">
      <h1 className="zf-title py-center" style={{ marginTop: 20 }}>What's available</h1>
      <p className="zf-small py-center" style={{ marginTop: 6 }}>
        {country.code === ELSEWHERE.code ? "For your bank" : `For your bank in ${countryName(country.code)}`} · <button className="zf-link" style={{ display: "inline" }} onClick={onCountry}>Change</button>
      </p>
      <p className="zf-small py-center" style={{ marginTop: 4 }}>Listed A–Z. ZeroFee isn't in the middle.</p>
      {/* No ID check on top, then the rest under it (product decision, 27 Oct); in each, its sections in order, A–Z. */}
      {groupsFor(country, { kid }).map((g) => (
        <section key={g.label} style={{ marginTop: 22 }} aria-label={g.label}>
          <div className="zf-label" style={{ color: "var(--ink)" }}>{g.label}</div>
          {g.offers.map((o) => (
            <div key={o.section} data-kind={o.section} style={{ marginTop: 10 }}>
              <div className="zf-small">{TITLE[o.section]}</div>
              <div className="py-rows">{o.providers.map(row)}</div>
            </div>
          ))}
        </section>
      ))}
      {country.scan.length > 0 && (
        <section style={{ marginTop: 18 }} aria-label="Pay a code">
          <div className="zf-label">Pay a code</div>
          <p className="zf-small" style={{ marginTop: 6 }}>Scan reads {country.scan.join(", ")} codes. {country.exchange.length > 0 ? "Your exchange pays them, from your Safe." : "Paying them needs an exchange there."}</p>
        </section>
      )}
      <div className="zf-fill" />
      {onLater && <div className="py-floor"><button className="zf-link" onClick={onLater}>Later</button></div>}
    </div>
  );
}

// "Where is your bank?" (D36): Pay's one question, asked once. One tap answers it; Skip means anywhere else. Kept on
// this phone, and changed from "What's available". Each place is named in the person's own language.
import { Check } from "@zerofee/design/icons.tsx";
import { COUNTRIES, ELSEWHERE, countryName } from "../../countries.ts";

export function CountryStep({ current, onPick }: { current?: string | null; onPick: (code: string) => void }) {
  const places = COUNTRIES.map((c) => ({ code: c.code, name: countryName(c.code) })).sort((a, b) => a.name.localeCompare(b.name));
  const row = (code: string, name: string) => (
    <button key={code} role="radio" aria-checked={current === code} data-code={code} className="py-row py-row--tap" onClick={() => onPick(code)}>
      <span className={`zf-tick ${current === code ? "on" : ""}`}>{current === code && <Check />}</span>
      <div><div className="t">{name}</div></div>
      <span />
    </button>
  );
  return (
    <div className="py py-col">
      <h1 className="zf-title py-center" style={{ marginTop: 24 }}>Where is your bank?</h1>
      <p className="zf-body py-center" style={{ marginTop: 8 }}>Pay shows what works with it. You can change this later.</p>
      <div className="py-rows" role="radiogroup" aria-label="Where is your bank?" style={{ marginTop: 16 }}>
        {places.map((p) => row(p.code, p.name))}
        {row(ELSEWHERE.code, countryName(ELSEWHERE.code))}
      </div>
      <div className="zf-fill" />
      <div className="py-floor"><button className="zf-link" onClick={() => onPick(ELSEWHERE.code)}>Skip</button></div>
    </div>
  );
}

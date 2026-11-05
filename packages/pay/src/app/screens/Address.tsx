// An address as its start and end ("starts 0x5a3e9f, ends 4c30E8"), so the person can check that what they pasted
// elsewhere (or what was pasted here) is the same address: clipboard-swapping malware changes the address and hopes
// nobody looks. Six characters each side (Security's MUST on 1ea4d90): with the middle behind Details, the ends are the
// whole check, and 4+4 hex is cheap for an address-poisoning generator to match. The whole of it under Details.
export const CHECK_LINE = "Check the start and end match after you paste.";

export function Address({ value }: { value: string }) {
  const head = value.startsWith("0x") ? 8 : 6;
  if (value.length <= head + 6) return <span className="py-mono" style={{ color: "var(--ink)" }}>{value}</span>;
  return (
    <span style={{ display: "grid", gap: 4 }}>
      <span className="zf-body" style={{ color: "var(--ink)" }}>
        starts <b className="py-mono">{value.slice(0, head)}</b>, ends <b className="py-mono">{value.slice(-6)}</b>
      </span>
      <details>
        <summary className="zf-small" style={{ cursor: "pointer" }}>Details</summary>
        <span className="py-mono" style={{ fontSize: 13, color: "var(--ink-2)", wordBreak: "break-all" }}>{value}</span>
      </details>
    </span>
  );
}

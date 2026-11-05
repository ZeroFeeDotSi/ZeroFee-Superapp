// Machine text that must never reach the person (mainnet rehearsal, 3 Nov): a 64-hex id, a NEAR service contract's id
// (NEAR Intents, wNEAR, a bridged coin's), or a coin figure with more than 4 decimals. For tests that sweep what a sheet's
// title and lines, or an Activity row, say; a sheet's disclosure (one tap away) may hold the exact figures and ids.

/** What a line says that it must not, by name; empty when it is clean. */
export function rawText(line: string): string[] {
  const found: string[] = [];
  if (/(^|[^0-9a-fA-F])[0-9a-f]{64}($|[^0-9a-fA-F])/.test(line)) found.push(`a 64-hex id: ${line}`);
  if (/\b(?:intents|wrap)\.near\b|\.(?:omft|bridge|tether-token)\.near\b/.test(line)) found.push(`a contract id: ${line}`);
  if (/\d\.\d{5,}/.test(line)) found.push(`more than 4 decimals: ${line}`);
  return found;
}

/** Every finding in a sheet's title and lines (never its disclosure). */
export const rawInSheet = (w: { title: string; lines: readonly string[] }): string[] => [w.title, ...w.lines].flatMap(rawText);

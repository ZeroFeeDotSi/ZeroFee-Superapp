// The sheet's one calm line while NEAR trades go through NEAR's public servers because ZeroFee's server isn't answering
// (rule 9a, never silent; the build's doors.ts onSwitch: a line when it switches, null when a paid door answers again). Held here
// so the open sheet hears it; said once while it lasts, gone when the server answers. The words are ONE copy, the hook's
// own (problems.ts NEAR_RELAY_SWITCHED, the design review's words: never "relay", never the vague "may").
import { useEffect, useState } from "react";
import { NEAR_RELAY_SWITCHED } from "./problems.ts";
import { OWN_SWITCHED } from "@zerofee/core/own-servers";

export const SWITCHED_LINE = NEAR_RELAY_SWITCHED;

// The person's own server missing (doors.ts own, Settings → Status) says its own line, OWN_SWITCHED, the same way.

let said: string | null = null;
const ears = new Set<(line: string | null) => void>();

/** doors.ts onSwitch: the line it says (NEAR's public servers, or the person's own server missed), null = gone. */
export function saySwitched(line: string | null): void {
  const next = line === null ? null : line === NEAR_RELAY_SWITCHED ? SWITCHED_LINE : line === OWN_SWITCHED ? OWN_SWITCHED : SWITCHED_LINE;
  if (next === said) return;
  said = next;
  for (const e of ears) e(said);
}

/** The line while it lasts, else null. */
export function useSwitchedLine(): string | null {
  const [line, setLine] = useState<string | null>(said);
  useEffect(() => { setLine(said); ears.add(setLine); return () => { ears.delete(setLine); }; }, []);
  return line;
}

/** Whether NEAR's trades are on NEAR's public servers now (tests, the Status check, and a sheet that opens mid-outage). */
export const isSwitched = (): boolean => said === SWITCHED_LINE;

// The sheet's one calm line while NEAR trades go through NEAR's public servers because ZeroFee's server isn't answering
// (rule 9a, never silent; the build's doors.ts onSwitch: a line when it switches, null when a paid door answers again). Held here
// so the open sheet hears it; said once while it lasts, gone when the server answers. The words are ONE copy, the hook's
// own (problems.ts NEAR_RELAY_SWITCHED, the design review's words: never "relay", never the vague "may").
import { useEffect, useState } from "react";
import { NEAR_RELAY_SWITCHED } from "./problems.ts";

export const SWITCHED_LINE = NEAR_RELAY_SWITCHED;

let on = false;
const ears = new Set<(on: boolean) => void>();

/** doors.ts onSwitch: any line = switched, null = a paid door answered again. */
export function saySwitched(line: string | null): void {
  const next = line !== null;
  if (next === on) return;
  on = next;
  for (const e of ears) e(on);
}

/** The line while it lasts, else null. */
export function useSwitchedLine(): string | null {
  const [is, setIs] = useState(isSwitched);
  useEffect(() => { setIs(on); ears.add(setIs); return () => { ears.delete(setIs); }; }, []);
  return is ? SWITCHED_LINE : null;
}

/** Whether the line is on now (tests, and a sheet that opens mid-outage reads it at once). */
export const isSwitched = (): boolean => on;

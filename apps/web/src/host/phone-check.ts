// The phone check before "Create my account" (H16, H17; RC-7 step 1): the chip is there, a passcode is set, and Face ID is
// set up, allowed for ZeroFee and not locked. Each blocker is its own designed Problem (security-problems.ts), never a raw
// code, and no chip means no "Try again". In a browser there is nothing to check.
import type { Problem } from "@zerofee/core/problem";
import { phoneProblem } from "@zerofee/core/security-problems";
import type { IosHost } from "./ios.ts";

/** The blocker's Problem, or null when this phone is ready (or isn't a phone, or its build can't say: the key's own check
 *  in key.create still runs and answers the same codes). `setUp`: no account yet. */
export async function phoneBlocker(host: IosHost | null, setUp = true): Promise<Problem | null> {
  if (!host) return null;
  const r = await host.call<{ blocker: string | null }>("device.phoneCheck");
  if ("problem" in r) return null;
  return phoneProblem(r.ok.blocker, setUp);
}

/** The Problem's pill opens iOS Settings (ZeroFee's own page, where its Face ID switch is). */
export const opensSettings = (p: Problem): boolean => p.next.kind === "open" && p.next.screen === "ios-settings";

export async function openSettings(host: IosHost | null): Promise<void> {
  if (host) await host.call("device.openSettings");
}

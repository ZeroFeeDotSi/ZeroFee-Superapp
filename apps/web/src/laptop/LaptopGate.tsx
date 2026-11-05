// The laptop page behind its own lock (product decision, 5 Nov): the laptop's Touch ID / Windows Hello passkey and its words. The
// second-device build's entry and the real app's /laptop both use it, so the words load with the laptop page only.
import { UnlockGate } from "../unlock/UnlockGate.tsx";
import { LAPTOP_LOCK, LAPTOP_START } from "../unlock/laptop-lock-words.ts";
import { Laptop } from "./Laptop.tsx";

/** The first screen's heading (what this page is) and its next step (product decision, 5 Nov). */
const START = { heading: LAPTOP_START.what, next: LAPTOP_START.next };

/** `gate`: off on the phone (its own lock is the app's), on everywhere else. */
export function LaptopGate({ gate = true }: { gate?: boolean }) {
  return gate ? <UnlockGate laptopWords={LAPTOP_LOCK} laptopStart={START}><Laptop /></UnlockGate> : <Laptop />;
}

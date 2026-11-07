// Pairing's step 2 says what its own button does (copy review, 7 Nov): ONE table keyed by platform. On the iPhone the floor's
// button scans the other phone's code; in a browser there is no scanner (Permissions-Policy camera=()), so it pastes.
import { keyPlatform, type KeyPlatform } from "@zerofee/shell-api/key-place.ts";

export interface PairStepTwo {
  /** step 2's line under the explain screen */
  step: string;
  /** the floor's main button (the iPhone's for your other phone; a guardian's says "Scan their code") */
  button: string;
}

export const PAIR_STEP_TWO: Readonly<Record<KeyPlatform, PairStepTwo>> = {
  iphone: { step: "Scan the code it shows.", button: "Scan its code" },
  web: { step: "Paste the code it shows here.", button: "Paste the code" },
};

export const pairStepTwo = (phone: boolean): PairStepTwo => PAIR_STEP_TWO[keyPlatform(phone)];

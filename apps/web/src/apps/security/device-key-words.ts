// How Security's Overview words the device key. The core reports where the key lives (`kind`): "secure-chip" only on
// the iPhone host, where the chip makes and keeps it; everything else is the browser's software key, kept in IndexedDB encrypted under a key the page cannot export.
import type { AccountKeyInfo } from "@zerofee/core/signer";

export const deviceKeyWords = (kind: AccountKeyInfo["kind"] | undefined) =>
  kind === "secure-chip" ? "Phone key · in the secure chip" : "Browser key · kept here, encrypted";

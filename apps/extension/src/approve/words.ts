// The approval window's own few words (D157). Copywriter: please review.
import type { Ask } from "../../../web/src/host/extension.ts";

export const momentWords = {
  /** A passkey moment's title: making the key, opening the app, or checking it's the person. */
  title: (ask: Pick<Ask, "kind" | "publicKey">): string => {
    if (ask.kind === "create") return "Make your key";
    const pk = ask.publicKey as { extensions?: unknown } | null;
    return pk && typeof pk === "object" && pk.extensions ? "Unlock ZeroFee" : "Is it you?";
  },
  /** The window lost its ask (ZeroFee's panel closed, or an old window). */
  gone: "This check has ended. Open ZeroFee and try again.",
};

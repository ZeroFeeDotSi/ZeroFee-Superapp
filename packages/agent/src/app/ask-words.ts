// "Ask me first"'s line under its choices (the copy review's #7, 7 Nov): on the phone a looser choice needs Face ID; in a browser the
// app never names Face ID alone, and never a password: what asks is this browser's own check (the copy review's final words, 7 Nov,
// B11). The web core's check is the browser's unlock passkey with user verification and no weaker fallback
// (apps/web/src/unlock/verify.ts:1-6, :91-96; core agent-private.ts:398-400 refuses without it).
export const ASK_UNDER = {
  phone: "Asking less often needs Face ID. Asking more often works at once.",
  web: "Asking less often needs this browser's own check: Face ID, Touch ID or Windows Hello. Asking more often works at once.",
} as const;

export const askUnderLine = (phone: boolean): string => (phone ? ASK_UNDER.phone : ASK_UNDER.web);

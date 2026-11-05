// What a protection band needs, said ONE way everywhere (QA sd-security (j), QA 4 Nov: a sheet said "Anything
// bigger: a 1-day wait and your second device", dropping Face ID, while Protection said "Your face, then a 1-day wait").
// Protection's rows, "Now on your account" and the Sim's approval sheet all build their line here (the Copywriter's words).

export type NeedLevel = "faceid" | "wait" | "device" | "both";

/** A wait as a band says it: 86400 → "1-day", 3600 → "1-hour", 120 → "2-minute". */
export function waitSpan(seconds: number): string {
  const s = Number(seconds) > 0 ? Number(seconds) : 86_400;
  if (s >= 86_400) return `${Math.round(s / 86_400)}-day`;
  if (s >= 3_600) return `${Math.round(s / 3_600)}-hour`;
  return `${Math.max(1, Math.round(s / 60))}-minute`;
}

/** `you`: "Your face" on the phone, "Your yes" in a browser. "Your face, then a 1-day wait". */
export function needWords(level: NeedLevel, waitSeconds: number | undefined, you: string): string {
  switch (level) {
    case "faceid": return you;
    case "wait": return `${you}, then a ${waitSpan(Number(waitSeconds))} wait`;
    case "device": return `${you} and your second device`;
    case "both": return `${you}, a ${waitSpan(Number(waitSeconds))} wait and your second device`;
  }
}

/** The contract's own level ("FaceId", "Device", { Wait }, { Both }) as needWords' level and wait; null if unknown. */
export function contractNeed(level: unknown): { level: NeedLevel; waitSeconds?: number } | null {
  if (level === "FaceId") return { level: "faceid" };
  if (level === "Device") return { level: "device" };
  const l = level as { Wait?: { seconds: string }; Both?: { seconds: string } } | null;
  if (l?.Wait) return { level: "wait", waitSeconds: Number(l.Wait.seconds) };
  if (l?.Both) return { level: "both", waitSeconds: Number(l.Both.seconds) };
  return null;
}

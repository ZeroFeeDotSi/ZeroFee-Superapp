// The web wallet's approval sheet asks for the password (fork A, 4 Nov: one path for an over-cap Send, Trade's over-cap
// and its first session in a browser). Approve answers approval.answer {id, approve: true, password}; the core checks it
// and counts a wrong one. Pure, so a test reads it; ApprovalSheet.tsx and its view draw it.

/** The sheet's password words (pending the Copywriter). */
export const APPROVAL_PASSWORD_WORDS = {
  ask: "Type your password to approve.",
  password: "Password",
  wrong: "That password isn't right.",
  failed: "This didn't go through. Try again.",
} as const;

/**
 * The core's answer to a password Approve: done (the sheet goes, the asker hears the rest), or why it stays open to type
 * again: a wrong password, a wait after wrong tries (the core's own line says how long), or no answer at all.
 */
export function passwordAnswer(r: { ok: unknown } | { problem: { code?: string; whatHappened?: string } } | null): { done: true } | { why: string } {
  if (!r) return { why: APPROVAL_PASSWORD_WORDS.failed };
  if (!("problem" in r)) return { done: true };
  if (r.problem.code === "security.web.password") return { why: APPROVAL_PASSWORD_WORDS.wrong };
  if (r.problem.code === "security.web.wait") return { why: r.problem.whatHappened || APPROVAL_PASSWORD_WORDS.failed };
  return { done: true };
}

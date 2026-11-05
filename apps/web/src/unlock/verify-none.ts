// The public site's stand-in for verify.ts (vite.config.ts swaps it in for VITE_ZEROFEE_PUBLIC=1, beside passkey-none.ts):
// the web wallet has no passkey, so no WebAuthn ships there and every passkey check is a plain no. Its sheets take the
// password instead (the core's answerWeb).
export function verifiedFlags(_authenticatorData: ArrayBuffer | ArrayBufferView): boolean {
  return false;
}
export function pageRpId(_loc?: Pick<Location, "protocol" | "hostname" | "origin">): string | undefined {
  return undefined;
}
export async function passkeyUserVerified(_credentialId: Uint8Array, _creds?: unknown, _host?: string, _opts?: { bind?: Uint8Array; origin?: string }): Promise<boolean> {
  return false;
}
export function webUserVerified(_readRecord: () => Promise<{ method: string; credentialId?: Uint8Array } | null>, _creds?: unknown, _host?: string): (reason: string) => Promise<boolean> {
  return async () => false;
}

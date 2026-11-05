// The Settings row's one line says only what that Settings holds (QA sd-security (e), QA 4 Nov: the Sim's row
// said "Colors, passwords, lock" with no lock and no passwords there; the web wallet's said "currency", which has no row).
// The Copywriter's words, one per kind of Settings.
export const SETTINGS_LINES = {
  phone: "Colors, passwords, Face ID, lock",
  webWallet: "Colors, backup words, lock",
  sim: "Colors, start over",
  browser: "Colors, lock",
} as const;
export function settingsLine(where: { phone: boolean; webWallet: boolean; sim: boolean }): string {
  if (where.sim) return SETTINGS_LINES.sim;
  if (where.webWallet) return SETTINGS_LINES.webWallet;
  return where.phone ? SETTINGS_LINES.phone : SETTINGS_LINES.browser;
}

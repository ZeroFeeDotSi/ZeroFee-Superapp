// The extension's stand-in for packages/browser/src/sim/sites-data.ts: the Sim's made-up sites are never on in the
// extension, so a site opens as the real one (or not at all), never as a sample page.
export type SimSiteKind = "pump" | "gmgn" | "web";
export const simSitesOn = (_env?: { sim?: boolean; demo?: boolean; phone?: boolean }): boolean => false;
export const simSiteKind = (_site: string | undefined): SimSiteKind => "web";
export const simHistory = (_now?: number): { host: string; url: string; atIso: string }[] => [];
export const SIM_PRIVACY = { kind: "phone", private: true, normalSites: [] as string[], built: true, blockTrackers: true } as const;

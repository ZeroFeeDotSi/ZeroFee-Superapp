// The sites that are apps of their own in the tray (Job 1, the spine: no "Apps" app; B15, B24): each listed app with
// its name and its own mark, small enough for the first load (the page itself, SocialApp's SiteRoot, loads when shown).
import gmgnLogo from "../app/logos/gmgn.png";
import pumpLogo from "../app/logos/pump.png";
import { LISTED } from "./catalog.ts";

const LOGO: Record<string, string> = { pump: pumpLogo, gmgn: gmgnLogo };

export interface TraySite {
  /** The Browser preset's id ("pump"); its page is "site:<id>". */
  id: string;
  name: string;
  logo?: string;
}

export const TRAY_SITES: readonly TraySite[] = LISTED.map((a) => ({ id: a.id, name: a.preset.name, ...(LOGO[a.id] ? { logo: LOGO[a.id] } : {}) }));

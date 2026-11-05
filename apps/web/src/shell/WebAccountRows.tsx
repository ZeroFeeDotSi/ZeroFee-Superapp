// The web wallet's "Your account" rows (bug report, 5 Nov late: the web showed only Activity and Settings, the iPhone
// Quantum-safe, Protection, Devices, Recovery): the phone's first card, in its order and with its icons, each saying
// truthfully what this browser has. Quantum-safe, Protection and Devices are the Safe's: "On iPhone", and one short page
// on what each does there. Recovery is this browser's 24 backup words: Settings' own sheet (WebWalletRows' SecretSheet,
// the password first, the words never copied), no second way to them. Loaded only on the web wallet (App.tsx webRows),
// never in Home's first load.
import type { Bridge } from "@zerofee/core/bridge";
import type { AccountPlace } from "@zerofee/shell-api/home-slots.ts";
import { ON_IPHONE_PAGES, WEB_ACCOUNT_ROWS } from "@zerofee/shell-api/web-account-words.ts";
import { NavRow } from "@zerofee/wallet/app/screens/NavRow.tsx";
import { OnIphoneSheet } from "./OnIphoneSheet.tsx";
import { SecretSheet } from "./WebWalletRows.tsx";

/** The four rows; `open` shows a row's sheet (WalletApp closes the account sheet first). */
export function WebAccountRows({ open }: { open: (place: AccountPlace) => void }) {
  return <>{WEB_ACCOUNT_ROWS.map((r) => <NavRow key={r.place} title={r.title} icon={r.icon} line={r.line} value={r.value} onClick={() => open(r.place)} />)}</>;
}

/** A row's sheet: Recovery, the backup words behind the password (the shell's bridge: account.web.showWords); the
 *  others, their "On iPhone" page. */
export function WebAccountSheet({ place, bridge, codeUrl, onClose }: { place: AccountPlace; bridge: Bridge; codeUrl: string | undefined; onClose: () => void }) {
  if (place === "recovery") return <SecretSheet bridge={bridge} ask={{ k: "words" }} onClose={onClose} />;
  return <OnIphoneSheet page={ON_IPHONE_PAGES[place]} codeUrl={codeUrl} onClose={onClose} />;
}

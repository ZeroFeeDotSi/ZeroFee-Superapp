// Settings → Status, a person's own server on the phone (T13 phase 2): the phone's page may fetch only the origins in
// apps/ios/connect-hosts.txt (its CSP connect-src, build-web.sh), so an own server elsewhere can't be reached there.
// Test says so plainly ("ZeroFee on iPhone can't reach that address yet.") instead of a fetch that fails for no shown
// reason. The list is read from the same file the CSP is made from, so the two never drift. Loaded with the status
// service only (apps/web core.ts), never in Home's first load.
import list from "../../ios/connect-hosts.txt?raw";

/** The https origins in a connect-hosts.txt text, without comments. */
export const approvedOrigins = (text: string): Set<string> => new Set(text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("https://")));

const PHONE = approvedOrigins(list);
/** Whether the phone's page may fetch `origin` ("https://host[:port]"). */
export const phoneReaches = (origin: string): boolean => PHONE.has(origin);

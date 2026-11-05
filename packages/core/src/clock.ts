// One time format across Home (join walk 3 Nov, item 8): Home's "as of 10:52", Add's "Works until 1:07 PM", the
// banner's "since 1:09 PM" and a held move's "until Tue 14:00" all read the phone's own clock the same way: its own
// locale, hour and minute (Intl). `locale` is for tests only; the app always passes none (the device's).

/** "10:52" or "10:52 AM", as this device writes a time. */
export const shortTime = (at: number | Date, locale?: string): string => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(at);

/** "Tue" (or "Tuesday"), as this device writes a weekday. */
export const weekdayName = (at: number | Date, long = false, locale?: string): string => new Intl.DateTimeFormat(locale, { weekday: long ? "long" : "short" }).format(at);

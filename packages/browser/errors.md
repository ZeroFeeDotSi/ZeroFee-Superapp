# Browser problems

Every Problem the Browser (packages/browser) can produce. Written from `src/browser-problems.ts`; a test checks that
every code there is listed here. Host names in the words are examples.

What a **site** is told is separate: the wallet engine answers sites with EIP-1193 error codes (4001 the person said no,
4100 not connected or not allowed, 4200 a method ZeroFee never offers, 4901/4902 a network the site can't use here,
-32002 a sheet is already up, -32602 a malformed request, -32603 the core said no). Those never reach the person as
words; when the core returns a Problem for a signature, the person sees the core's own Problem (packages/core/errors.md).

| Code | What happened | Money | Next step |
|---|---|---|---|
| `browser.ready.test-account` | This is a test account, so there's no real money to make ready. | safe: in your Safe | Go back (nothing) |
| `browser.address.invalid` | That doesn't look like a site's address. | safe: where it was | Check the address (fix-input → address) |
| `browser.address.insecure` | {host} isn't an https site, so ZeroFee won't open it. | safe: where it was | Go back (nothing) |
| `browser.site.unreachable` | {host} didn't answer. | safe: where it was | Try again (retry) |
| `browser.site.blocked` | {host} won't open inside another app. | safe: where it was | Open in Safari (open → safari) |
| `browser.site.wants-app` | {host} asked for its own app. ZeroFee closed that. Carry on here. | safe: where it was | Show the desktop page (retry) |
| `browser.site.google-blocked` | Google doesn't let you sign in to {host} inside another app. | safe: where it was | Sign in with Apple instead (retry: opens the site again) |
| `browser.social.app-didnt-open` | {name}'s app didn't open. | safe: where it was | Try again (retry) |
| `browser.social.failed` | That didn't go through. | safe: where it was | Try again (retry) |
| `browser.request.refused` | {host} asked for a step ZeroFee can't show in plain words. So it said no. | safe: in Spending | Go back (nothing) |
| `browser.signin.refused` | Your {site} sign-in didn't finish. | safe: in your {site} wallet | Back to {site} (nothing) |
| `browser.signin.unknown` | {site} asked you to sign words that aren't a normal sign-in. ZeroFee didn't sign them. | safe: still in your {site} wallet | Back to {site} (nothing) |

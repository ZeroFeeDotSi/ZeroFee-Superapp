# Extension app problems

Every Problem the Extension app inside ZeroFee (packages/extension-app) can produce itself. Written from
`src/problems.ts`; a test checks that every code there is listed here. Linking problems from the trusted core
(`security.link.expired`, `security.link.wrong`, and `security.link.declined` for a "Not now" on the import sheet) and
funding or bringing-back problems from Trade and Wallet are shown as those layers wrote them. Each of them leads back to
the start: a new code, or, after a "Not now", the app's tabs with nothing changed.

| Code | What happened | Money | Next step |
|---|---|---|---|
| `extension-app.code.ran-out` | That code ran out before you scanned the laptop's code. (More: each code works once, for 5 minutes.) | not involved | Get a new code (retry) |
| `extension-app.code.not-panel` | That isn't the code from the ZeroFee panel. | not involved | Scan again (retry) |
| `extension-app.wallet.unread` | We can't read your laptop wallet right now. (More: nothing moved; check your internet connection.) | hasn't moved, in the laptop wallet | Try again (retry) |
| `extension-app.camera.off` | The camera isn't available to ZeroFee. (More: allow it in the phone's settings.) | not involved | Try again (retry) |

A "no" on the approval sheet (adding money, bringing the SOL back) is not a Problem: nothing moved. Money the account's
protection holds (D17) is not a Problem either: it goes to the shell's Waiting screen and reads "On hold" in Activity until it
runs.

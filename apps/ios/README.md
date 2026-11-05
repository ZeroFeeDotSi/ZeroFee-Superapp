# ZeroFee for iPhone

The iPhone app is a host for the web app in `apps/web` (decision D24), not a second UI. It is one full-screen
`WKWebView` showing the same React shell. Swift does the device methods and the Secure Enclave signing, and keys never
enter JavaScript.

```
apps/ios/
  ZeroFee.xcodeproj    one iOS app target "ZeroFee", iOS 26+, SwiftUI, signing Automatic with no team set
  Info.plist           zerofee:// URL scheme, camera and Face ID usage text, ZFStartQuery
  build-web.sh         builds apps/web and copies dist/ to apps/ios/web/ (bundled as the folder "web")
  ZeroFee/
    ZeroFeeApp.swift   the app and its one screen
    Host.swift         the web view, what it may load, zerofee:// links
    WebFiles.swift     serves web/ at zerofee-app://app/ (root of its own origin)
    Bridge.swift       device.store, device.secret, device.openUrl, device.clipboard.read (UIPasteboard), the core's vault
    Notify.swift       device.notify.schedule / cancel: local notifications (UNUserNotificationCenter)
    Keychain.swift     Keychain, this device only
    Camera.swift       camera permission for the page, QR reading in Swift
    ChipKey.swift      the account key in the Secure Enclave (SecureEnclave.MLDSA65)
    DebugProbe.swift   debug builds only: the simulator self-check (ZF_PROBE=1)
```

On the web side there is one adapter, `apps/web/src/host/ios.ts`, plus `apps/web/src/host/vault.ts` (HostVault,
HostKey). `apps/web/src/core.ts` uses them only when `window.webkit.messageHandlers.zerofee` exists. In a browser,
nothing changes.

## Running it on your iPhone

1. On the Mac, from the repo root: `npm ci`, then `apps/ios/build-web.sh`. Run `build-web.sh` again whenever the web
   app changes. If you forget, the build stops with "The web app isn't built".
2. Open `apps/ios/ZeroFee.xcodeproj` in Xcode.
3. Pick your team: select the project, then the ZeroFee target. Under Signing & Capabilities, keep "Automatically
   manage signing" on and choose your team. If Xcode says the bundle id `si.zerofee.app` is taken, change it to any id
   of yours.
4. On the iPhone (iOS 26 or later): Settings, Privacy & Security, Developer Mode, turn it on, and restart. Connect the
   iPhone to the Mac and trust the Mac.
5. In Xcode, choose your iPhone as the run destination and press Run.
6. The first time, iOS may say the developer isn't trusted. Go to Settings, General, VPN & Device Management, trust
   your developer profile, and open the app again.

To start the app with a query, for example `?mainnet` once the shell has that switch, set the build setting
`ZF_START_QUERY` (target, Build Settings, User-Defined) to `mainnet`. The app then opens
`zerofee-app://app/?mainnet`. Empty means no query.

## Device checklist (on the iPhone)

Use a Debug build (Xcode's Run). Tick each item:

- [ ] **The app opens** on the start screen ("Own what's yours."), in light and dark.
- [ ] **First run, Create my account.** Tap Create my account. The key is made in the chip (Face ID may ask). When the bank
      exists, open Security: Overview lists "Device key" as "Phone key · in the secure chip" (a browser says "Demo key · this browser"). There is no device seed in the
      Keychain: only the chip's wrapped handle.
- [ ] **Write down the backup words BEFORE any money goes in.** Re-enrolling Face ID ends the chip key for good; the
      words (after the recovery wait chosen at set-up, 48 hours by default; with a second device, also its yes) or a
      second device are the only way back. The app blocks send and receive until the
      3-word check, so do it right after the bank exists, before Wallet's deposit.
- [ ] **For a MAINNET account, build Release** (Scheme → Run → Build Configuration → Release). A Debug build is
      inspectable, copies the console to the device log, and listens for `zerofee://host/keycheck`, which any web page
      could open to raise a Face ID prompt.
- [ ] **Every Approve asks Face ID once.** Make any payment, or approve anything in the sheet (a separate wallet,
      Agent's setup too). Tapping Approve shows ONE Face ID prompt, "Approve this in ZeroFee", whether or not the chip
      signs next. Look away or cancel: the sheet closes as "Not now" and nothing is signed. A payment never shows a
      second prompt.
- [ ] **Face ID signature (chip key).** In Safari on the iPhone, type `zerofee://host/keycheck` and allow it to open
      ZeroFee. Face ID should prompt. The alert "Chip key check" should show:
      - `Key: ml-dsa-65:…`
      - "Signed with Face ID in N ms" (please note N for SECURITY.md P1)
      - "verifies in JavaScript: true"
      - "A changed hash is rejected: true"

      Then run it again and look away or cancel: it must say "Not done: Face ID didn't approve it". It signs a random
      hash and moves nothing.
- [ ] **Camera scan.** Open Pay, then Scan. iOS asks for the camera once; allow it. Point it at any payment QR code. Pay
      should read it, the same as in the browser.
- [ ] **Partner page.** Anything that opens a partner page (`device.openUrl` with mode `sheet`) opens inside a ZeroFee
      screen: our own bar (Close, the page's real domain with a lock when it is https, and an Open in Safari button) and the
      partner's page in its own web view below it. The first time for a partner, a line says it isn't part of ZeroFee. Close
      returns to the app. If the page cannot load, "Opening in Safari instead." shows and the system browser sheet opens.
- [ ] **zerofee:// return.** With a partner sheet open from an app (for example Pay), open
      `zerofee://pay/return?test=1` (from a link on the partner page, or typed into Safari). The sheet closes and Pay
      gets `device.returned`. A link for an app that has no sheet open (for example `zerofee://wallet/return`) does
      nothing.
- [ ] **Agent.** With an Anthropic key set in Agent, ask it something. The call goes straight to `api.anthropic.com`
      from the app.

## What is proven, and how

On the Mac, with Xcode 27.1 (iOS 27.1 SDK), on the iPhone 17 simulator running iOS 27.1 (no iOS 26 simulator runtime
is installed), with the debug probe (`SIMCTL_CHILD_ZF_PROBE=1 xcrun simctl launch …`, every check logs `[zf-probe]`):

- `xcodebuild … -destination 'generic/platform=iOS Simulator' build` succeeds. The same project also builds for
  `generic/platform=iOS` (a real iPhone, with signing off), with no Swift warnings.
- **The app loads from `zerofee-app://app/`.** These are served with 200: `/`, `/assets/index-*.js`,
  `/assets/index-*.css`, `/favicon.svg`, `/apple-touch-icon.png` and `/manifest.webmanifest`. A missing file gives
  404, a screen address with no extension gets the app, and `..` can't leave `web/`. There is no `/logos/` path in the
  built app: Vite puts every coin logo into the JS bundle as a data URI, so logos arrive with `/assets/index-*.js`.
- **The page's console** goes to the device log, and it is shown to be live because the probe's own `console.info` line
  arrives. Uncaught errors and rejections are captured too. No error lines appeared.
- **device.store:** set and get work, and another app reading the same key gets null (each app has its own slot).
- **device.secret:** set, get and delete work against the simulator's Keychain. A bad name and a value of 4,097
  characters are refused with `security.secret.refused`.
- **The core's vault:** put, get and delete work against the Keychain. An unknown app is refused, and an `http://` URL
  is refused for `openUrl`.
- **device.notify:** `device.notify.schedule` (`{ id, title, body, atIso }`) and `device.notify.cancel` (`{ id }`) answer
  `{ ok: true }`. Ids are kept as `zf.<app>.<id>`; title and body are the app's own plain text (up to 120 characters
  each, never altered); `atIso` must be in the future and within 400 days; the system asks permission on the first
  schedule (`device.notify.denied` if the person says no). On the simulator, with notifications allowed: a bad id, a
  past time, a time past 400 days, a 121-character title and an unknown app are each refused; a good one is accepted
  and its banner shows while ZeroFee is open; cancel answers ok. Not verified: tapping "Allow" on the real permission
  prompt (the simulator's notification setting was set to allowed by hand), that a cancelled reminder never shows, and
  delivery with the app closed or on a real iPhone. No screens use it yet.
- **device.openUrl:** `sheet` opens the partner's page inside a ZeroFee screen (PartnerView.swift): partner pages open
  inside a ZeroFee screen, in their own web view (no bridge, no scripts of ours, its own cookies and storage per partner
  host). Proven with the debug probe `ZF_PROBE_PARTNER=1` on https://example.com: the page shows under our bar with the
  domain and a lock; `window.webkit.messageHandlers.zerofee` is undefined inside it; a top-frame `http://` load is
  cancelled; `zerofee://wallet/return` with nothing pending and `zerofee://host/keycheck` are ignored; two hosts get two
  different data stores, neither the default one. SFSafariViewController is only the fallback when the page cannot load.
- **zerofee:// return:** with Pay's sheet open, a `zerofee://wallet/return` link is ignored, and
  `zerofee://pay/return?probe=1` closes the sheet and delivers `device.returned` to Pay. The probe calls the link
  handler directly, because iOS's own "Open in ZeroFee?" step needs someone to tap Open.
- **The camera's QR reading:** a QR image sent through the page's `BarcodeDetector` came back as its text
  (`zerofee-probe:pay?amount=1`). On the simulator, Vision can't start ("Could not create inference context"), so this
  ran on the Core Image fallback.
- **Agent's model calls:** `fetch("https://api.anthropic.com/v1/messages")` from the `zerofee-app://app` origin, with
  the SDK's headers, returns HTTP 401 `authentication_error` and the page can read it. So CORS allows this origin.
- **The page's Content-Security-Policy** (added to the copied index.html by build-web.sh, phone build only): scripts
  from the app only, connections to the app and to any https host, images from the app, `data:` and `blob:`, no frames.
  An inline-script control is blocked; the app, its logos and an https call from the page work; zero CSP violations
  and zero console errors in the log.
- **Only the main frame may use the bridge:** the probe's table of origins, and two messages from a same-origin iframe,
  are dropped with one log line.
- **device.confirm on the simulator** (Face ID enrolled with `notifyutil`): Approve on a Pay sheet shows the system
  Face ID prompt; a match returns approved and the payment goes on (sample data); a non-matching face leaves the
  prompt open. Not verified: cancelling the prompt (the "Not now" result), and that one prompt covers the chip's
  signature (the simulator can't make the chip key).
- **ML-DSA-65 compatibility:** on the Mac, a CryptoKit `MLDSA65` signature over a 32-byte hash verifies with
  `@fastnear/ml-dsa-65` `verifyHash` (the core's library), and a changed hash fails. This is the same algorithm as the
  chip key; only where the key lives differs.

- **Social trading's three sites (probe-site, 30 Oct, iPhone 17 simulator, iOS 27.1).** `ZF_PROBE_SITE=<url>` (Debug
  only, `DebugProbeSite.swift`) opens a site as Social trading does (the preset's pinned recipe, wallet mode, the
  Browser wallet; fomo as a computer would, with the Fund bar), and `ZF_PROBE_SITE_TAP="a|b;c"` presses the site's own
  buttons by their words, one step after another, from the probe's own content world. Nobody signed in; nothing signed.
  - pump.fun: loads (its bot check let the web view through), the provider is in the page; "Continue", then "Sign in":
    the site's list reads "or connect a wallet · ZeroFee DETECTED · Phantom · More wallets".
  - GMGN: loads at gmgn.ai/?chain=sol with a "GMGN App is Live / Download Now" pop-up over it; Portfolio → Log In →
    "Connect with extension wallet": "Connect a wallet on Solana to continue · ZeroFee Installed · Phantom · Bitget
    Wallet · OKX Wallet · TokenPocket · Backpack · Solflare".
  - fomo: its page picks its layout by width alone (under about 800 CSS px it is the "Download app" page with no
    sign-in, whatever the user agent), so a desktop window lays the web view out 820 pt wide and draws it scaled to the
    screen (PartnerView's stage). Then "Login" → fomo's "Login or create an account" (Continue with Apple, Continue
    with Google) → "Continue with Apple" → appleid.apple.com, "Use your Apple Account to sign in to fomo - social crypto
    trading", with ZeroFee's "Fund fomo from your social wallet" bar under the page. Since 30 Oct neither Social
    trading nor the Browser opens this window: "Open fomo", and the Browser's fomo (preset, typed or history), open
    fomo's own app (PartnerApp in PartnerBridge.swift, the universal link https://fomo.family/ with
    universalLinksOnly), or fomo's App Store page when the app isn't installed. The simulator has no fomo app and no App
    Store: `ZF_PROBE_SITE=https://fomo.family/ ZF_PROBE_SITE_APP=social` (or `=browser`) runs the bridge's whole route
    (`handle`) and logs `nativeAppFromTrade` and `nativeAppFromPay = refused: Only Browser and Social trading can open
    sites.`, `nativeAppPump` and `nativeAppLookAlike` (fomo.family.evil.example) `= refused: ZeroFee can't open that
    app.`, `nativeAppFomo = store` from either app (the universal link found no app, so the App Store link went to the
    simulator's Safari, which can't open it), `windowOpened = false` (30 Oct, iPhone 17 simulator, both routes). `ZF_PROBE_SHELL_TAP="a|b;c"` (Debug only) presses ZeroFee's own buttons by their words, one step every 5 s;
    it reaches "Make your key", where the simulator's chip refuses the key (-1020), so Social trading itself was
    walked in the web demo.

## What is NOT proven (needs the iPhone)

- **Secure Enclave key creation and signing.** On the simulator, `SecureEnclave.isAvailable` is true, but making a
  `SecureEnclave.MLDSA65` key with `.biometryCurrentSet` fails with LocalAuthentication error -1020, even after Face
  ID enrollment was turned on in the simulator. The key check refuses plainly. Not verified: that the chip makes the
  key, that Face ID prompts, the signing time, and that a chip signature verifies in JavaScript.
- **The live camera:** getUserMedia with a real camera, the permission prompt, and Vision (rather than the Core Image
  fallback) reading live frames.
- **iOS link routing:** a real `zerofee://pay/return` link reaching the app through iOS, and the "Done" button on the
  sheet.
- **Running on iOS 26 itself.** Only the iOS 27.1 simulator was run.

## The native sheet: Face ID on every approval (S1.6 phase 1)

**A chip signature is approved only on Swift's own sheet** (NativeSheet.swift).
- The core hands Swift `key.sign { id, words, bytes }`: the exact unsigned transaction bytes, and the words the shell's
  sheet showed for them.
- Before any sheet opens, Swift checks the bytes (NearTx.swift). They must read as a NEAR transaction whose signer key is
  this phone's chip key (ML-DSA-65, its 1,952 bytes), with 1 to 1,000 actions, within NEAR's 1.5 MiB limit. It then
  hashes them itself.
- So the chip never signs a bare hash, a NEP-366 delegate action, a NEP-413 message, or another key's transaction.
- Words that can't be read whole are refused (SheetWords.swift), and nothing is signed.
- The sheet shows the same words as the web sheet: title, lines, warnings, effects, the protection's clock line, then the
  hint. The same rules hold: Approve stays off for 0.7 s, and stays off until long words have been scrolled to the end.
- **Approve with Face ID**: a fresh `LAContext` checks the key's own access control, signs that one hash, and is
  invalidated. **Not now**: nothing is signed. One sheet at a time. A sheet left open for 10 minutes closes as Not now.
- It is the ONE sheet for a chip signature: one tap and Face ID. The web sheet doesn't show for it (the core skips its
  `approval.needed`), and the core's next approval of any kind waits until the native sheet has closed, so two sheets
  never overlap. JavaScript checks the returned signature against sha256(bytes) before anything is sent.

**Approvals that don't touch the chip** (a separate wallet, Agent's setup) still pass Face ID on the web sheet's Approve:
`device.confirm`, `ApprovalPass` in ChipKey.swift. That proves the person is there, nothing more. The context is
invalidated at once and never handed to a signature.

**Proof**
- `apps/ios/check/run.sh` checks NearTx.swift and SheetWords.swift on a Mac. It uses real transaction bytes from the
  core's serializer, plus the look-alikes the chip must never sign.
- The core's tests (`dev-signer.test.ts`, `demo-core.test.ts`) prove three things: the key with its own sheet gets the
  exact bytes and the shown words; it is never asked for a bare hash; and a signature that isn't over the bytes is never
  sent.
- The simulator probe (`ZF_PROBE=1`) shows `key.sign` refused before any sheet in three cases: a bare hash, bytes that
  aren't a transaction, and unreadable words. `ZF_PROBE_NATIVE_SHEET=1` opens the sheet with sample words, for a look;
  its Approve can't sign there, because there is no chip.
- On the device: the key check (`zerofee://host/keycheck`) now signs a test transaction on the native sheet. That
  transaction has nonce 0, an all-zero block hash and no real account, so no network would take it.

**Phase 2, steps 2–4: the core runs in its own context on the phone** (IsolatedCore.swift)
- **The switch:** `Host.isolatedCoreWanted` in IsolatedCore.swift (one line, `true`). Set it to `false` to run the page's
  core as before. It's in Swift, not a build setting, so a phone build's own local Xcode settings (team, bundle id,
  mainnet) never conflict with it. It fails closed: if the core's script is missing (build-web.sh not run) or doesn't
  start, the page is still told "isolated" and starts no core of its own, `key.*` and the core's vault stay closed to it,
  and every core call answers one Problem ("ZeroFee's core didn't start on this phone, so nothing can be signed").
- **Which site asked** (D29 wallet mode): every core method that signs for a site (`subwallet.signTx`, `subwallet.sign`,
  `subwallet.signMessage`, `subwallet.signTypedData`) gets its `site` from WebKit, the waiting partner window's host,
  and only for the app whose wallet that window is (`browser`, or `pay` in the card's window). Any other `site` is
  removed. `tools/ios/fail-closed.test.ts` checks that every core method taking a site is on that list.
- **How the page reaches it:**
  - The phone tells the page its mode before any page script runs (`window.__zerofeeCoreMode`).
  - In "isolated" mode the page starts no core (`apps/web/src/host/core.ts`).
  - Every core method goes to Swift as `core.call`, for the core's families only: account, recovery, tx, subwallet,
    card. Never `approval.*`.
  - The core's events come back as `core:<event>`.
- **What the core uses:**
  - Its vault is the Keychain: the same items the page's core used, so an existing account carries over.
  - Its account key is the chip's.
  - EVERY approval is the native sheet: a chip signature as in phase 1, and any other approval (a separate wallet,
    Agent's setup) with Face ID on the same sheet. No page script can answer an approval.
  - The account contract's code comes from the app (`ZeroFee/CoreBundle/`, built by build-web.sh, gitignored, never
    served to the page).
- **What the page loses:** `key.*` and the core's vault items (`security.bridge.not-allowed`).
- **What the page keeps:**
  - the Kids parent's own vaults (`zerofee-kid-*`: the parent's second-device keys still live in the page);
  - `device.confirm`, which signs nothing (the Kids parent's sheet uses it).
- **Proof:**
  - The simulator probe, built with local signing (`CODE_SIGN_IDENTITY=-`): with `coreMode` "isolated", `account.state`
    answers through Swift's context; `approval.answer` is refused; the core's vault and `key.info` are refused to the
    page; the Kids vault is reachable. The welcome screen runs on it.
  - The core's test: with its own sheet, every approval goes there, and the shell's sheet hears none.
- **The backup words never reach the page** (WordsSheet.swift).
  - The isolated core hands the 24 words straight to a native screen: "Write these down" (a parent's version for a child's
    bank), then the same three quick checks as the web (tap the right word of four).
  - The core checks the three again before it adds the recovery key, which goes on the native sheet.
  - The page calls `recovery.backup` and only learns that it's done. `recovery.words` is refused while the words have
    their own screen.
  - "Later" adds nothing; the app asks again.
  - `ZF_PROBE_WORDS=1` shows the screen with sample words, for a look.
  - With the switch off, the page shows the words as before.
  - Not covered yet: typing the 24 words to restore on a new phone, and Security's "Check my words". Both are the
    person typing into the page.
- **Still open:**
  - The Kids parent's keys still live in the page.
  - Opening an imported key's box needs `crypto.subtle` in the context.
  - The probe stalls after its iframe step in both modes. That is a probe issue (UI's section), seen with the page's
    core too.

**Phase 2, step 1 (packaging)**
- `apps/ios/core/` turns the trusted core into one script of its own (`node apps/ios/core/build.mjs` →
  `core/dist/zerofee-core.js`, an IIFE of about 540 KB with no imports; build-web.sh runs it too).
  - `entry.ts` starts the same DemoCore and exposes `ZeroFeeCore { start, call, check, checkShims }`.
  - `shims.ts` gives a bare JavaScriptCore context what a browser would. Each piece is built on `__native`: fetch,
    crypto.getRandomValues, timers, TextEncoder/TextDecoder (fatal too), atob/btoa, AbortSignal and console.
- `ZeroFee/CoreContext.swift` runs it in a JSContext of its own: no DOM, no page, no message handler. What only the app
  can do (the native sheet, the chip key, the contract's code, events to the page) goes through `CoreHostDelegate`.
  - One serial queue owns the context.
  - HTTPS requests go only to the core's own hosts (`CoreContext.coreHosts`).
  - Random bytes come from `SecRandomCopyBytes`.
  - The vault is Swift's (`CoreVault`).
- `apps/ios/check/core-smoke.sh` (Mac, needs the network, reads only) loads the real bundle into CoreContext.swift and
  checks:
  - `account.state` answers;
  - two testnet nodes agree on a block, fetched through Swift;
  - the shims work inside the context;
  - an unknown method is a Problem;
  - with its hosts narrowed, the core reaches nothing.
- Not yet in that context: `crypto.subtle`. It is needed only to open an imported laptop key's box; that gets CryptoKit
  when it moves.

**Phase 2, later steps**
- Today the words come from the core running in the page. A compromised page could still pair true bytes with false
  words.
- Phase 2 moves the core into its own JavaScript context that Swift owns. The page would then only ask; the isolated
  core would build the bytes and words, and hand them straight to the native sheet.

## Tor build (D130/D131: the Browser's Private browsing)

The Browser's Private browsing runs tor inside the app. `apps/ios/ZeroFee/Tor.xcframework` is built on a Mac from tor's,
OpenSSL's and libevent's own signed source releases, never from a prebuilt binary, and it is gitignored:

    sh tools/ios/build-tor.sh        # needs Xcode and gpg (brew install gnupg); about 10-20 minutes

- **Pins:** `tools/ios/tor-sources.txt` names each release (each at least 90 days old when picked), its URL, its sha256
  and the primary keys allowed to sign it. The keys are in `tools/ios/tor-keys/`, and the file says where each came from.
- **Fail closed:** a sha256 that isn't the pin, or a signature that isn't good from a pinned key, stops the build before
  anything is unpacked. tor signs its `.sha256sum`, which must also name the pinned hash.
- **What's in it:** one static `libTor.a` per slice (iPhone arm64, Simulator arm64) holding libtor, libevent, libssl and
  libcrypto, with tor's `tor_api.h` as the module `Tor` (it links the system zlib by itself). tor is built without lzma,
  zstd, relay or directory-authority code.
- **Xcode:** the framework sits in the project's synced folder, so Xcode links it with no project-file change.
- **Updating:** pick the new releases, check their dates, signatures and keys, then change the pins in one commit.

## Robot and wallet mode in the partner window (D29)

Built to Security's D29 rules (`$ZEROFEE_HOME/backlog/security.md` A–G). A partner window opened WITHOUT a recipe is
exactly the plain window (its 12 conditions). With one (only from the shell's compiled recipes, never on a child's
phone), it may also be:

- **Wallet mode** (`PartnerWallet.swift`): Browser's provider (`packages/browser/src/provider/provider.js`, bundled by
  `build-web.sh` as `zf-partner-provider.js`; a host stub until Browser lands its own) in the page world, main frame,
  document start, and only in a document whose host has wallet mode (set before each main-frame load and again on the
  response). The `zerofeeWallet` handler answers only the main frame whose WebKit origin is the strip's host and a
  recipe host. Requests go to Browser's engine as `device.wallet.request`; messages and typed data go straight to the
  core with `site` = that host. **The one page-world call** the host makes (against §B5's "no evaluateJavaScript into
  the page world"): `device.wallet.emit` dispatches `zerofee-wallet:event` with the engine's event, by
  `callAsyncJavaScript` with the event as an argument (never built into the script text), and only while the committed
  host is still the one named.
- **Robot mode** (`PartnerRobot.swift`): `robot.js` (`ZeroFee/PartnerScripts/zf-partner-robot.js`) in its own content
  world "zf-robot", added when a run starts and removed when it ends, with its handler in that world only. Its line is
  the window's one notice line at the bottom (PartnerNotices.swift; no × while it acts or waits): "ZeroFee is acting here · <host> · Stop"; "Your turn · <host>" with Continue; the first run
  ever says "Claude reads this page's form so it can fill it in. It never sees your passwords."
- **Hash pins** (`PartnerScripts.swift`): both scripts' SHA-256 are Swift constants; a mismatch keeps the window plain
  and logs one line. `apps/web/src/host/partner-scripts.test.ts` fails when a file and its pin disagree.
- WebKit removes user scripts only all at once (`removeAllUserScripts()`; there is no per-world variant), so ending a
  run removes all and puts the provider back when wallet mode is on for the current host.

**Passwords, ZeroFee's password store** (`Logins.swift`; on screen "Passwords", never "vault" or "Keychain"): a Secure Enclave P-256 key `si.zerofee.logins.v1`
(`[.privateKeyUsage, .biometryCurrentSet]`, This-Device-Only) seals each password with ECIES
(`.eciesEncryptionCofactorVariableIVX963SHA256AESGCM`, as Security's §E2 names it: an ephemeral P-256 key per seal,
cofactor ECDH with the enclave key, X9.63 SHA-256 KDF, AES-GCM). Sealing needs no Face ID; opening is the enclave's
ECDH, which needs it. Items under `si.zerofee.logins`, This-Device-Only, not synchronizable. Wiped when the account is
forgotten and on the first launch after an install (`zf.installed.v1` in UserDefaults).

**probe-partner-robot** (`ZF_PROBE_ROBOT=1`, `DebugProbeRobot.swift`; a local probe page with an https base URL and a
probe-only recipe), 26 Oct, iPhone 18 Pro Simulator, all as Security's §G asks:
(a) the page sees `typeof __zfRobot` = undefined (the robot world: object); (b) `messageHandlers.zfRobot` is undefined
for the page and a post throws; (c) "fill {{login.password}} into the comment box" is refused (not a password field),
and a literal into the password box too; (d) `{{login.other.example.password}}` is refused, and the rule refuses
`{{login.password}}` on another host (control: accepted on its own host); (e) after the password box is filled the
snapshot says filled and holds neither the password nor the email typed; (f) a click on a link to example.com is
cancelled, the mode ends (`left-recipe`), robot.js is gone from the user scripts and from its world, and a snapshot
after is `partner.robot.ended`; (g) `navigate` and `script` are `partner.act.unknown`; (h) a provider message from a
frame inside the page is refused (the main frame's `eth_accounts`, the control, answers `[]`); (i) `eth_sign`,
`eth_signTransaction`, `wallet_addEthereumChain` and an unknown method get 4200; EIP-6963 announces `si.zerofee`;
(j) the real robot.js passes its pin and a one-bit change is refused. Also: hidden off-screen text and the frame's text
are not in the snapshot; a commit button ("Buy now") pauses for the person and Continue resumes.

**Needs the test phone:** saving and opening a login (Face ID once per run, the enclave's ECDH), a `{{login.*}}` fill
end to end, `{{login.new}}` saved then typed, Reveal / Copy / Add sheets, a Face ID change locking the logins, the wipe
on account forget and on reinstall, the touch-to-pause gesture, background/lock ending a run, the connect sheet and
a real signature through Browser's engine. The Xcode 27 Simulator reports a Secure Enclave, so `ZF_PROBE_NO_CHIP=1`
(Debug only) shows what a phone without one answers (`logins.unavailable`).

## Known gaps (for Security, S1)

1. **The core signs with the chip key on the phone.** `core.ts` passes `hostDeviceKeys(host)` as DemoCore's
   `deviceKeys` seam, so the account's device key is made and used in the Secure Enclave and the core never holds that
   seed. Not verified on a simulator (it can't make the key, error -1020): the device checklist covers it.
2. **What else is kept in the core vault (the Keychain, this device only, not biometric).**
   - Agent's standing-order key (`agent-seed:<handle>`): it stays on the phone, so `keyOnThisPhone` is true and
     standing orders sign by the same path as in the web demo.
   - The extension's imported laptop trading key (`subwallet.import` stores it with
     `vault.put("subwallet-seed:<id>")`): it goes through the core's vault, not `device.secret`. Both are
     Keychain-backed with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` on the phone.
3. **Any code running in the page can call the bridge.** `key.sign` only opens the native sheet, for checked
   transaction bytes. Until phase 2 isolates the core, the words on that sheet come from the page's core.
   Only the app's own main frame from `zerofee-app://app` is accepted (`Host.isOurPage`, used by the bridge and the
   camera), a message from any other frame or origin is dropped and logged once, and nothing else is ever loaded into
   the web view: https links open in the system browser sheet. **Partner pages and any future Browser-app sites must
   open in `SFSafariViewController` or in a separate `WKWebView` that does NOT have the `zerofee` handler**, never in
   this web view. The existing `device.openUrl` sheet already does.
4. The key check (`zerofee://host/keycheck`) and the probe exist in Debug builds only.

## Block trackers (D131)

`apps/ios/ZeroFee/Trackers/trackers.txt` is the Browser's tracker list: the plain domain rules of EasyPrivacy, by The
EasyList authors (https://easylist.to/), dual licensed GPLv3+ / CC BY-SA 3.0+, taken here under CC BY-SA 4.0. The adapted
list (this file) is CC BY-SA 4.0. The app blocks each domain as a third-party load only (a site's own pages are never
blocked) and never blocks the hosts a site wallet or a sign-in needs (`TrackerRules.neverBlock`).

To refresh it, by hand: download https://easylist.to/easylist/easyprivacy.txt, keep the lines that are exactly
`||domain^` or `||domain^$third-party`, write their domains sorted and unique under the 6-line header, and update the
header's Version, Commit and sha256 (from the downloaded file's own header and `shasum -a 256`). Then bump
`TrackerRules.listVersion` so phones compile the new list, and run `sh apps/ios/check/partner.sh`.

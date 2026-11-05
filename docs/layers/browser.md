# S7: Browser

**Owns:** `packages/browser/` (the Browser app module: tabs, presets, the wallet connection UI),
`apps/ios/Packages/ZeroFeeBrowser/` (the native web engine host, inside S1's iPhone app), `errors.md`, and this file.
**Reads first:** `README.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/interfaces.md` (especially
`subwallet.*`).

## One wallet per chain (D55, D56; 2 Nov)

A site gets the chain's ONE wallet (`subwallet.create { chain }`: on Solana the same wallet Trade and the apps use; on
Ethereum, Base, Gnosis and Arbitrum the Browser wallet there); Gnosis Pay's card window keeps its own. Every request is the
core's decoded sheet with Face ID: no session covers a site. The apps wallet, its Add sheet and Take it all back are gone:
Apps says "Pays from Spending · $X ready on Solana" with one action, Make $10 ready (`spending.makeReady`). Browser's Wallet
tab is one row to Wallet's Details. The text below from before 2 Nov that names the apps wallet or slot 5 is history.

## Goal

A browser inside ZeroFee that opens any website and has **built-in support for apps like fomo and pump.fun**, with
ZeroFee as the connected wallet. When a site tells phone users "download our app", the browser finds a way around it.

## What you build

1. **The in-app browser** (native web engine on iPhone):
   - tabs, address bar, presets, history on the device only.
   - In the web demo, external sites can't be framed; show presets and explain that the browser lives in the phone app.
2. **The wallet connection.**
   - Inject standard wallet providers (Solana Wallet Standard, EIP-1193 / EIP-6963) so sites see a normal wallet.
   - Every request becomes `subwallet.sign` with the **browser wallet** (kind `browser`), a separate small wallet
     funded from the vault. A bad site can never reach the vault.
   - Every signature goes through the native approval sheet, decoded and simulated.
3. **Presets with per-site tweaks:**
   - **fomo:** it has no phone web app (probed 30 Oct; see Social trading below), and its computer page shrunk onto a
     phone was rejected, so on the phone fomo opens in **fomo's own app** (or its App Store page), never a window.
   - **pump.fun:** the site sits behind a bot check that real browsers pass. Never try to defeat bot checks with
     scripts. Also offer the **native path**: trade pump.fun coins on-chain through the Trade engine, which works even
     if the site changes.
4. **Safety:**
   - warnings for known phishing and drainer sites;
   - a clear "connected sites" list with one-tap disconnect;
   - no auto-connect.

## Rules

- Use public websites as a normal browser would. Never call a site's private APIs or copy its content, and respect each
  site's terms.

## Done means

- fomo and pump.fun open and connect on a real iPhone, and a dust trade (run by a human) completes through the browser
  wallet.
- Any website opens.
- `errors.md` covers every problem: the site wants its app, the site blocked the browser, a phishing warning, the
  browser wallet is empty, and so on.

## Design (26 Oct; rules from Security's wallet-mode section C and its rulings, approved board)

**Pieces.**
- `src/provider/provider.js` is the site's side.
  - It's one self-contained script, pinned by sha256 (`pin.ts`), that the iPhone host injects into the page world of
    the main frame at document start, in wallet mode only.
  - It offers EIP-1193 (`window.ethereum`, only if nothing else set it), EIP-6963 (announced as "ZeroFee",
    `si.zerofee`) and the Solana Wallet Standard. It never poses as another wallet.
  - It holds no key and no rule.
- `src/engine/engine.ts` answers requests. It's a service outside the trusted core, on `forApps(bridge, "browser")`.
  - It turns each request into a core call on the Browser wallet (`subwallet.*`, kind `browser`, one per chain).
  - The core decodes the bytes and shows its native sheet with "<host> asks", plus Face ID.
  - Pay runs a second instance for the card's window, with kind `pay` (Security's ruling F). The Browser never builds
    that instance.
- `src/sites.ts` and `src/presets.ts` say which sites the wallet answers:
  - presets (fomo, pump.fun, Mt Pelerin) and recipes whose wallet kind is `browser`, on their exact hosts and chains;
  - any other https site the person opens, as unknown. It gets an address only after the connect sheet says "ZeroFee
    doesn't know this site";
  - none at all on a child's phone.
- The app screens (Browse · Sites · Wallet) follow the approved board.

**Message path.**
1. The page sends `zerofeeWallet.postMessage({ id, method, params })` (WKScriptMessageHandlerWithReply). The page never
   names its own origin.
2. The host sends `device.wallet.request { id, method, params, origin, mainFrame }`, with origin and frame read from
   WebKit.
3. The engine answers with `device.wallet.reply { id, result }` or `{ id, error: { code, message } }`, using EIP-1193
   codes.
4. Events go to the page through `device.wallet.emit { host, event, data }`. The host delivers them as a
   `zerofee-wallet:event` CustomEvent, only while that host is still the one open.

**Rules the engine enforces (tested in `engine.test.ts`):**
- main frame, https, an allowed host;
- no address before a yes on the connect sheet, which is drawn natively by the host (no Face ID) and remembered per host
  in `device.store`;
- one sheet per site at a time (-32002);
- `eth_sign`, `eth_signTransaction`, `wallet_addEthereumChain` and older typed data are refused;
- the `from`, the chain and the typed data's `domain.chainId` must be the site's own;
- no contract creation;
- each chain has its own address, so switching network also sends `accountsChanged`.

**Waiting on others:**
- Security: `subwallet.sign` with `{ call }` (EVM send) and Solana sign-and-send, and `subwallet.read`. Until those
  land, `eth_sendTransaction`, `signAndSendTransaction` and reads answer with the core's Problem.
- UI's host builder: injection, the `device.wallet.*` methods, the connect sheet, the open-site bar, `device.openSite`.
- The operator: WalletConnect needs a WalletConnect/Reown project id (an account sign-up) and uses their relay servers.

## Social trading (30 Oct; app id `social`, `src/social/`; since grown into Apps, below)

An app of its own in the shelf, built on the Browser's pieces: a tray of **fomo · pump.fun · GMGN** and one
**social wallet** above every tab.

- **The social wallet is the Browser wallet on Solana.** The core's KIND_OF gives the `social` app the `browser` kind
  and no other (Security reviews), so a site opened from Social trading or the Browser is answered by the one Browser
  engine, every signature is the core's sheet, and the main balance is never a site's. The main sheet calls it "your
  social wallet". Make (one tap, then the Add sheet), Add ($10 / $25 / $50 / $100: `ledger.withdraw` of SOL through
  Trade's wallet service on kind `browser`, the main key's sheet), Take it all back (one tap, the core's sheet).
- **pump.fun and GMGN** connect outside wallets: `device.openSite` (Social trading may call it; the engine's own
  `device.wallet.*` stay the Browser's), wallet mode, Connect lists "ZeroFee".
- **fomo** accepts no outside wallet (Apple or Google sign-in, its own Privy wallet; checked 30 Oct), and its phone
  web has no phone app. Probed 30 Oct (headless Chrome and fomo's own bundles): fomo.family sends every user agent the
  same HTML and picks its layout by CSS width alone, never by user agent (iPhone, iPhone without "Mobile", iPad,
  Android Chrome, Mac) or touch. Signed out, under 800 px (780 gated, 800 not) the home page hides Login and Start
  trading and shows "Download app"; the app's pages (`/tokens/<chain>/<mint>`, `/discover`, `/coin`) send any
  signed-out visitor to `/` at any width. Signed in, the app's own CSS (`@media (max-width:799px) { .mobile-blocker
  {display:block} .desktop-content {display:none} }`) replaces the whole app with a full-screen "get the app" blocker,
  so there is no phone web trading even after sign-in. `/login` exists only for fomo's desktop app (404 otherwise); no
  subdomain (app., m., web., trade.) answers; its web manifest has no start_url; query flags change nothing. The product decision is fomo's real phone UI, never the
  computer page shrunk and never landscape, so on the phone **"Open fomo" opens fomo's own app**: `openSite { nativeApp:
  true }` (Social trading, fomo.family only) makes the host open the universal link https://fomo.family/ (its
  apple-app-site-association lists "/" for 29Y7P83395.family.fomo.app) with `universalLinksOnly`, and when the app isn't
  installed, fomo's App Store page (id6741115427, from its own apple-itunes-app tag); both addresses are fixed in Swift
  (PartnerApp). No window, nothing of ours in fomo. The funding stays here: in fomo, Deposit → Solana → Copy; back in
  Social trading, Fund fomo → Paste (the only clipboard read, D33), a Solana address only (Base/Ethereum, Bitcoin, Tron
  said by name), the amount, the core's sheet (`subwallet.signTx` of a plain SOL transfer, "Social trading says: Fund
  fomo with $10"). **1 Nov (D47): fomo left Apps** (no phone site, no outside wallet login): its card, Fund fomo, the
  paste checks (`fund-address.ts`), `trade.sendTo`, the host's `device.returned { action: "fund" }` and PartnerView's
  Fund bar are deleted. A fomo deposit address is paid with Wallet's Send, like any Solana address.
  `browser.social.app-didnt-open` when neither opened. The Browser app's fomo (its preset, a typed
  fomo.family address, or its history row) opens fomo's own app the same way (`ownApp: true` on the preset; the host's
  guard takes app `social` or `browser`, fomo.family only): no preset asks for the computer page any more. Only Social trading and Browser may call `device.openSite`; any other app is
  told "Only Browser and Social trading can open sites." The `app` both sides check is the one `forApps` stamps last
  over the app's own params, so no app can name another (checked 30 Oct; the page is ZeroFee's own bundle under a
  script-src 'self' CSP, main frame only).
- Web demo: each tab is the site's card, "Open <site>" opens the real site in a new tab; the social wallet runs on the
  sample bridge's sample money (its own made-up address, `SAMPLE_SOL_SOCIAL`), sized at the sample bridge's own SOL
  price (`ledger.tokens`), so the demo never asks a price host (the public site's CSP allows none). A SOL price that
  can't be had is `browser.social.price`, and any other failure `browser.social.failed`: never a silent stop.

## Apps (30 Oct, version 1, as the "ZeroFee App Store"; renamed Apps by D47 on 1 Nov; app id `social`, `src/social/`)

Social trading grew into **Apps**: a catalog of crypto web apps that run inside ZeroFee's own window,
each funded from the person's balance in one tap and emptied back in one tap. The name is one constant,
`APP_STORE_NAME` in `packages/core/src/app-store.ts` (now "Apps"): every screen, sheet hint and ledger record reads it.
D47: it is a browser opening phone sites, so it is never called an App Store (`catalog.test.ts` fails on the old
name). The app id stays `social`, so
`forApps`, KIND_OF, the host's `device.openSite` guard and the Swift side are unchanged.

- **One apps wallet, shared, not one per app.** The core keeps one Browser wallet per chain: on the EVM chains `create`
  is single by kind and chain, and on Solana a wallet made from the backup words' hot root is the same key every time
  (`hotSecret(root, "browser", "sol", 0)`); slots exist only for trading wallets. Several Browser wallets per chain would
  need a core change (a slot for `browser`, and the engine choosing a wallet by host), which is Security's to review, so
  version 1 has **one apps wallet** (the Browser wallet on Solana, once "your social wallet") and says so on every
  screen: "One small wallet for all your apps", "Shared by all your apps". No app ever reaches the main balance: a site
  connects to this wallet's address only, and every signature is the core's native sheet.
- **Catalog** (`catalog.ts`): rows with the app's own mark (`app/logos/SOURCE.md`), name, one plain line and a
  category (Trade, Swap, Earn). The tray is All apps · Trade · Swap · Earn. An app's page (a pushed screen) shows the
  apps wallet with **+$10 / +$25 / +$50 / +$100** in one tap each (the main key's sheet, Face ID), **Take it all back**,
  the app's own steps to ZeroFee in its wallet list, Open, and Having trouble?. The catalog keeps Make (one tap, then the
  Add sheet) and Add money.
- **Honest words (30 Oct).** Take it all back moves SOL only; its result line reads the wallet's other coins from the
  chain (`tokenBalances`) and says "Everything is back" only when none remain, else names them ("2 coins stay in your
  apps wallet: 120 JUP, 0.4 INF"), and says so when it could not read them. Names: the same wallet is "apps wallet" on
  the iPhone connect sheet when the App Store opened the window (plus "Shared by all your apps."), and in the core's
  sheets when the asker is the App Store ("From your apps wallet"); the Browser's screens keep "Browser wallet". On the
  phone a site's own signatures are still asked as app `browser`, so their sheet reads "From your browser wallet"
  whichever app opened the site. The Solana sheet also reads the Stake program's Authorize / AuthorizeChecked
  ("Gives control of a stake account to <address>", with a warning).
- **Every app is a Browser preset** (`presets.ts`), so its exact hosts and chains are in the iPhone's pin
  (`PinnedRecipes.swift`, `recipe-pin.test.ts`), and `catalog.test.ts` locks the App Store's hosts: a new host fails it
  until the list (and Security's review) changes. All are Solana only: the apps wallet holds SOL.
- **Web demo:** the catalog and the apps wallet run on the sample bridge's sample money and SOL price (no price host);
  "Open <app>" opens the real site in a new tab, and the page says that in the phone app it opens inside ZeroFee.

**Pin additions (30 Oct, for Security's review before release):** `jup.ag` [sol], `raydium.io` [sol],
`www.orca.so` [sol], `kamino.com` [sol], `app.sanctum.so` [sol]. Unchanged: `pump.fun` [sol],
`gmgn.ai` [sol, base], `app.mtpelerin.com` [base]. `fomo.family` [sol, base] stays pinned for the Browser's fomo
only (it opens fomo's own app); it is no longer in Apps (D47).

**Probe (30 Oct).** Playwright with system Chrome, headless, 390×844, iPhone user agent, touch;
ZeroFee's pinned `provider.js` injected at document start behind a stub `zerofeeWallet` handler (every request answers
null: nothing is connected or signed). For each site: does the page lay out for a phone (no sideways scroll, no "get
the app" wall), and after the site's own Connect steps, is "ZeroFee" in its wallet list? Screens and text logs are in
`$ZEROFEE_HOME/screens/app-store/probe/`.

| App | Host | Phone layout | ZeroFee in its wallet list | Listed |
|---|---|---|---|---|
| pump.fun | pump.fun | yes | yes: Sign in → "ZeroFee" | yes (Trade) |
| GMGN | gmgn.ai | yes (an app pop-up first) | yes on WebKit (iOS simulator, 30 Oct: Log In → "Connect with extension wallet" → "ZeroFee Installed"); headless Chrome shows a fixed six-wallet list without it | yes (Trade) |
| fomo | fomo.family | no phone web app | takes no outside wallet | no (D47, 1 Nov): pay its deposit address with Wallet's Send |
| Jupiter | jup.ag | yes | yes: Connect → Installed: ZeroFee | yes (Swap) |
| Raydium | raydium.io | yes | yes: Connect → first in the list | yes (Swap) |
| Orca | www.orca.so (/pools) | yes | yes: Connect Wallet → ZeroFee already chosen | yes (Swap) |
| Kamino | kamino.com (app.kamino.finance redirects) | yes | yes: Connect → the wallet list → ZeroFee | yes (Earn) |
| Sanctum | app.sanctum.so | yes | yes: Connect → Detected: ZeroFee | yes (Earn) |
| Meteora | www.meteora.ag | yes | only as an unnamed icon at the bottom of "More wallets" | no: too hard to find |
| Drift | app.drift.trade | yes | yes | no: leveraged trading |
| Magic Eden | magiceden.io | blocked (403 to the robot) | not seen | no |
| Uniswap | app.uniswap.org | blank page in the robot | not seen | no |
| Aerodrome | aerodrome.finance | yes | a generic "Browser Wallet" (EIP-1193), not by name | no: Base |
| Aave, Morpho, Zora | app.aave.com, app.morpho.org, zora.co | yes | yes (EIP-6963 / Wallet Standard) | no: Base or EVM; the apps wallet holds SOL only in version 1 |
| NEAR Intents | near-intents.org | yes | "Solana Wallet" sign-in lists ZeroFee, but the site says it is moving to near.com | no: moving |
| Rhea | app.rhea.finance | yes | NEAR wallets only | no: the provider has no NEAR wallet |

The Base and EVM apps that pass (Aave, Morpho, Zora) need the apps wallet to hold money on Base, which no tested path
funds yet (Trade's wallet service has no Base). They are the next candidates once it does.

## Spending (D52, 1 Nov)

The sites' wallet (the Browser wallet on Solana) is fed from **Spending**, not the Safe: a site's Add is
`spending.toSite` (Spending's cash, at once, no sheet: a Safe holding only USDC or NEAR can fund a site, H12), and
"Take it all back" is `spending.fromSite` (home to the Safe through Spending, on its way until it lands, H41). The
core reaches it as slot 5 of its own float moves, the recipient from its own list. It never rotates on its own; it
changes only after a key export or "Start fresh" (coming).

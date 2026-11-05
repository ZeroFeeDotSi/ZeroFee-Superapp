# PARs: the target tap count for every journey

The grading rubric (JOURNEY-PRINCIPLES.md, section E, M1) grades **Works** and **One-thumb** against a written PAR for each journey. With no PAR, M1 is graded F. This file holds one PAR per journey in the journey catalog (JOURNEYS.md, kept outside this repo with the grades), plus the four journeys the robot grader walks.

Each PAR is the **simplest correct path in today's app**, counted tap by tap. The last column is the target once the planned leverage patterns land.

## How taps are counted

- **One tap** is one press on the screen: a button, a row, a chip, a tab, a sheet's Approve, or Face ID (the passkey prompt in a browser).
- **Moving between apps is one tap** (J2, 2 Nov): the app bar at the bottom of every app names Security, Wallet, Trade, Chat and Apps, so any app, Security included, is one tap from any other. A swipe from anywhere on the page is the same move (one tap's worth). An app's own sections (Wallet's Balance · Activity, Trade's Home · Trade · Activity) are a segmented control at its top: one tap each, as before.
- **One value is one tap.** Typing a whole amount on the keypad, or pasting into a field with its Paste button, counts once, however many keys it takes.
- **Not counted:** waits the account's rules set (the recovery wait, a held change's wait), money arriving from outside, and reading.
- **Start and end.** A journey starts on the screen named in its row and ends on the goal's outcome screen ("Sent", "Your account is open", "Waiting… Ends …").
- **Grading:** A+ ≤ PAR − 1 · A = PAR · B = PAR + 1–2 · C = PAR + 3–4 · F > PAR + 4, or the goal not reached.

**Why set-up is 9 (grade 02h).** The backup words' Approve is a real signature: it adds the words to the account as its recovery key, a change to who can move the account, so it gets its own sheet. There is no later Approve in set-up to merge it with (the account is made by the free sponsor, the first sheet is this one), and folding it into the 3-word check would sign without the person seeing the sheet. So the row counts it: 9, not 8.

## The grader's four journeys

| Journey | Start → goal | Simplest correct path today (taps) | PAR | Target |
|---|---|---|---|---|
| **1. First-timer** | Welcome (fresh browser) → account open | Create my account (1) · Agree and make my key (2) · passkey (3) · I've written them down (4) · the 3-word check, one tap each (5–7) · Approve, adding the backup words as the recovery key (8) · Open ZeroFee (9) | **9** | 8: fold the passkey into Agree |
| 1b. First money in | Wallet → the address copied | Add (1) · Copy account name (2) | **2** | 2 |
| **2. Saver: change protection** | Wallet → "Waiting · Ends …" | Security, on the app bar (1) · Protection by amount (2) · the band (3) · the new limit (4) · Save these rules (5) · Approve (6) | **6** (7 before the app bar, J2) | 5: Protection one tap from Security's first view |
| 2b. Saver: send | Wallet → "Sent" | Send (1) · a Recent chip, or Paste for a new address (2) · the amount (3) · Send X (4) · Approve (5) | **5** | 4: the last person already picked |
| 2c. Saver: cancel a held change | Waiting screen → "Cancelled" | Cancel it (1) · Approve (2) | **2** | 2 |
| 2d. Saver: send all | Wallet → "Sent" | Send (1) · Recent chip or Paste (2) · Send all (3) · Send X (4) · Approve (5) | **5** | 4 |
| **3. Lost device** | Welcome (fresh browser) → "Your account is open" | I already have one (1) · Agree and continue (2) · paste the 24 words (3) · Bring back my account (4) · Approve (5) · *the wait* · Finish (6) · Approve (7) · Open ZeroFee (8) | **8** | 7: one approval for Finish |
| 3b. New words | Wallet → "Write these down" | Details (1) · Get new words (2) | **2** | 2 |
| **4. Multi: lock** | any screen → "ZeroFee is locked" | Settings (1) · Lock ZeroFee (2) | **2** | 2 |
| 4b. Multi: unlock | "ZeroFee is locked" → Home with money | Unlock (1) · passkey (2) | **2** | 1 |
| 4c. Multi: Activity | Wallet → Activity | Activity (1) | **1** | 1 |
| 4d. Multi: Spending's cap | Wallet → the new cap | Spending holds up to … (1) · a preset (2) | **2** | 2 |

## ZeroFee Chat (D55)

Each starts in ZeroFee Chat. A typed message, amount or city is one value: one tap.

| Journey | Start → goal | Simplest correct path today (taps) | PAR | Target |
|---|---|---|---|---|
| **C1. Join a place** | Chat's first screen → the place's messages | the city, typed (1) · its row, or Join (2). Or: Nearby (1) · the phone's Allow (2). Later: Your places · the place (1) | **2** | 2 |
| **C2. Post** | in a place → the message in the list | the message (1) · Post (2) | **2** | 2 |
| **C3. Private message** | in a place → the message in the private conversation | the person's name (1) · the message, in their sheet (2) · Send (3) | **3** | 3 |
| **C4. Request money** | in a place → the request in the list | Request money (1) · the amount (2) · the coin, when not the one it starts on (3) · Post the request (4). The network is the coin's own, or the one you receive on; Change only to pick another | **4** (3 with the coin it starts on) | 3 |
| **C5. Pay a request** | someone's request in a place → back in the place, "Sent" | the request's Pay chip (1) · Send X (2) · Approve (3) · Done (4) | **4** | 3: Done folded into the outcome |
| C6. Send from the composer | in a place → back in the place, "Sent" | "send 5 USDC to …" (1) · Post (2) · Send X (3) · Approve (4) · Done (5) | **5** | 4 |

After C5 and C6 the place asks whether to share the payment there; Not now is its main button, and neither answer is counted.

## The journey catalog (JOURNEYS.md)

| Journey | Start → goal | Simplest correct path today (taps) | PAR | Target |
|---|---|---|---|---|
| **Stages 0–2: install, account, first money** | Welcome → the Add address copied | As 1 and 1b above. Mainnet adds the funding screen's Copy (1). | **11** (testnet), **12** (mainnet) | 10 / 11 |
| **J1. Trader: first trade** | Wallet with money in the Safe → "Bought" | Top up (1) · Top up $X (2) · Approve (3) · Trade (4) · a coin (5) · Buy (6) · an amount preset (7) · Buy $X (8) · Approve (9) | **9** | 6: L1 pays Trade from the Safe, no Top up |
| J1b. Trader: profit home | a coin held → "Put away" | the coin (1) · Sell (2) · Sell all (3) · Approve (4) · Wallet (5) · Put away (6) · Put away everything (7) | **7** | 5 |
| **J2. App Store user** | Wallet → a signed buy inside pump.fun | Apps (1) · pump.fun (2) · Make $10 ready (3) · Approve (4) · Open pump.fun (5) · the site's Connect (6) · ZeroFee (7) · Let it see (8) · the site's Buy (9) · Approve (10) | **10** | 7: L13 removes Make $10 ready and its Approve |
| **J3. Saver: months of safety** | Wallet → the laptop added | Security, on the app bar (1) · Add a second device (2) · Add my laptop (3) · paste the laptop's code (4) · Add this laptop (5) · Approve (6) | **6** (7 before the app bar, J2) | 6 |
| J3b. Saver: limits | as 2 above | | **6** | 5 |
| J3c. Saver: check the words | Security → "Your words are right." | Recovery (1) · Check my words (2) · paste or type the 24 words (3) · Check (4) | **4** | 3 |
| **J4. Payer: send** | as 2b | | **5** | 4 |
| J4b. Payer: receive | as 1b | | **2** | 2 |
| **J5. Private user** (shut today: no PAR can be met until it opens) | Wallet → paid from Private | Private (1) · Move in (2) · the amount (3) · Move $X (4) · Approve (5) · then a send with the Private switch on: as 2b + the switch (6) | **11** | 9 |
| **J6. Loses something** | as 3 | | **8** | 7 |
| **J7. Under attack: stop a move** | the "Someone is moving your account" alert → "Stopped" | Stop it (1) · Approve (2) | **2** | 2 |
| **J8. Leaving** | Wallet → everything sent out | Put away (1) · Put away everything (2) · Send (3) · Paste (4) · Send all (5) · Send X (6) · Approve (7) | **7** | 5: one "Send everything" |

## Keeping this current

- A change that adds or removes a tap on one of these paths changes its row here in the same commit.
- A grade counts the taps it walked and compares them with this file. A path that has no row here gets one before the grade, or the grade says M1 is F for that path.

# S2: The shell and design system

**Owns:** `apps/web/`, `packages/shell-api/`, `packages/design/`, and this file.
**Reads first:** `README.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/interfaces.md`,
`packages/shell-api/src/app-module.ts`, `packages/core/src/{bridge,problem,signer}.ts`.

## Goal

The frame every app lives in, and the look every app shares. It should feel **ambient, minimal, artistic and
high-end**, and a five-year-old should be able to use it.

## What you build

1. **The app host.** Several apps inside one, each with its own world: screens plus its own bottom tray.
   - **Switch apps:** start at the right edge and drag at least 70% of the width to the left. The next app follows
     your finger (springy, 60 fps). Below 70% it snaps back.
   - **App switcher:** press and hold at the right edge, then drag about 30%. A slideshow of every app appears, like the
     iPhone's app switcher. Tap one to open it.
   - **Web demo:** a very subtle, minimal switch button for mouse users.
   - Apps never draw navigation between apps. They call `openApp(id, tab)`.
2. **The design system** (`packages/design`):
   - colour, type and motion tokens, plus an accent per app;
   - components: tray, buttons, amount, coin row with logo, address string, QR, sheet, list, empty state;
   - ambient backgrounds that are slow and quiet.
   - Rules: every coin and chain has a logo, bundled; small live numbers never roll digit by digit; one pill at most per
     screen.
3. **Onboarding**, using the security methods in `interfaces.md`:
   1. Welcome, with **Create account** / **I already have one**.
   2. The chip key, in one sentence, then Face ID.
   3. The 24 backup words, shown once and beautifully, then confirm three words. Explain simply that the words can only
      add a new phone after 7 days, and the phone can cancel.
   4. The address string with a **"Send from"** chain dropdown and a tiny QR button.
   5. Enter the apps.
4. **Shared screens:**
   - the **Problem view**, which renders any `Problem`: what happened, money state with *where*, one button;
   - "Was this you?" on `recovery.started`;
   - the recover flow, with 24 words checked one by one ("word 7 isn't on the list") and a countdown.
5. **`MockBridge`** (in `packages/shell-api`): realistic sample answers for **every** method in `interfaces.md`,
   including every Problem code, so all other app sessions can build before the real layers land.
6. **The demo approval sheet,** for the web demo only (the iPhone's is native and drawn by S1). It renders `PlainWords`
   verbatim and is labelled demo.
7. **App registry** `apps/web/src/apps.ts`: one line per app. Apps add their own line.

## Stack (your decision; announce it in `docs/interfaces.md` before others build UI)

- TypeScript and React, pinned versions, minimal dependencies, a static build.
- It runs as the web demo and inside the iPhone app's web view.
- No network calls from UI code: all data comes through the bridge.

## Done means

- The switch gesture, the switcher, the button, onboarding and the Problem view all work on a phone-sized screen at
  60 fps.
- `MockBridge` covers every method and Problem code.
- Snapshot tests exist for the Problem view and the demo approval sheet, which must show `PlainWords` verbatim.
- Screen-reader labels and large-text support work.

## First steps

1. **A design board of the shell, onboarding and the switcher, as images. Show it before building anything.**
2. Set up the stack, the tokens and `MockBridge`, and publish the `AppModule` component type, so the other sessions
   can start their screens.
3. Build the gesture, the switcher, onboarding and the shared screens.

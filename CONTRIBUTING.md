# Working on ZeroFee

Several sessions build ZeroFee in parallel, one per layer. These rules keep them from stepping on each other.

## Before you start

Read `README.md`, `docs/ARCHITECTURE.md`, `docs/interfaces.md` and your layer's brief in `docs/layers/`.

## Your own branch and folder

- Each layer works in its own git worktree, on its own branch, next to the main checkout:
  ```sh
  git worktree add ../zerofee-<layer> -b layer/<layer> main
  cd ../zerofee-<layer> && npm ci --ignore-scripts
  ```
- **Only edit the folders your layer owns** (see the table in `docs/ARCHITECTURE.md`).
  - To change a shared shape (`problem.ts`, `signer.ts`, `interfaces.md`), ask its owner.
  - To add a method your app offers, add the row to `interfaces.md` yourself, in the same commit as the code.
  - Register your app in the shell with **one line** in `apps/web/src/apps.ts`, the only file every app touches.
  - Each package has its own `package.json` (workspace) and its own tests (`*.test.ts`), run by `npm test` at the
    root.

## Dependencies

- Add them only when needed, pinned to an exact version at least two weeks old:
  `npm install --save-exact --ignore-scripts <pkg>@<version>`
- Say why in the commit message. Fewer is safer.

## Committing

- Commit with UTC time: `TZ=UTC git commit …`.
- Once per clone, run `npm run hooks`: it points git at the versioned hooks in `tools/hooks/`. They refuse local
  timestamps, an identity other than ZeroFee's, personal details (patterns in your own `.git/info/leak-patterns`,
  never committed), signing and env files, and secrets by their shape (`tools/hooks/secret-shapes.mjs`: API keys,
  tokens, private keys, twelve or more backup words in a row), in staged lines and in the message. Don't bypass them;
  fix what they point at. A made-up example kept on purpose (a test vector) carries `zerofee-allow-secret-shape`.
- Stage explicit paths (`git add <paths>`), never `git add -A` on a shared tree.
- Never use a bare `git stash`. The stash is shared across worktrees.

## Landing on main

1. In your worktree: `TZ=UTC git rebase main`, then run `npm test` plus your layer's own tests. A rebase rewrites the
   commit times and skips the commit hooks, so without `TZ=UTC` it stamps your local time zone. `npm test` refuses
   that; re-stamp with `TZ=UTC git rebase -f main`.
2. From the main checkout: `git merge --ff-only layer/<layer>`.
3. If the lockfile conflicts, take `main`'s copy and re-run `npm install --ignore-scripts`.

Never rewrite `main`. Nothing is pushed anywhere without the team's explicit say-so.

## Money and secrets

- **Testnet is free.** Put testnet secrets only under `$ZEROFEE_HOME/` (mode 600). Never print them.
- **Mainnet transactions are run by a human.**
  - Prepare the step, print what it will do, and hand over one command.
  - Use dust amounts only.
- Never commit keys, seeds, words, API keys or `.env` files.

## Problems and errors

Every failure your layer can produce is a `Problem` (`packages/core/src/problem.ts`), listed in your `errors.md` with:
- what happened;
- where the money is;
- the one next step.

Nothing reaches the user as a raw error.

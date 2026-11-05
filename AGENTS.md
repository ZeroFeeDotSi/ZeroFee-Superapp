# Notes for AI coding agents and reviewers

Everything below runs on a fresh machine with Node 24 (`.nvmrc`) and no keys, accounts or network access for tests.

| Goal | Command | What you should see |
|---|---|---|
| Install | `npm ci --ignore-scripts` | `found 0 vulnerabilities` |
| Run the app on sample money | `npm run dev`, then open `http://localhost:5180/?demo` | a **SIM** badge and **Create my account** |
| Check the page answers | `curl -s -o /dev/null -w '%{http_code}' 'http://localhost:5180/?demo'` | `200` |
| Everything CI runs | `make verify` (install, typecheck, tests, build) | exit code 0 |
| One test file | `node --import ./tools/test/no-network.ts --test packages/core/src/recovery-words.test.ts` | `pass 4`, `fail 0` |
| Self-host with the relay | `make selfhost` | `ZeroFee is running: http://localhost:5180/` |
| The NEAR contract (needs Rust) | `npm run test:contract` | cargo tests pass |

- Layout: `apps/web` (the app), `packages/*` (one per part of the app; `packages/core` holds keys and signing),
  `apps/quotes` (the relay), `contracts/account-policy` (the NEAR contract, Rust). See README "Where to look in 10 minutes".
- Tests never touch the network: `tools/test/no-network.ts` blocks it. Tests use fixtures, never real accounts or keys.
- Never commit `.env` or any key; `.env.example` is the template. Security reports: SECURITY.md.

# S9: Agent (an AI money assistant with on-chain limits)

**Owns:** `packages/agent/` (the Agent app module and planner), `contracts/account-policy/modules/agent/` (rules and
tests, merged into the account contract by S1), `errors.md`, and this file.
**Reads first:** `README.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/interfaces.md`, `docs/layers/security.md`,
`docs/layers/wallet.md`.

## Goal

Ask in plain words and the assistant does it, **within limits the chain enforces**, so the AI can never spend more than
you allowed, whatever it is told or tricked into.
- "Pay rent of 800 USDC to landlord.near on the 1st."
- "Keep 500 USDC; convert anything above it to NEAR."
- "Sell my SOL if it drops 20%."

## What you build

1. **Limits on-chain** (module for the account contract):
   - an agent key that can only call the account contract's agent methods;
   - spend caps per day and per month;
   - allowed recipients and tokens;
   - an expiry date, and one-tap revoke.
   - The contract checks every spend. You write the module and its tests; S1 reviews and merges.
   - Prove with tests that a prompt-injected agent **cannot** exceed its limits.
2. **The planner:**
   - turns the user's words into a plan of `ledger.*` actions;
   - shows the plan in plain words for one approval;
   - then runs it on schedule within the limits.
   - Every action is logged in the app.
3. **The model:**
   - Use Claude (latest models), with the user's own API key or NEAR's private inference. Research both and compare:
     self-hosted means no ZeroFee server sees the user's requests.
   - Never send keys or full balances to a model, only what the plan needs.
4. **The app:** a chat screen, active rules with a pause/revoke switch, and a log of everything the agent did.

## Hackathon fit

NEAR's tracks include Agent Economy, AI Security & Defense, and Privacy & Private AI. On-chain limits that an attacked
agent can't break are the story.

## Done means

- On testnet:
  - a scheduled payment runs within limits;
  - an over-limit or off-list spend is refused by the contract;
  - a prompt-injection test fails to move money;
  - revoke stops everything at once.
- `errors.md` covers every problem: a limit was reached, the model is unavailable, the plan was rejected, the key was
  revoked.

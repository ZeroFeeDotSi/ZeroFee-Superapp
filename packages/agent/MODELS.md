# Which model Agent thinks with

Checked 25 Oct 2026, from the providers' own documentation and live CORS checks. Recheck before launch: offers change.

## Decision (D6)

- **Default: Claude, on the person's own Anthropic API key**, called straight from the device. Model: `claude-opus-5-5`
  at effort medium, the one constant in `src/claude.ts` (D82, 2 Nov; was `claude-sonnet-5-5`). AgentZero's rule
  box also reads with ZeroFee's own key for free sign-ups, through the relay (D88); a person's own key never goes there.
- **Option: private mode on NEAR AI Cloud**, on the person's own NEAR AI account and key. Only the open models that run
  inside sealed hardware (TEEs) count as private.
- **Never a ZeroFee server.** ZeroFee sees neither the words nor the key.

## How they compare

| | Claude (own key) | NEAR AI Cloud, private mode |
|---|---|---|
| Account | The person's Anthropic account and key | The person's cloud.near.ai account, credits and key |
| Who can read the words | Anthropic, under its API data terms | Nobody but the sealed hardware, per NEAR (Intel TDX and NVIDIA confidential GPUs) |
| Proof of privacy | None beyond Anthropic's terms | Remote attestation that a client can check (`docs.near.ai/cloud/verification`) |
| Models | Claude | Open-weight models in TEEs (e.g. Qwen, GLM). NEAR also passes Claude, GPT and Gemini on to their makers, **outside** sealed hardware, so we never call those private. |
| Tool calling | Yes | Yes, OpenAI format, on models whose `/v1/models` entry lists `tools` |
| From the device | Yes: `api.anthropic.com` allows any origin with the `anthropic-dangerous-direct-browser-access` header | Yes: `cloud-api.near.ai/v1` answered a CORS preflight; not documented |
| Cost | Anthropic's prices, billed to the person | Per token, billed to the person's NEAR AI credits (staking NEAR can also earn credits) |

## What the model sees, and why it can't move money

- **Only what the plan needs:** the person's words, the names of their coins, and the names of their saved
  recipients. Never keys, never balances, never addresses it could swap.
- **It runs only to make a plan.** After the person approves, plain code carries the plan out, with no model in the
  loop, so nothing the model reads later (a token's name, a memo, a web page) can steer it.
- **The chain is the limit.** Even a fully hijacked agent key is refused by NEAR outside its three methods, and by the
  account contract outside its budget (`contracts/account-policy/modules/agent`, proven on testnet with
  `packages/agent/tools/limits-testnet.ts`).

## Sources

- Anthropic API, browser access: the CORS response of `api.anthropic.com/v1/messages` (25 Oct 2026).
- Anthropic data retention: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- NEAR AI Cloud: https://docs.near.ai/cloud/private-inference.md, https://docs.near.ai/cloud/quickstart.md,
  https://docs.near.ai/cloud/guides/openai-compatibility.md, https://docs.near.ai/cloud/verification, https://near.ai/models

## Still open

- NEAR AI sign-up: whether it asks for an email or an identity check. The person does this themselves.
- Whether a browser can verify NEAR AI's attestation itself (the JS SDK may allow it; untested).
- Tool-call reliability of the TEE models on our planner's schema: to measure before private mode ships.

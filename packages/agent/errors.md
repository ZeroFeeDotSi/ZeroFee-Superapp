# AgentZero problems (the Sign-up Robot's planner)

Every Problem `src/agent-problems.ts` can produce (robot/think.ts, Pay's `agent.robot.next`). A test checks that every code
there is listed here and nothing else is. Money: every one leaves the money in the person's Safe. The old Agent app's rows
(its rules, setup and the contract's refusals) went with its screens (D110).

| Code | What happened | Money | Next step |
|---|---|---|---|
| `agent.model.key-missing` | AgentZero needs your Claude key before it can plan anything. | In your Safe | Add my key |
| `agent.model.key-invalid` | Anthropic didn't accept your Claude key. | In your Safe | Paste my key again |
| `agent.model.no-credit` | Your Anthropic account has no credit, so Claude can't plan until you add some. | In your Safe | Add credit at Anthropic |
| `agent.model.busy` | Claude is busy right now, so AgentZero made no plan. | In your Safe | Try again |
| `agent.model.offline` | AgentZero can't reach Claude from this phone right now. | In your Safe | Try again |
| `agent.model.unavailable` | Claude didn't answer properly, so AgentZero made no plan. | In your Safe | Try again |
| `agent.model.refused` | Claude declined to plan this, so nothing changed. | In your Safe | Ask in other words |
| `agent.plan.unreadable` | AgentZero's plan didn't make sense, so it was dropped. | In your Safe | Ask in other words |
| `agent.robot.not-allowed` | Only Pay's sign-ups can use the Sign-up Robot, so nothing ran. | In your Safe | Go back |

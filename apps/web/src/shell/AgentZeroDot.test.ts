import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setAgentZeroWorking, agentZeroWorking, workingLine } from "../../../../packages/shell-api/src/agentzero-working.ts";

test("D114: the shell says AgentZero at work as its one notice at the bottom, with the site and Stop", () => {
  const host = readFileSync(new URL("./AppHost.tsx", import.meta.url), "utf8");
  assert.match(host, /const agentNotice = useAgentZeroNotice\(\);/);
  assert.match(host, /<NoticeBar items=\{\[[^]*agentNotice,/);
  let stopped = false;
  setAgentZeroWorking({ host: "pump.fun", stop: () => { stopped = true; } });
  assert.equal(workingLine(agentZeroWorking()!), "AgentZero is working on pump.fun");
  agentZeroWorking()!.stop();
  assert.ok(stopped);
  setAgentZeroWorking(null);
  assert.equal(agentZeroWorking(), null);
});

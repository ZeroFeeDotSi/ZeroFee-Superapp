// D114: "AgentZero is working on <site> · Stop" on every screen while AgentZero's browser acts on the phone. The Browser's
// live view sets it (packages/shell-api/src/agentzero-working.ts); the shell only says it, as its one notice at the
// bottom (NoticeBar.tsx, product decision, 3 Nov), with Stop on the line. Words only: never a page.
import { useEffect, useState } from "react";
import { agentZeroWorking, onAgentZeroWorking, workingLine, type AgentZeroWorking } from "@zerofee/shell-api/agentzero-working.ts";
import { RANK, type NoticeItem } from "./NoticeBar.tsx";

export function useAgentZeroNotice(): NoticeItem | null {
  const [w, setW] = useState<AgentZeroWorking | null>(agentZeroWorking());
  useEffect(() => onAgentZeroWorking(setW), []);
  if (!w) return null;
  const line = workingLine(w);
  return { key: `agent:${line}`, rank: RANK.agent, line, act: { label: "Stop", run: () => w.stop() } };
}

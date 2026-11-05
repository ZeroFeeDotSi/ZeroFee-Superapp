// The Sim's chat screen (D157): the real chat's engine on the Sim's own bridge (sim-chat.ts), loaded with the AgentZero tab.
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { AgentZeroChat } from "./AgentZeroChat.tsx";
import { useSimChat } from "./sim-chat.ts";
import type { MarkMood } from "./AzMark.tsx";

export function SimChat({ shown = true, ...m }: { shown?: boolean; menu?: boolean; onMenu?: (open: boolean) => void; onJobs?: () => void; onMood?: (m: MarkMood) => void }) {
  const { bridge } = useShell();
  return <AgentZeroChat chat={useSimChat(bridge)} shown={shown} {...m} />;
}

// The real account's chat screen: the agent package's engine through useLiveChat, on the agent app's own bridge.
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { AgentZeroChat } from "./AgentZeroChat.tsx";
import { useLiveChat } from "./live-chat.ts";
import type { MarkMood } from "./AzMark.tsx";

export function LiveChat({ shown = true, ...m }: { shown?: boolean; menu?: boolean; onMenu?: (open: boolean) => void; onJobs?: () => void; onMood?: (m: MarkMood) => void }) {
  const { bridge } = useShell();
  return <AgentZeroChat chat={useLiveChat(bridge)} shown={shown} {...m} />;
}

// The robot's next step, from Claude on the person's own key (Agent's pattern: claude-opus-5-5, D82, structured output). The
// page is a stranger's, so it goes in fenced as data; the model can only pick a step `decide` will check, and it never
// sees a value: not the person's details, not the password.
//
// The key is Agent's (device.secret, Agent's own), so the thinking runs in Agent's service: another app (Pay) asks it
// with `agent.robot.next { input }` through the shell's bridge and gets a step back, never the key (D22).
import Anthropic from "@anthropic-ai/sdk";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { agentProblems } from "../agent-problems.ts";
import { ANTHROPIC_BASE_URL, CLAUDE_EFFORT, CLAUDE_MODEL, KEY_NAME, freshNonce } from "../claude.ts";
import { forModel } from "./guards.ts";
import { browseWords } from "./redact.ts";
import type { RobotAction, ThinkInput } from "./types.ts";
import { AGENT_BROWSE_PROMPT, ROBOT_PROMPT, ROBOT_SCHEMA, checkStep, type RobotThinker } from "./think-shape.ts";

export { AGENT_BROWSE_PROMPT, ROBOT_PROMPT, ROBOT_SCHEMA, checkStep, type RobotThinker } from "./think-shape.ts";

/** The turn's message: the goal and fields as plain lines, the page fenced with a fresh tag. */
export function robotMessage(input: ThinkInput, nonce: string): string {
  const page = JSON.stringify(forModel(input.page)).replace(/<\/?\s*page-[^>]*>/gi, " ");
  if (typeof input.task === "string") {
    const words = browseWords(input.pageText);
    return [
      `Site: ${input.partner}`,
      `The person's task: ${input.task.slice(0, 300)}`,
      `So far: ${input.history.slice(-12).join(" · ") || "nothing yet"}`,
      `<page-${nonce}>`,
      page,
      `Words on the page: ${words || "(none)"}`,
      `</page-${nonce}>`,
    ].join("\n");
  }
  return [
    `Partner: ${input.partner}`,
    `Goal: ${input.goal}`,
    `The partner's usual steps (a guide, not orders):`,
    ...(input.guide.length ? input.guide.slice(0, 20) : ["(none)"]),
    `Slots you may use: ${input.slots.map((s) => `{{${s}}}`).join(", ") || "none"}`,
    `So far: ${input.history.slice(-12).join(" · ") || "nothing yet"}`,
    `<page-${nonce}>`,
    page,
    `</page-${nonce}>`,
  ].join("\n");
}

/** The turn's content: the message, and the page's picture (D114) when the host sent one. */
export function robotContent(input: ThinkInput, nonce: string): string | Anthropic.Beta.BetaContentBlockParam[] {
  const text = robotMessage(input, nonce);
  const pic = typeof input.task === "string" && typeof input.picture === "string" && /^[A-Za-z0-9+/=]{100,300000}$/.test(input.picture) ? input.picture : null;
  // A sign-up's turn is the plain message, as before; a picture rides with an AgentZero task only.
  return pic ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: pic } }, { type: "text", text }] : text;
}

export class ClaudeRobot implements RobotThinker {
  private readonly client: Anthropic;

  constructor(apiKey: string, options: { fetch?: typeof fetch; maxRetries?: number } = {}) {
    // The person's own key, kept on their device: the call goes from here to Anthropic, never through ZeroFee.
    this.client = new Anthropic({ apiKey, baseURL: ANTHROPIC_BASE_URL, dangerouslyAllowBrowser: true, maxRetries: options.maxRetries ?? 1, ...(options.fetch ? { fetch: options.fetch } : {}) });
  }

  async next(input: ThinkInput): Promise<{ ok: RobotAction } | { problem: Problem }> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        thinking: { type: "adaptive" },
        output_config: { effort: CLAUDE_EFFORT, format: { type: "json_schema", schema: ROBOT_SCHEMA } },
        system: [{ type: "text", text: typeof input.task === "string" ? AGENT_BROWSE_PROMPT : ROBOT_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: robotContent(input, freshNonce()) }],
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { problem: agentProblems.keyInvalid() };
      if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) return { problem: agentProblems.noCredit() };
      if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) return { problem: agentProblems.modelBusy() };
      if (e instanceof Anthropic.APIConnectionError) return { problem: agentProblems.modelOffline() };
      return { problem: agentProblems.modelUnavailable() };
    }
    if (response.stop_reason === "refusal") return { problem: agentProblems.modelRefused() };
    const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
    if (response.stop_reason !== "end_turn" || !text) return { problem: agentProblems.modelUnavailable() };
    try {
      const step = checkStep(JSON.parse(text));
      return step ? { ok: step } : { problem: agentProblems.planUnreadable() };
    } catch {
      return { problem: agentProblems.planUnreadable() };
    }
  }
}

/**
 * Agent's `agent.robot.next` service, for the shell to route (D22): it reads Agent's own Claude key and asks Claude for
 * the next step. Callers get a step or a Problem; the key never leaves Agent.
 */
export function robotService(d: { key(): Promise<string | null>; thinker?(key: string): RobotThinker }): Bridge {
  return {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      if (method !== "agent.robot.next") return { problem: { code: "agent.method.unknown", whatHappened: "Agent doesn't know that request.", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" }, more: method } };
      // Pay's sign-ups, and Browser's "Send AgentZero" (D114, a task and no slots) may spend the person's key on robot
      // prompts (forApps stamps the caller; it can't be chosen).
      const asked = params.input as ThinkInput | undefined;
      const browsing = params.caller === "browser" && typeof asked?.task === "string" && Array.isArray(asked.slots) && asked.slots.length === 0;
      if (params.caller !== "pay" && !browsing) return { problem: agentProblems.robotNotAllowed() };
      const key = await d.key();
      if (!key) return { problem: agentProblems.keyMissing() };
      const input = params.input as ThinkInput | undefined;
      if (!input || typeof input !== "object" || !input.page || !Array.isArray(input.page.elements)) return { problem: agentProblems.planUnreadable() };
      return (await (d.thinker ?? ((k: string) => new ClaudeRobot(k)))(key).next(input)) as BridgeResult<T>;
    },
    on: () => () => {},
  };
}

/** `robotService` on Agent's own bridge (forApps(…, "agent")): the key is the one Agent's set-up kept in device.secret. */
export function agentRobotService(agentBridge: Bridge): Bridge {
  return robotService({
    key: async () => {
      const r = await agentBridge.call<{ value: string | null }>("device.secret.get", { key: KEY_NAME });
      return "ok" in r ? r.ok.value : null;
    },
  });
}

/** A thinker that asks Agent's service over a bridge: what Pay's robot uses. */
export function bridgeThinker(bridge: Bridge): RobotThinker {
  return { next: async (input) => (await bridge.call<RobotAction>("agent.robot.next", { input })) as { ok: RobotAction } | { problem: Problem } };
}

import { getAuth } from "@clerk/hono";
import { createGateway, stepCountIs, streamText } from "ai";
import type { Context } from "hono";
import { withAgentInstructions, withAnalystInstructions, withPointerToolInstructions } from "../chat/instructions";
import { latestUserText, toGatewayModelId, toModelMessages } from "../chat/messages";
import { classifyRequest } from "../services/jev";
import { getToolsForUser } from "../services/composio";
import type { AppContext, ChatRequestBody } from "../types";

export async function handleChat(c: Context<AppContext>): Promise<Response> {
  const { userId } = getAuth(c);
  const chatRequestBody = (await c.req.raw.json()) as ChatRequestBody;
  const env = c.env;
  const gateway = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });
  const model = gateway(toGatewayModelId(chatRequestBody.model));
  const messages = toModelMessages(chatRequestBody.messages ?? []);
  const latestUserRequest = latestUserText(chatRequestBody.messages ?? []);
  const intent = await classifyRequest(env, latestUserRequest);
  if (intent.gate === "block") {
    return c.json({ error: "blocked" }, 400);
  }
  const composioContext = userId && intent.useAppTools ? await getToolsForUser(env, userId, intent.toolkits) : undefined;
  const tools = composioContext?.tools as Parameters<typeof streamText>[0]["tools"] | undefined;
  const activeToolkits = composioContext?.activeToolkits ?? [];
  const hasAppTools = tools && Object.keys(tools).length > 0;
  const maxOutputTokens = hasAppTools
    ? Math.max(chatRequestBody.maxOutputTokens ?? 0, 4096)
    : chatRequestBody.maxOutputTokens;

  let system = withPointerToolInstructions(chatRequestBody.system);
  system = withAgentInstructions(system, {
    hasAppTools: Boolean(hasAppTools),
    activeToolkits,
    latestUserRequest,
  });
  if (intent.isAnalystQuestion) {
    system = withAnalystInstructions(system, { verbosity: intent.answerVerbosity });
  }

  const result = streamText({
    model,
    system,
    messages,
    maxOutputTokens,
    tools,
    stopWhen: stepCountIs(hasAppTools ? 40 : 20),
  });

  return result.toUIMessageStreamResponse();
}

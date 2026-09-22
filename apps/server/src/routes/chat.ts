import type { Context } from "hono";
import { withAgentInstructions, withAnalystInstructions, withPointerToolInstructions } from "../chat/instructions";
import { latestUserText, previousExchangeSummary, toGatewayModelId } from "../chat/messages";
import { classifyRequest } from "../services/jev";
import { getToolsForUser } from "../services/composio";
import type { AppContext, ChatMessage, ChatRequestBody } from "../types";

type WorkersAiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type WorkersAiStreamChunk = {
  response?: string;
  choices?: Array<{ delta?: { content?: string } }>;
};

const TEXT_PART_ID = "t";

export async function handleChat(c: Context<AppContext>): Promise<Response> {
  const chatRequestBody = (await c.req.raw.json()) as ChatRequestBody;
  const env = c.env;

  const latestUserRequest = latestUserText(chatRequestBody.messages ?? []);
  const priorExchange = previousExchangeSummary(chatRequestBody.messages ?? []);
  const intent = await classifyRequest(env, latestUserRequest, fetch, {
    previousExchangeSummary: priorExchange,
  });
  if (intent.gate === "block") {
    return c.json({ error: "blocked" }, 400);
  }

  const userId = c.get("userId");
  const composioContext = intent.useAppTools
    ? await getToolsForUser(env, userId, intent.toolkits)
    : undefined;
  const tools = composioContext?.tools;
  const hasAppTools = Boolean(tools && Object.keys(tools).length > 0);
  if (hasAppTools) {
    return c.json({ error: "tools unsupported with workers-ai model" }, 501);
  }

  let system = withPointerToolInstructions(chatRequestBody.system);
  system = withAgentInstructions(system, {
    hasAppTools,
    activeToolkits: composioContext?.activeToolkits ?? [],
    latestUserRequest,
  });
  if (intent.isAnalystQuestion) {
    system = withAnalystInstructions(system, { verbosity: intent.answerVerbosity });
  }

  const messages = toWorkersAiMessages(system, chatRequestBody.messages ?? []);
  const modelId = toGatewayModelId(chatRequestBody.model);

  const inputs: Record<string, unknown> = { messages, stream: true };
  if (chatRequestBody.maxOutputTokens !== undefined) {
    inputs.max_tokens = chatRequestBody.maxOutputTokens;
  }

  const ai = env.AI as unknown as {
    run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
  };
  const aiStream = await ai.run(modelId, inputs);
  const sseBody = workersAiStreamToUIMessageSSE(aiStream);

  return new Response(sseBody, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}

function toWorkersAiMessages(system: string, chatMessages: ChatMessage[]): WorkersAiChatMessage[] {
  const messages: WorkersAiChatMessage[] = [];
  if (system.trim()) {
    messages.push({ role: "system", content: system });
  }
  for (const message of chatMessages) {
    messages.push({ role: message.role, content: flattenContent(message) });
  }
  return messages;
}

function flattenContent(message: ChatMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .map((block) => (block.type === "text" ? block.text : "[image]"))
    .join("\n");
}

function sseLine(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export function workersAiStreamToUIMessageSSE(aiStream: unknown): ReadableStream<Uint8Array> {
  const source = toByteStream(aiStream);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueueEvent = (payload: unknown) => controller.enqueue(sseLine(payload));

      enqueueEvent({ type: "start" });
      enqueueEvent({ type: "start-step" });
      enqueueEvent({ type: "text-start", id: TEXT_PART_ID });

      try {
        if (source) {
          const reader = sseEventReader(source);
          for await (const data of reader) {
            if (data === "[DONE]") {
              break;
            }
            const delta = extractTextDelta(data);
            if (delta) {
              enqueueEvent({ type: "text-delta", id: TEXT_PART_ID, delta });
            }
          }
        }
        enqueueEvent({ type: "text-end", id: TEXT_PART_ID });
        enqueueEvent({ type: "finish-step" });
        enqueueEvent({ type: "finish" });
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        enqueueEvent({ type: "error", errorText });
      } finally {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });
}

function toByteStream(aiStream: unknown): ReadableStream<Uint8Array> | undefined {
  if (!aiStream || typeof aiStream !== "object") {
    return undefined;
  }
  if (aiStream instanceof ReadableStream) {
    return aiStream as ReadableStream<Uint8Array>;
  }
  const body = (aiStream as { body?: unknown }).body;
  if (body instanceof ReadableStream) {
    return body as ReadableStream<Uint8Array>;
  }
  return undefined;
}

async function* sseEventReader(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trimEnd();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.startsWith("data:")) {
          continue;
        }
        const data = line.slice(5).trim();
        if (data) {
          yield data;
        }
      }
    }

    buffer += decoder.decode();
    const trailing = buffer.trim();
    if (trailing.startsWith("data:")) {
      const data = trailing.slice(5).trim();
      if (data) {
        yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function extractTextDelta(data: string): string | undefined {
  let chunk: WorkersAiStreamChunk;
  try {
    chunk = JSON.parse(data) as WorkersAiStreamChunk;
  } catch {
    return undefined;
  }

  if (typeof chunk.response === "string" && chunk.response.length > 0) {
    return chunk.response;
  }

  for (const choice of chunk.choices ?? []) {
    const content = choice.delta?.content;
    if (typeof content === "string" && content.length > 0) {
      return content;
    }
  }

  return undefined;
}

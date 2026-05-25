import { clerkMiddleware, getAuth } from "@clerk/hono";
import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { createGateway, stepCountIs, streamText, type AssistantContent, type ModelMessage, type UserContent } from "ai";
import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";


interface Env {
  AI_GATEWAY_API_KEY: string;
  GEMINI_API_KEY: string;
  ASSEMBLYAI_API_KEY: string;
  COMPOSIO_API_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY?: string;
}

type ChatMessage = {
  role: "user" | "assistant";
  content: string | ChatContentBlock[];
};

type ChatContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      image: string;
      mediaType: string;
    };

type ChatRequestBody = {
  model?: string;
  maxOutputTokens?: number;
  system?: string;
  messages?: ChatMessage[];
};

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["DELETE", "GET", "POST", "OPTIONS"],
  })
);

app.use("/chat", clerkMiddleware());
app.use("/integrations/*", clerkMiddleware());
app.use("/tts", clerkMiddleware());
app.use("/transcribe-token", clerkMiddleware());

app.post("/chat", requireAuth, (c) => handleChat(c));
app.get("/integrations/:toolkit/status", requireAuth, (c) => handleToolkitStatus(c));
app.post("/integrations/:toolkit/connect", requireAuth, (c) => handleToolkitConnect(c));
app.delete("/integrations/:toolkit/disconnect", requireAuth, (c) => handleToolkitDisconnect(c));
app.post("/tts", requireAuth, (c) => handleTTS(c.req.raw, c.env));
app.post("/transcribe-token", requireAuth, (c) => handleTranscribeToken(c.env));

app.notFound((c) => c.text("Not found", 404));

app.onError((error, c) => {
  console.error(`[${new URL(c.req.url).pathname}] Unhandled error:`, error);
  return c.json({ error: String(error) }, 500);
});

export default app;

function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const { userId } = getAuth(c);

  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return next();
}

async function handleChat(c: Context<{ Bindings: Env }>): Promise<Response> {
  const { userId } = getAuth(c);
  const chatRequestBody = (await c.req.raw.json()) as ChatRequestBody;
  const env = c.env;
  const gateway = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });
  const model = gateway(toGatewayModelId(chatRequestBody.model));
  const messages = toModelMessages(chatRequestBody.messages ?? []);
  const composioContext = userId ? await getToolsForUser(env, userId) : undefined;
  const tools = composioContext?.tools as Parameters<typeof streamText>[0]["tools"] | undefined;
  const activeToolkits = composioContext?.activeToolkits ?? [];
  const hasAppTools = tools && Object.keys(tools).length > 0;
  const latestUserRequest = latestUserText(chatRequestBody.messages ?? []);
  const maxOutputTokens = hasAppTools
    ? Math.max(chatRequestBody.maxOutputTokens ?? 0, 4096)
    : chatRequestBody.maxOutputTokens;

  const result = streamText({
    model,
    system: withAgentInstructions(withPointerToolInstructions(chatRequestBody.system), {
      hasAppTools: Boolean(hasAppTools),
      activeToolkits,
      latestUserRequest,
    }),
    messages,
    maxOutputTokens,
    tools,
    stopWhen: stepCountIs(hasAppTools ? 40 : 20),
    experimental_onToolCallStart: ({ toolCall }) => {
      console.log(`[tool:start] ${toolCall.toolName}`);
    },
    experimental_onToolCallFinish: ({ toolCall, output, error }) => {
      if (error) {
        console.error(`[tool:error] ${toolCall.toolName}:`, error);
      } else {
        console.log(`[tool:finish] ${toolCall.toolName}`, summarizeForLog(output));
      }
    },
  });

  return result.toUIMessageStreamResponse();
}

async function handleToolkitStatus(c: Context<{ Bindings: Env }>): Promise<Response> {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const toolkit = toolkitParam(c);
  const composio = makeComposio(c.env);
  if (!composio) {
    return c.json({ toolkit, connected: false, configured: false });
  }

  const accounts = await composio.connectedAccounts.list({
    userIds: [userId],
    toolkitSlugs: [toolkit],
  });
  const connectedAccount = accounts.items.find((account) => account.toolkit.slug === toolkit);

  return c.json({
    toolkit,
    configured: true,
    connected: connectedAccount?.status === "ACTIVE",
    status: connectedAccount?.status ?? "NOT_CONNECTED",
    connectedAccountId: connectedAccount?.id,
  });
}

async function handleToolkitConnect(c: Context<{ Bindings: Env }>): Promise<Response> {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const toolkit = toolkitParam(c);
  const composio = makeComposio(c.env);
  if (!composio) {
    return c.json({ error: "COMPOSIO_API_KEY is not configured" }, 500);
  }

  const authConfigs = await composio.authConfigs.list({ toolkit });
  const authConfig = authConfigs.items[0] ?? await composio.authConfigs.create(toolkit);

  const connection = await composio.connectedAccounts.link(userId, authConfig.id, {
    callbackUrl: "glide://composio/callback",
  });

  return c.json({
    toolkit,
    redirectUrl: connection.redirectUrl,
    connectionRequestId: connection.id,
  });
}

async function handleToolkitDisconnect(c: Context<{ Bindings: Env }>): Promise<Response> {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const toolkit = toolkitParam(c);
  const composio = makeComposio(c.env);
  if (!composio) {
    return c.json({ error: "COMPOSIO_API_KEY is not configured" }, 500);
  }

  const accounts = await composio.connectedAccounts.list({
    userIds: [userId],
    toolkitSlugs: [toolkit],
  });
  const connectedAccounts = accounts.items.filter((account) => account.toolkit.slug === toolkit);

  await Promise.all(connectedAccounts.map((account) => composio.connectedAccounts.delete(account.id)));

  return c.json({
    toolkit,
    disconnected: true,
    deletedCount: connectedAccounts.length,
  });
}

async function getToolsForUser(env: Env, userId: string) {
  const composio = makeComposio(env);
  if (!composio) {
    return undefined;
  }

  const accounts = await composio.connectedAccounts.list({
    userIds: [userId],
  });
  const activeToolkits = Array.from(
    new Set(
      accounts.items
        .filter((account) => account.status === "ACTIVE")
        .map((account) => account.toolkit.slug)
    )
  );

  if (activeToolkits.length === 0) {
    return undefined;
  }

  const tools = await composio.tools.get(
    userId,
    {
      toolkits: activeToolkits,
      limit: 50,
    },
    {
      modifySchema: ({ schema }) => ({
        ...schema,
        description: addToolUseProtocol(schema.description),
      }),
      beforeExecute: ({ params, toolSlug, toolkitSlug }) => {
        console.log(`[composio:start] ${toolkitSlug}/${toolSlug}`, summarizeForLog(params.arguments));
        return params;
      },
      afterExecute: ({ result, toolSlug, toolkitSlug }) => {
        if (!result.successful) {
          console.error(`[composio:error] ${toolkitSlug}/${toolSlug}`, result.error ?? result);
        } else {
          console.log(`[composio:success] ${toolkitSlug}/${toolSlug}`, summarizeForLog(result.data));
        }

        return result;
      },
    }
  );

  return { tools, activeToolkits };
}

function normalizedToolkitSlug(toolkit: string): string {
  return toolkit.trim().toLowerCase();
}

function toolkitParam(c: Context<{ Bindings: Env }>): string {
  const toolkit = c.req.param("toolkit");
  if (!toolkit) {
    throw new Error("Missing toolkit");
  }

  return normalizedToolkitSlug(toolkit);
}

function makeComposio(env: Env) {
  if (!env.COMPOSIO_API_KEY) {
    return undefined;
  }

  return new Composio({
    apiKey: env.COMPOSIO_API_KEY,
    provider: new VercelProvider({ strict: true }),
  });
}

function toGatewayModelId(model: string | undefined): string {
  if (!model) {
    return "moonshotai/kimi-k2.6";
  }

  if (model.includes("/")) {
    return model;
  }

  return model;
}

function toModelMessages(chatMessages: ChatMessage[]): ModelMessage[] {
  return chatMessages.map((chatMessage): ModelMessage => {
    if (chatMessage.role === "user") {
      return {
        role: "user",
        content: toUserMessageContent(chatMessage.content),
      };
    }

    return {
      role: "assistant",
      content: toAssistantMessageContent(chatMessage.content),
    };
  });
}

function toUserMessageContent(content: string | ChatContentBlock[]): UserContent {
  if (typeof content === "string") {
    return content;
  }

  return content.map((contentBlock) => {
    if (contentBlock.type === "text") {
      return { type: "text", text: contentBlock.text };
    }

    return {
      type: "image",
      image: contentBlock.image,
      mediaType: contentBlock.mediaType,
    };
  });
}

function toAssistantMessageContent(content: string | ChatContentBlock[]): AssistantContent {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((contentBlock) => contentBlock.type === "text")
    .map((contentBlock) => ({ type: "text", text: contentBlock.text }));
}

function withPointerToolInstructions(system: string | undefined): string | undefined {
  const instructions = `

pointing tags:
- When pointing would help, write [POINT:x,y:label] directly in your response at the exact moment the cursor should point there.
- For navigation help, include one [POINT:...] tag for EACH separate UI target, in the order the user should look at them.
- Put the short spoken instruction for each target immediately after that target's tag. Example: [POINT:120,40:font] choose the font here. [POINT:220,40:size] then change the size here.
- Do not combine two targets into one tag. Do not stop after the first target when the user asked for more than one.
- If the element is on a different screen, append :screenN, like [POINT:400,300:terminal:screen2].
- If pointing would not help, do not include a point tag.
- Coordinates must use the screenshot pixel coordinate space: origin top-left, x rightward, y downward.
- Keep labels short because they appear next to the cursor.`;

  return system ? `${system}${instructions}` : instructions.trim();
}

function latestUserText(chatMessages: ChatMessage[]): string | undefined {
  const latestUserMessage = chatMessages.findLast((message) => message.role === "user");
  if (!latestUserMessage) {
    return undefined;
  }

  if (typeof latestUserMessage.content === "string") {
    return latestUserMessage.content.trim() || undefined;
  }

  return latestUserMessage.content
    .filter((block) => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n") || undefined;
}

function summarizeForLog(value: unknown): string {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
  } catch {
    return String(value);
  }
}

function addToolUseProtocol(description: string | undefined): string {
  const protocol = "Tool-use protocol: use exact user-provided values; do not invent external resource IDs/names; search/list/get first when required IDs or containers are missing; retry safely after recoverable errors; only report success when the tool result is successful.";
  return description ? `${description}\n\n${protocol}` : protocol;
}

function withAgentInstructions(
  system: string | undefined,
  context: { hasAppTools?: boolean; activeToolkits?: string[]; latestUserRequest?: string } = {}
): string {
  const activeToolkitsText = context.activeToolkits?.length ? context.activeToolkits.join(", ") : "none";
  const latestUserRequestText = context.latestUserRequest ? `\n- Current user request to execute exactly: ${context.latestUserRequest}` : "";
  const instructions = `

app integrations:
- ${context.hasAppTools ? `Connected app toolkits available: ${activeToolkitsText}.` : "No connected app tools are available in this conversation."}${latestUserRequestText}
- If app integration tools are available and the user asks to create, edit, search, send, or organize content in a connected app, use the matching tools immediately.
- For multi-step app tasks, keep calling tools until the requested task is actually complete; do not stop after only searching or opening context.
- Treat the user's latest message as the source of truth for the current app task. Do not reuse titles, recipients, project names, IDs, URLs, or other parameters from earlier turns unless the latest user request explicitly refers to them.
- Use the user's requested names/content/recipients/dates exactly. Do not substitute values from examples, screenshots, docs, or previous tool errors.
- Before creating, updating, sending, moving, or deleting in any external app, identify the required target/container/resource fields from the tool schema. If a required resource ID/container/account/channel/folder/calendar/database/page/repository/document is missing, use available search/list/get tools for that same toolkit to discover valid resources and prefer returned stable IDs/UUIDs over human-readable titles or names.
- Never invent parent folders, database names, channel names, recipient addresses, calendar IDs, repository names, file paths, document IDs, issue numbers, or other external resource identifiers. Search/list first; if you still cannot determine the required resource unambiguously, ask one concise clarification question.
- If a tool returns an error or says the action was not completed, do not claim success. Read the error, use another appropriate search/list/get tool to fix the missing/invalid parameter, and retry when safe. Only give up when no safe recovery is possible.
- If a tool returns multiple possible matches, choose only when one clearly matches the user's request; otherwise ask for clarification.
- For multi-step app tasks, continue until the final requested state is true, not merely until one tool has been called.
- After a successful app action, briefly confirm exactly what changed and where.
- If the needed app tools are not available, tell the user to connect that app from the Agents tab.`;

  return system ? `${system}${instructions}` : instructions.trim();
}

async function handleTranscribeToken(env: Env): Promise<Response> {
  const response = await fetch(
    "https://streaming.assemblyai.com/v3/token?expires_in_seconds=480",
    {
      method: "GET",
      headers: {
        authorization: env.ASSEMBLYAI_API_KEY,
      },
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[/transcribe-token] AssemblyAI token error ${response.status}: ${errorBody}`);
    return new Response(errorBody, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  }

  const data = await response.text();
  return new Response(data, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function handleTTS(request: Request, env: Env): Promise<Response> {
  const elevenLabsRequestBody = (await request.json()) as { text?: string };
  const textToSpeak = elevenLabsRequestBody.text?.trim();

  if (!textToSpeak) {
    return new Response(JSON.stringify({ error: "Missing text" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const geminiTTSModel = "gemini-3.1-flash-tts-preview";
  const geminiTTSVoice = "Kore";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiTTSModel}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": env.GEMINI_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Read this aloud naturally and conversationally. Speak only the transcript after TRANSCRIPT.\n\nTRANSCRIPT:\n${textToSpeak}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: geminiTTSVoice,
              },
            },
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[/tts] Gemini TTS API error ${response.status}: ${errorBody}`);
    return new Response(errorBody, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  }

  const geminiResponse = (await response.json()) as GeminiTTSResponse;
  const base64PCMAudio = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

  if (!base64PCMAudio) {
    console.error("[/tts] Gemini TTS response did not include inline audio data", geminiResponse);
    return new Response(JSON.stringify({ error: "Gemini TTS response did not include audio" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  const pcmAudio = base64ToUint8Array(base64PCMAudio);
  const wavAudio = pcm16MonoToWav(pcmAudio, 24000);

  return new Response(wavAudio.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "content-type": "audio/wav",
    },
  });
}

type GeminiTTSResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: {
          data?: string;
        };
      }>;
    };
  }>;
};

function base64ToUint8Array(base64Value: string): Uint8Array {
  const binaryString = atob(base64Value);
  const bytes = new Uint8Array(binaryString.length);

  for (let byteIndex = 0; byteIndex < binaryString.length; byteIndex += 1) {
    bytes[byteIndex] = binaryString.charCodeAt(byteIndex);
  }

  return bytes;
}

function pcm16MonoToWav(pcmAudio: Uint8Array, sampleRate: number): Uint8Array {
  const wavHeaderSize = 44;
  const wavAudio = new Uint8Array(wavHeaderSize + pcmAudio.length);
  const dataView = new DataView(wavAudio.buffer);
  const channelCount = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channelCount * bitsPerSample / 8;
  const blockAlign = channelCount * bitsPerSample / 8;

  writeAsciiString(dataView, 0, "RIFF");
  dataView.setUint32(4, 36 + pcmAudio.length, true);
  writeAsciiString(dataView, 8, "WAVE");
  writeAsciiString(dataView, 12, "fmt ");
  dataView.setUint32(16, 16, true);
  dataView.setUint16(20, 1, true);
  dataView.setUint16(22, channelCount, true);
  dataView.setUint32(24, sampleRate, true);
  dataView.setUint32(28, byteRate, true);
  dataView.setUint16(32, blockAlign, true);
  dataView.setUint16(34, bitsPerSample, true);
  writeAsciiString(dataView, 36, "data");
  dataView.setUint32(40, pcmAudio.length, true);
  wavAudio.set(pcmAudio, wavHeaderSize);

  return wavAudio;
}

function writeAsciiString(dataView: DataView, offset: number, value: string): void {
  for (let characterIndex = 0; characterIndex < value.length; characterIndex += 1) {
    dataView.setUint8(offset + characterIndex, value.charCodeAt(characterIndex));
  }
}

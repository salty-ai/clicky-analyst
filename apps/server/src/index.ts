import { clerkMiddleware, getAuth } from "@clerk/hono";
import { createGateway, streamText, type AssistantContent, type ModelMessage, type UserContent } from "ai";
import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";


interface Env {
  AI_GATEWAY_API_KEY: string;
  GEMINI_API_KEY: string;
  ASSEMBLYAI_API_KEY: string;
  CLERK_SECRET_KEY?: string;
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
    allowHeaders: ["Content-Type"],
    allowMethods: ["POST", "OPTIONS"],
  })
);

app.use("/chat", clerkMiddleware());
app.use("/tts", clerkMiddleware());
app.use("/transcribe-token", clerkMiddleware());

app.post("/chat", requireAuth, (c) => handleChat(c.req.raw, c.env));
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

async function handleChat(request: Request, env: Env): Promise<Response> {
  const chatRequestBody = (await request.json()) as ChatRequestBody;
  const gateway = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });
  const model = gateway(toGatewayModelId(chatRequestBody.model));
  const messages = toModelMessages(chatRequestBody.messages ?? []);
  const maxOutputTokens = chatRequestBody.maxOutputTokens;

  const result = streamText({
    model,
    system: withPointerToolInstructions(chatRequestBody.system),
    messages,
    maxOutputTokens,
  });

  return result.toUIMessageStreamResponse();
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

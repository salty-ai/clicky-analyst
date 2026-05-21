import { createGateway, stepCountIs, streamText, tool, type AssistantContent, type ModelMessage, type UserContent } from "ai";
import { z } from "zod";


interface Env {
  AI_GATEWAY_API_KEY: string;
  GEMINI_API_KEY: string;
  GEMINI_TTS_MODEL?: string;
  GEMINI_TTS_VOICE?: string;
  ASSEMBLYAI_API_KEY: string;
}

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: string;
        data: string;
      };
    };

type AnthropicRequestBody = {
  model?: string;
  max_tokens?: number;
  stream?: boolean;
  system?: string;
  messages?: AnthropicMessage[];
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    try {
      let response: Response;
      if (url.pathname === "/chat") {
        response = await handleChat(request, env);
      } else if (url.pathname === "/tts") {
        response = await handleTTS(request, env);
      } else if (url.pathname === "/transcribe-token") {
        response = await handleTranscribeToken(env);
      } else {
        return new Response("Not found", { status: 404, headers: corsHeaders });
      }

      // Append CORS headers to the response
      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        newHeaders.set(key, value);
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    } catch (error) {
      console.error(`[${url.pathname}] Unhandled error:`, error);
      return new Response(
        JSON.stringify({ error: String(error) }),
        { status: 500, headers: { "content-type": "application/json", ...corsHeaders } }
      );
    }
  },
};

async function handleChat(request: Request, env: Env): Promise<Response> {
  const anthropicRequestBody = (await request.json()) as AnthropicRequestBody;
  const gateway = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });
  const model = gateway(toGatewayModelId(anthropicRequestBody.model));
  const messages = toModelMessages(anthropicRequestBody.messages ?? []);
  const maxOutputTokens = anthropicRequestBody.max_tokens;

  const result = streamText({
    model,
    system: withPointerToolInstructions(anthropicRequestBody.system),
    messages,
    maxOutputTokens,
    tools: pointerTools,
    stopWhen: stepCountIs(8),
  });

  return new Response(toAnthropicSSEStream(result.fullStream), {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}

function toGatewayModelId(model: string | undefined): string {
  if (!model) {
    return "moonshotai/kimi-k2.6";
  }

  if (model.includes("/")) {
    return model;
  }

  return `anthropic/${model.replaceAll("-4-", "-4.").replaceAll("-3-", "-3.")}`;
}

function toModelMessages(anthropicMessages: AnthropicMessage[]): ModelMessage[] {
  return anthropicMessages.map((anthropicMessage): ModelMessage => {
    if (anthropicMessage.role === "user") {
      return {
        role: "user",
        content: toUserMessageContent(anthropicMessage.content),
      };
    }

    return {
      role: "assistant",
      content: toAssistantMessageContent(anthropicMessage.content),
    };
  });
}

function toUserMessageContent(content: string | AnthropicContentBlock[]): UserContent {
  if (typeof content === "string") {
    return content;
  }

  return content.map((contentBlock) => {
    if (contentBlock.type === "text") {
      return { type: "text", text: contentBlock.text };
    }

    return {
      type: "image",
      image: contentBlock.source.data,
      mediaType: contentBlock.source.media_type,
    };
  });
}

function toAssistantMessageContent(content: string | AnthropicContentBlock[]): AssistantContent {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((contentBlock) => contentBlock.type === "text")
    .map((contentBlock) => ({ type: "text", text: contentBlock.text }));
}

const pointerTools = {
  pointAt: tool({
    description:
      "Point Piksy's cursor at one visible UI element. Call once per element, in the order the user should look at them.",
    inputSchema: z.object({
      x: z.number().int().describe("X coordinate in screenshot pixels from the image's left edge."),
      y: z.number().int().describe("Y coordinate in screenshot pixels from the image's top edge."),
      label: z.string().describe("Short 1-3 word description to show by the cursor."),
      description: z.string().describe("One short sentence to speak with TTS while the cursor points here."),
      screen: z.number().int().optional().describe("Screen number from the image label when pointing at a non-cursor screen."),
    }),
    execute: async ({ label, description }) => ({ ok: true, pointedAt: label, spokenDescription: description }),
  }),
};

function withPointerToolInstructions(system: string | undefined): string | undefined {
  const instructions = `

pointer tool:
- Use the pointAt tool instead of writing [POINT:...] tags yourself.
- For navigation help, call pointAt once for EACH separate UI target.
- Put the short spoken instruction for that target in the tool's description field. That description is used for TTS while the cursor points there.
- If the user asks for multiple things, you MUST call pointAt multiple times in sequence. Example for "change font and font size": call pointAt for "font" with a description about changing font, then call pointAt for "font size" with a description about changing size.
- Do not combine two targets into one tool call. Do not stop after the first target when the user asked for more than one.
- After tool calls, you may add a final short response or summary. It will also be spoken with TTS.
- The tool input coordinates must use the screenshot pixel coordinate space: origin top-left, x rightward, y downward.
- Keep label short because it appears next to the cursor.`;

  return system ? `${system}${instructions}` : instructions.trim();
}

function toAnthropicSSEStream(fullStream: AsyncIterable<any>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  const enqueueText = (controller: ReadableStreamDefaultController<Uint8Array>, text: string) => {
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({
          type: "content_block_delta",
          delta: { type: "text_delta", text },
        })}\n\n`
      )
    );
  };

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const part of fullStream) {
          if (part.type === "text-delta") {
            enqueueText(controller, part.text);
          }

          if (part.type === "tool-call" && part.toolName === "pointAt") {
            const input = part.input as { x: number; y: number; label?: string; description?: string; screen?: number };
            const label = input.label ? `:${input.label.replace(/[\]:]/g, " ").trim()}` : "";
            const screen = input.screen ? `:screen${input.screen}` : "";
            const description = input.description?.trim() ? ` ${input.description.trim()} ` : " ";
            enqueueText(controller, ` [POINT:${Math.round(input.x)},${Math.round(input.y)}${label}${screen}]${description}`);
          }
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        console.error("[/chat] AI Gateway stream error:", error);
        controller.error(error);
      }
    },
  });
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

  const geminiTTSModel = env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview";
  const geminiTTSVoice = env.GEMINI_TTS_VOICE || "Kore";
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

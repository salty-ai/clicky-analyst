import type { Env } from "../types";
import { base64ToUint8Array, pcm16MonoToWav } from "../utils/audio";

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

export async function handleTTS(request: Request, env: Env): Promise<Response> {
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

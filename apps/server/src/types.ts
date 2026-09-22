export interface Env {
  APP_AUTH_SECRET: string;
  AI: Ai;
  GRADIUM_API_KEY?: string;
  GRADIUM_TTS_VOICE_ID?: string;
  GRADIUM_TTS_MODEL?: string;
  ASSEMBLYAI_API_KEY?: string;
  COMPOSIO_API_KEY?: string;
  JEV_API_KEY?: string;
  TYPESAFE_API_KEY?: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: {
    userId: string;
  };
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string | ChatContentBlock[];
};

export type ChatContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      image: string;
      mediaType: string;
    };

export type ChatRequestBody = {
  model?: string;
  maxOutputTokens?: number;
  system?: string;
  messages?: ChatMessage[];
};

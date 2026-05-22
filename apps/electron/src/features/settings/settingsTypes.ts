export type GlideVoiceState = "idle" | "listening" | "processing" | "responding";

export type GlideSettings = {
  serverUrl: string;
  selectedModel: string;
  shortcut: string;
  hasCompletedOnboarding: boolean;
  isGlideCursorEnabled: boolean;
};

export const DEFAULT_SETTINGS: GlideSettings = {
  serverUrl: "http://localhost:8787",
  selectedModel: "openai/gpt-5.4-mini",
  shortcut: "control + option",
  hasCompletedOnboarding: false,
  isGlideCursorEnabled: true
};

export function normalizeSettings(input: Partial<GlideSettings> | null | undefined): GlideSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(input ?? {})
  };
}

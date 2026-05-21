export type PiksyVoiceState = "idle" | "listening" | "processing" | "responding";

export type PiksySettings = {
  serverUrl: string;
  selectedModel: string;
  shortcut: string;
  hasCompletedOnboarding: boolean;
  isPiksyCursorEnabled: boolean;
};

export const DEFAULT_SETTINGS: PiksySettings = {
  serverUrl: "http://localhost:8787",
  selectedModel: "openai/gpt-5.4-mini",
  shortcut: "control + option",
  hasCompletedOnboarding: false,
  isPiksyCursorEnabled: true
};

export function normalizeSettings(input: Partial<PiksySettings> | null | undefined): PiksySettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(input ?? {})
  };
}

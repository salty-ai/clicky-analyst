import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settingsTypes";

describe("settings defaults", () => {
  it("uses the migration plan defaults", () => {
    expect(DEFAULT_SETTINGS.serverUrl).toBe("http://localhost:8787");
    expect(DEFAULT_SETTINGS.selectedModel).toBe("openai/gpt-5.4-mini");
    expect(DEFAULT_SETTINGS.shortcut).toBe("control + option");
  });

  it("normalizes partial settings", () => {
    expect(normalizeSettings({ hasCompletedOnboarding: true })).toMatchObject({
      hasCompletedOnboarding: true,
      selectedModel: DEFAULT_SETTINGS.selectedModel
    });
  });
});

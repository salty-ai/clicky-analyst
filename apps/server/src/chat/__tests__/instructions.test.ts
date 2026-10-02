import { describe, expect, it } from "vitest";
import {
  appToolkitsMentionedInRequest,
  shouldUseAppIntegrationTools,
  withAgentInstructions,
  withAnalystInstructions,
} from "../instructions";

describe("shouldUseAppIntegrationTools", () => {
  it("returns true for explicit app actions", () => {
    expect(shouldUseAppIntegrationTools("create a notion page")).toBe(true);
  });

  it("returns false for screen-pointing questions", () => {
    expect(shouldUseAppIntegrationTools("where do i click")).toBe(false);
  });

  it("returns true for empty requests to match historical default", () => {
    expect(shouldUseAppIntegrationTools(undefined)).toBe(true);
  });
});

describe("appToolkitsMentionedInRequest", () => {
  it("detects notion", () => {
    expect(appToolkitsMentionedInRequest("open notion")).toContain("notion");
  });

  it("detects multiple toolkits", () => {
    const toolkits = appToolkitsMentionedInRequest("check google sheets and google docs");
    expect(toolkits).toContain("googlesheets");
    expect(toolkits).toContain("googledocs");
  });
});

describe("withAnalystInstructions", () => {
  it("appends analyst instructions when system is present", () => {
    const result = withAnalystInstructions("base", { verbosity: "deep" });
    expect(result).toContain("base");
    expect(result).toContain("direct answer first");
    expect(result).toContain("multi-angle analysis");
  });

  it("returns trimmed instructions when system is absent", () => {
    const result = withAnalystInstructions(undefined, { verbosity: "brief" });
    expect(result).toContain("analyst mode");
    expect(result).not.toMatch(/^\s/);
    expect(result).toContain("Keep the answer concise.");
  });

  it("adjusts tone by verbosity", () => {
    expect(withAnalystInstructions("", { verbosity: "normal" })).toContain(
      "Provide a balanced amount of detail."
    );
  });
});

describe("withAgentInstructions", () => {
  it("mentions available toolkits", () => {
    const result = withAgentInstructions("base", {
      hasAppTools: true,
      activeToolkits: ["notion"],
    });
    expect(result).toContain("Connected app toolkits available: notion.");
  });

  it("notes when no tools are available", () => {
    const result = withAgentInstructions("base", { hasAppTools: false });
    expect(result).toContain("No connected app tools are available");
  });
});

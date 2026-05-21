import { describe, expect, it } from "vitest";
import { applyAssemblyTurnMessage, createAssemblyStreamState } from "./assemblyAiStreaming";

describe("AssemblyAI stream parsing", () => {
  it("merges finalized and live turns in order", () => {
    const state = createAssemblyStreamState();
    expect(applyAssemblyTurnMessage(state, { type: "Turn", transcript: " hello ", turn_order: 1, end_of_turn: true })).toBe("hello");
    expect(applyAssemblyTurnMessage(state, { type: "Turn", transcript: "world", turn_order: 2, end_of_turn: false })).toBe("hello world");
  });

  it("keeps formatted final turns over later unformatted finals", () => {
    const state = createAssemblyStreamState();
    expect(applyAssemblyTurnMessage(state, { type: "Turn", transcript: "hello there", turn_order: 1, turn_is_formatted: true })).toBe("hello there");
    expect(applyAssemblyTurnMessage(state, { type: "Turn", transcript: "hello their", turn_order: 1, end_of_turn: true })).toBe("hello there");
  });
});

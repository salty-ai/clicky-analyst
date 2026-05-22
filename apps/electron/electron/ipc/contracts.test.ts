import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "./contracts";

describe("IPC contracts", () => {
  it("exposes the required glide bridge domains", () => {
    expect(Object.values(IPC_CHANNELS)).toEqual(
      expect.arrayContaining([
        "glide:permissions:get-snapshot",
        "glide:dictation:start",
        "glide:companion:send-prompt",
        "glide:overlay:point-at",
        "glide:settings:get",
        "glide:analytics:track",
        "glide:app:quit"
      ])
    );
  });
});

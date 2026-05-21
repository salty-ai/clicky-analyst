import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "./contracts";

describe("IPC contracts", () => {
  it("exposes the required piksy bridge domains", () => {
    expect(Object.values(IPC_CHANNELS)).toEqual(
      expect.arrayContaining([
        "piksy:permissions:get-snapshot",
        "piksy:dictation:start",
        "piksy:companion:send-prompt",
        "piksy:overlay:point-at",
        "piksy:settings:get",
        "piksy:analytics:track",
        "piksy:app:quit"
      ])
    );
  });
});

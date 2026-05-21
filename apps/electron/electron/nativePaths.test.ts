import { describe, expect, it } from "vitest";
import { getNativeArchTag } from "./nativePaths";

describe("native helper path resolution", () => {
  it("uses Recordly-style platform arch tags", () => {
    expect(getNativeArchTag("darwin", "arm64")).toBe("darwin-arm64");
    expect(getNativeArchTag("darwin", "x64")).toBe("darwin-x64");
    expect(getNativeArchTag("win32", "x64")).toBe("win32-x64");
  });
});

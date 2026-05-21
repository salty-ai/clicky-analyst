import { describe, expect, it } from "vitest";
import { areAllPermissionsGranted, normalizePermissionStatus } from "./permissionTypes";

describe("permission normalization", () => {
  it("accepts booleans and known platform status strings", () => {
    expect(normalizePermissionStatus(true)).toBe("granted");
    expect(normalizePermissionStatus(false)).toBe("denied");
    expect(normalizePermissionStatus("prompt")).toBe("prompt");
    expect(normalizePermissionStatus("future-status")).toBe("unknown");
  });

  it("checks all required permissions", () => {
    expect(
      areAllPermissionsGranted({
        microphone: "granted",
        accessibility: "granted",
        screenRecording: "granted",
        screenContent: "granted"
      })
    ).toBe(true);
  });
});

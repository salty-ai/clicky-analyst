import { describe, expect, it } from "vitest";
import { buddyPointNearCursor, buddyPointNearTarget, clampOverlayPoint, screenPointToOverlayPoint } from "./overlayMath";

describe("overlayMath", () => {
  it("converts macOS screen coordinates into overlay coordinates", () => {
    expect(screenPointToOverlayPoint({ x: 110, y: 350 }, { x: 100, y: 100, width: 500, height: 300 })).toEqual({
      x: 10,
      y: 50
    });
  });

  it("applies Swift cursor and target offsets", () => {
    expect(buddyPointNearCursor({ x: 10, y: 20 })).toEqual({ x: 45, y: 45 });
    expect(buddyPointNearTarget({ x: 10, y: 20 })).toEqual({ x: 3, y: 18 });
  });

  it("clamps points within overlay bounds", () => {
    expect(clampOverlayPoint({ x: -10, y: 400 }, { x: 0, y: 0, width: 300, height: 200 })).toEqual({ x: 20, y: 180 });
  });
});

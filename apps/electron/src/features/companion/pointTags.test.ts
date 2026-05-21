import { describe, expect, it } from "vitest";
import { parsePointTags, stripPointTags } from "./pointTags";

describe("pointTags", () => {
  it("parses point tags with screen indexes", () => {
    expect(parsePointTags("Click [POINT:120,240:Save button:screen1] now")).toEqual([
      { x: 120, y: 240, label: "Save button", screenIndex: 0, raw: "[POINT:120,240:Save button:screen1]" }
    ]);
  });

  it("strips point tags from visible text", () => {
    expect(stripPointTags("Use this [POINT:1,2:thing:screen0] please")).toBe("Use this please");
  });

  it("supports Swift-style point tags without an explicit screen", () => {
    expect(parsePointTags("There [POINT:10,20:button]")).toEqual([
      { x: 10, y: 20, label: "button", screenIndex: 0, raw: "[POINT:10,20:button]" }
    ]);
    expect(stripPointTags("Nothing to point at [POINT:none]")).toBe("Nothing to point at");
  });
});

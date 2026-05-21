export type PointTag = {
  x: number;
  y: number;
  label: string;
  screenIndex: number;
  raw: string;
};

const POINT_TAG_PATTERN = /\[POINT\s*:\s*(?:none|(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*:\s*([^:\]]+?))?(?:\s*:\s*screen(\d+))?)\s*\]/gi;

export function parsePointTags(text: string): PointTag[] {
  return Array.from(text.matchAll(POINT_TAG_PATTERN), (match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
    label: match[3]?.trim() ?? "",
    screenIndex: match[4] ? Math.max(0, Number(match[4]) - 1) : 0,
    raw: match[0]
  })).filter((tag) => Number.isFinite(tag.x) && Number.isFinite(tag.y) && tag.raw.toLowerCase() !== "[point:none]");
}

export function stripPointTags(text: string): string {
  return text.replace(POINT_TAG_PATTERN, "").replace(/\s{2,}/g, " ").trim();
}

import type { ScreenFrame, ScreenPoint } from "./overlayTypes";

export function screenPointToOverlayPoint(screenPoint: ScreenPoint, screenFrame: ScreenFrame): ScreenPoint {
  return {
    x: screenPoint.x - screenFrame.x,
    y: screenFrame.y + screenFrame.height - screenPoint.y
  };
}

export function clampOverlayPoint(point: ScreenPoint, frame: ScreenFrame, margin = 20): ScreenPoint {
  return {
    x: Math.max(margin, Math.min(point.x, frame.width - margin)),
    y: Math.max(margin, Math.min(point.y, frame.height - margin))
  };
}

export function buddyPointNearCursor(point: ScreenPoint): ScreenPoint {
  return {
    x: point.x + 35,
    y: point.y + 25
  };
}

export function buddyPointNearTarget(point: ScreenPoint): ScreenPoint {
  return {
    x: point.x - 7,
    y: point.y - 2
  };
}

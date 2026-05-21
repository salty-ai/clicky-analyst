export type ScreenFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScreenPoint = {
  x: number;
  y: number;
};

export type OverlayPointTarget = ScreenPoint & {
  label: string;
  screenIndex: number;
};

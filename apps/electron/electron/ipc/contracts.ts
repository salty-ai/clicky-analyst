import type { PermissionKey, PermissionSnapshot } from "../../src/features/permissions/permissionTypes";
import type { PiksySettings } from "../../src/features/settings/settingsTypes";

export const IPC_CHANNELS = {
  permissionsGetSnapshot: "piksy:permissions:get-snapshot",
  permissionsRequest: "piksy:permissions:request",
  permissionsOpenSettings: "piksy:permissions:open-settings",
  settingsGet: "piksy:settings:get",
  settingsSet: "piksy:settings:set",
  dictationStart: "piksy:dictation:start",
  dictationStop: "piksy:dictation:stop",
  dictationTranscript: "piksy:dictation:transcript",
  voiceStateChanged: "piksy:voice-state:changed",
  companionSendPrompt: "piksy:companion:send-prompt",
  companionCaptureScreens: "piksy:companion:capture-screens",
  overlayShow: "piksy:overlay:show",
  overlayHide: "piksy:overlay:hide",
  overlayPointAt: "piksy:overlay:point-at",
  overlayPointChanged: "piksy:overlay:point-changed",
  overlayCursorPosition: "piksy:overlay:cursor-position",
  overlayCursorPositionChanged: "piksy:overlay:cursor-position-changed",
  analyticsTrack: "piksy:analytics:track",
  appSetVoiceState: "piksy:app:set-voice-state",
  appDismissPanel: "piksy:app:dismiss-panel",
  appQuit: "piksy:app:quit"
} as const;

export type PiksyIpcSuccess<T = void> = { success: true; data?: T };
export type PiksyIpcFailure = { success: false; error: string };
export type PiksyIpcResult<T = void> = PiksyIpcSuccess<T> | PiksyIpcFailure;

export type PermissionRequestPayload = PermissionKey;
export type SettingsSetPayload = Partial<PiksySettings>;
export type PointAtPayload = { x: number; y: number; label: string; screenIndex: number };
export type CursorPositionPayload = { x: number; y: number; isOnScreen: boolean };
export type CompanionResponsePayload = {
  text: string;
  spokenText: string;
  pointingSequence: Array<{ point: PointAtPayload; speech: string }>;
};
export type NativeScreenshotPayload = {
  screenIndex: number;
  displayId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  isCursorScreen?: boolean;
  screenshotWidthInPixels?: number;
  screenshotHeightInPixels?: number;
  mediaType: string;
  data: string;
};

export type IpcContractMap = {
  [IPC_CHANNELS.permissionsGetSnapshot]: { response: PermissionSnapshot };
  [IPC_CHANNELS.permissionsRequest]: { payload: PermissionRequestPayload; response: PiksyIpcResult<PermissionSnapshot> };
  [IPC_CHANNELS.permissionsOpenSettings]: { payload: PermissionRequestPayload; response: PiksyIpcResult };
  [IPC_CHANNELS.settingsGet]: { response: PiksySettings };
  [IPC_CHANNELS.settingsSet]: { payload: SettingsSetPayload; response: PiksyIpcResult<PiksySettings> };
  [IPC_CHANNELS.companionCaptureScreens]: { response: PiksyIpcResult<NativeScreenshotPayload[]> };
  [IPC_CHANNELS.overlayPointAt]: { payload: PointAtPayload; response: PiksyIpcResult };
  [IPC_CHANNELS.overlayCursorPosition]: { response: CursorPositionPayload };
};

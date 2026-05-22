import type { PermissionKey, PermissionSnapshot } from "../../src/features/permissions/permissionTypes";
import type { GlideSettings } from "../../src/features/settings/settingsTypes";

export const IPC_CHANNELS = {
  permissionsGetSnapshot: "glide:permissions:get-snapshot",
  permissionsRequest: "glide:permissions:request",
  permissionsOpenSettings: "glide:permissions:open-settings",
  settingsGet: "glide:settings:get",
  settingsSet: "glide:settings:set",
  dictationStart: "glide:dictation:start",
  dictationStop: "glide:dictation:stop",
  dictationTranscript: "glide:dictation:transcript",
  voiceStateChanged: "glide:voice-state:changed",
  companionSendPrompt: "glide:companion:send-prompt",
  companionCaptureScreens: "glide:companion:capture-screens",
  overlayShow: "glide:overlay:show",
  overlayHide: "glide:overlay:hide",
  overlayPointAt: "glide:overlay:point-at",
  overlayPointChanged: "glide:overlay:point-changed",
  overlayCursorPosition: "glide:overlay:cursor-position",
  overlayCursorPositionChanged: "glide:overlay:cursor-position-changed",
  analyticsTrack: "glide:analytics:track",
  appSetVoiceState: "glide:app:set-voice-state",
  appDismissPanel: "glide:app:dismiss-panel",
  appQuit: "glide:app:quit",
  notchSetIgnoreMouse: "glide:notch:set-ignore-mouse",
  notchStatus: "glide:notch:status",
  notchHaptic: "glide:notch:haptic"
} as const;

export type GlideIpcSuccess<T = void> = { success: true; data?: T };
export type GlideIpcFailure = { success: false; error: string };
export type GlideIpcResult<T = void> = GlideIpcSuccess<T> | GlideIpcFailure;

export type PermissionRequestPayload = PermissionKey;
export type SettingsSetPayload = Partial<GlideSettings>;
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
  [IPC_CHANNELS.permissionsRequest]: { payload: PermissionRequestPayload; response: GlideIpcResult<PermissionSnapshot> };
  [IPC_CHANNELS.permissionsOpenSettings]: { payload: PermissionRequestPayload; response: GlideIpcResult };
  [IPC_CHANNELS.settingsGet]: { response: GlideSettings };
  [IPC_CHANNELS.settingsSet]: { payload: SettingsSetPayload; response: GlideIpcResult<GlideSettings> };
  [IPC_CHANNELS.companionCaptureScreens]: { response: GlideIpcResult<NativeScreenshotPayload[]> };
  [IPC_CHANNELS.overlayPointAt]: { payload: PointAtPayload; response: GlideIpcResult };
  [IPC_CHANNELS.overlayCursorPosition]: { response: CursorPositionPayload };
};

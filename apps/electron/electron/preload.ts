import type { PointAtPayload, SettingsSetPayload } from "./ipc/contracts";
import type { PermissionKey } from "../src/features/permissions/permissionTypes";
import type { PiksyVoiceState } from "../src/features/settings/settingsTypes";

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");
const IPC_CHANNELS = {
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
  appQuit: "piksy:app:quit",
  notchSetIgnoreMouse: "piksy:notch:set-ignore-mouse",
  notchStatus: "piksy:notch:status"
} as const;

contextBridge.exposeInMainWorld("piksy", {
  permissions: {
    getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.permissionsGetSnapshot),
    request: (key: PermissionKey) => ipcRenderer.invoke(IPC_CHANNELS.permissionsRequest, key),
    openSettings: (key: PermissionKey) => ipcRenderer.invoke(IPC_CHANNELS.permissionsOpenSettings, key)
  },
  dictation: {
    start: () => ipcRenderer.invoke(IPC_CHANNELS.dictationStart),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.dictationStop),
    onTranscript: (callback: (transcript: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, transcript: string) => callback(transcript);
      ipcRenderer.on(IPC_CHANNELS.dictationTranscript, listener);
      return () => ipcRenderer.off(IPC_CHANNELS.dictationTranscript, listener);
    }
  },
  companion: {
    sendPrompt: (prompt: string) => ipcRenderer.invoke(IPC_CHANNELS.companionSendPrompt, prompt),
    captureScreens: () => ipcRenderer.invoke(IPC_CHANNELS.companionCaptureScreens)
  },
  overlay: {
    show: () => ipcRenderer.invoke(IPC_CHANNELS.overlayShow),
    hide: () => ipcRenderer.invoke(IPC_CHANNELS.overlayHide),
    pointAt: (target: PointAtPayload) => ipcRenderer.invoke(IPC_CHANNELS.overlayPointAt, target),
    cursorPosition: () => ipcRenderer.invoke(IPC_CHANNELS.overlayCursorPosition),
    onPointChanged: (callback: (target: PointAtPayload) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, target: PointAtPayload) => callback(target);
      ipcRenderer.on(IPC_CHANNELS.overlayPointChanged, listener);
      return () => ipcRenderer.off(IPC_CHANNELS.overlayPointChanged, listener);
    },
    onCursorPositionChanged: (callback: (point: { x: number; y: number; isOnScreen: boolean }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, point: { x: number; y: number; isOnScreen: boolean }) => callback(point);
      ipcRenderer.on(IPC_CHANNELS.overlayCursorPositionChanged, listener);
      return () => ipcRenderer.off(IPC_CHANNELS.overlayCursorPositionChanged, listener);
    }
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    set: (settings: SettingsSetPayload) => ipcRenderer.invoke(IPC_CHANNELS.settingsSet, settings)
  },
  analytics: {
    track: (name: string, properties?: Record<string, unknown>) => ipcRenderer.send(IPC_CHANNELS.analyticsTrack, name, properties)
  },
  app: {
    setVoiceState: (voiceState: PiksyVoiceState) => ipcRenderer.send(IPC_CHANNELS.appSetVoiceState, voiceState),
    dismissPanel: () => ipcRenderer.send(IPC_CHANNELS.appDismissPanel),
    quit: () => ipcRenderer.send(IPC_CHANNELS.appQuit),
    platform: process.platform,
    onVoiceStateChanged: (callback: (voiceState: PiksyVoiceState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, voiceState: PiksyVoiceState) => callback(voiceState);
      ipcRenderer.on(IPC_CHANNELS.voiceStateChanged, listener);
      return () => ipcRenderer.off(IPC_CHANNELS.voiceStateChanged, listener);
    }
  },
  notch: {
    setIgnoreMouse: (ignore: boolean) => ipcRenderer.send(IPC_CHANNELS.notchSetIgnoreMouse, ignore),
    onStatus: (callback: (status: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: string) => callback(status);
      ipcRenderer.on(IPC_CHANNELS.notchStatus, listener);
      return () => ipcRenderer.off(IPC_CHANNELS.notchStatus, listener);
    }
  }
});

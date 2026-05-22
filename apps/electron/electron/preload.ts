import type { PointAtPayload, SettingsSetPayload } from "./ipc/contracts";
import type { PermissionKey } from "../src/features/permissions/permissionTypes";
import type { GlideVoiceState } from "../src/features/settings/settingsTypes";

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");
const IPC_CHANNELS = {
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

contextBridge.exposeInMainWorld("glide", {
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
    setVoiceState: (voiceState: GlideVoiceState) => ipcRenderer.send(IPC_CHANNELS.appSetVoiceState, voiceState),
    dismissPanel: () => ipcRenderer.send(IPC_CHANNELS.appDismissPanel),
    quit: () => ipcRenderer.send(IPC_CHANNELS.appQuit),
    platform: process.platform,
    onVoiceStateChanged: (callback: (voiceState: GlideVoiceState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, voiceState: GlideVoiceState) => callback(voiceState);
      ipcRenderer.on(IPC_CHANNELS.voiceStateChanged, listener);
      return () => ipcRenderer.off(IPC_CHANNELS.voiceStateChanged, listener);
    }
  },
  notch: {
    setIgnoreMouse: (ignore: boolean) => ipcRenderer.send(IPC_CHANNELS.notchSetIgnoreMouse, ignore),
    haptic: () => ipcRenderer.send(IPC_CHANNELS.notchHaptic),
    onStatus: (callback: (status: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: string) => callback(status);
      ipcRenderer.on(IPC_CHANNELS.notchStatus, listener);
      return () => ipcRenderer.off(IPC_CHANNELS.notchStatus, listener);
    }
  }
});

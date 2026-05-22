import { DEFAULT_PERMISSION_SNAPSHOT } from "./features/permissions/permissionTypes";
import { DEFAULT_SETTINGS } from "./features/settings/settingsTypes";

export const isElectronBridgeAvailable = Boolean(window.glide);

export const glideBridge = window.glide ?? {
  permissions: {
    getSnapshot: async () => DEFAULT_PERMISSION_SNAPSHOT,
    request: async () => ({ success: true, data: DEFAULT_PERMISSION_SNAPSHOT }),
    openSettings: async () => ({ success: true })
  },
  dictation: {
    start: async () => ({ success: true }),
    stop: async () => ({ success: true, data: { transcript: "" } }),
    onTranscript: () => () => undefined
  },
  companion: {
    sendPrompt: async (prompt: string) => ({ success: true, data: { text: prompt, spokenText: prompt, pointingSequence: [] } }),
    captureScreens: async () => ({ success: true, data: [] })
  },
  overlay: {
    show: async () => ({ success: true }),
    hide: async () => ({ success: true }),
    pointAt: async () => ({ success: true }),
    cursorPosition: async () => ({ x: 120, y: 120, isOnScreen: true }),
    onPointChanged: () => () => undefined,
    onCursorPositionChanged: () => () => undefined
  },
  settings: {
    get: async () => DEFAULT_SETTINGS,
    set: async (settings) => ({ success: true, data: { ...DEFAULT_SETTINGS, ...settings } })
  },
  analytics: {
    track: () => undefined
  },
  app: {
    setVoiceState: () => undefined,
    dismissPanel: () => undefined,
    quit: () => undefined,
    platform: "darwin" as const,
    onVoiceStateChanged: () => () => undefined
  },
  notch: {
    setIgnoreMouse: () => undefined,
    haptic: () => undefined,
    onStatus: () => () => undefined
  }
} satisfies Window["glide"];

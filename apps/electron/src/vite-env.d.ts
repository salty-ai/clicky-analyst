/// <reference types="vite/client" />

import type { PermissionKey, PermissionSnapshot } from "./features/permissions/permissionTypes";
import type { PiksySettings, PiksyVoiceState } from "./features/settings/settingsTypes";

type PiksyInvokeResult<T = void> = Promise<{ success: boolean; data?: T; error?: string }>;

declare global {
  interface Window {
    piksy: {
      permissions: {
        getSnapshot: () => Promise<PermissionSnapshot>;
        request: (key: PermissionKey) => PiksyInvokeResult<PermissionSnapshot>;
        openSettings: (key: PermissionKey) => PiksyInvokeResult;
      };
      dictation: {
        start: () => PiksyInvokeResult;
        stop: () => PiksyInvokeResult<{ transcript: string }>;
        onTranscript: (callback: (transcript: string) => void) => () => void;
      };
      companion: {
        sendPrompt: (prompt: string) => PiksyInvokeResult<{
          text: string;
          spokenText: string;
          pointingSequence: Array<{ point: { x: number; y: number; label: string; screenIndex: number }; speech: string }>;
        }>;
        captureScreens: () => PiksyInvokeResult<
          Array<{
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
          }>
        >;
      };
      overlay: {
        show: () => PiksyInvokeResult;
        hide: () => PiksyInvokeResult;
        pointAt: (target: { x: number; y: number; label: string; screenIndex: number }) => PiksyInvokeResult;
        cursorPosition: () => Promise<{ x: number; y: number; isOnScreen: boolean }>;
        onPointChanged: (callback: (target: { x: number; y: number; label: string; screenIndex: number }) => void) => () => void;
        onCursorPositionChanged: (callback: (point: { x: number; y: number; isOnScreen: boolean }) => void) => () => void;
      };
      settings: {
        get: () => Promise<PiksySettings>;
        set: (settings: Partial<PiksySettings>) => PiksyInvokeResult<PiksySettings>;
      };
      analytics: {
        track: (name: string, properties?: Record<string, unknown>) => void;
      };
      app: {
        setVoiceState: (voiceState: PiksyVoiceState) => void;
        dismissPanel: () => void;
        quit: () => void;
        platform: NodeJS.Platform;
        onVoiceStateChanged: (callback: (voiceState: PiksyVoiceState) => void) => () => void;
      };
      notch: {
        setIgnoreMouse: (ignore: boolean) => void;
        onStatus: (callback: (status: string) => void) => () => void;
      };
    };
  }
}

export {};

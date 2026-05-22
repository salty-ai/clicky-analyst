/// <reference types="vite/client" />

import type { PermissionKey, PermissionSnapshot } from "./features/permissions/permissionTypes";
import type { GlideSettings, GlideVoiceState } from "./features/settings/settingsTypes";

type GlideInvokeResult<T = void> = Promise<{ success: boolean; data?: T; error?: string }>;

declare global {
  interface Window {
    glide: {
      permissions: {
        getSnapshot: () => Promise<PermissionSnapshot>;
        request: (key: PermissionKey) => GlideInvokeResult<PermissionSnapshot>;
        openSettings: (key: PermissionKey) => GlideInvokeResult;
      };
      dictation: {
        start: () => GlideInvokeResult;
        stop: () => GlideInvokeResult<{ transcript: string }>;
        onTranscript: (callback: (transcript: string) => void) => () => void;
      };
      companion: {
        sendPrompt: (prompt: string) => GlideInvokeResult<{
          text: string;
          spokenText: string;
          pointingSequence: Array<{ point: { x: number; y: number; label: string; screenIndex: number }; speech: string }>;
        }>;
        captureScreens: () => GlideInvokeResult<
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
        show: () => GlideInvokeResult;
        hide: () => GlideInvokeResult;
        pointAt: (target: { x: number; y: number; label: string; screenIndex: number }) => GlideInvokeResult;
        cursorPosition: () => Promise<{ x: number; y: number; isOnScreen: boolean }>;
        onPointChanged: (callback: (target: { x: number; y: number; label: string; screenIndex: number }) => void) => () => void;
        onCursorPositionChanged: (callback: (point: { x: number; y: number; isOnScreen: boolean }) => void) => () => void;
      };
      settings: {
        get: () => Promise<GlideSettings>;
        set: (settings: Partial<GlideSettings>) => GlideInvokeResult<GlideSettings>;
      };
      analytics: {
        track: (name: string, properties?: Record<string, unknown>) => void;
      };
      app: {
        setVoiceState: (voiceState: GlideVoiceState) => void;
        dismissPanel: () => void;
        quit: () => void;
        platform: NodeJS.Platform;
        onVoiceStateChanged: (callback: (voiceState: GlideVoiceState) => void) => () => void;
      };
      notch: {
        setIgnoreMouse: (ignore: boolean) => void;
        haptic: () => void;
        onStatus: (callback: (status: string) => void) => () => void;
      };
    };
  }
}

export {};

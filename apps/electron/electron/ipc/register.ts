import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { DEFAULT_PERMISSION_SNAPSHOT, normalizePermissionStatus, type PermissionKey, type PermissionSnapshot } from "../../src/features/permissions/permissionTypes";
import { DEFAULT_SETTINGS, normalizeSettings, type PiksySettings } from "../../src/features/settings/settingsTypes";
import { captureNativeScreenshots, getNativePermissionSnapshot, requestNativePermission } from "../nativeBridge";
import { hideOverlay, hidePanel, sendOverlayPoint, sendVoiceState, showOverlay } from "../windows";
import { IPC_CHANNELS, type CompanionResponsePayload, type NativeScreenshotPayload, type PointAtPayload, type SettingsSetPayload } from "./contracts";

const require = createRequire(import.meta.url);
const electron = require("electron") as typeof import("electron");
const { app, BrowserWindow, ipcMain, shell } = electron;
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

let cachedSettings: PiksySettings = DEFAULT_SETTINGS;
let cachedPermissions: PermissionSnapshot = DEFAULT_PERMISSION_SNAPSHOT;
const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

function getScreen(): Electron.Screen {
  return electron.screen;
}

async function readSettings(): Promise<PiksySettings> {
  try {
    const raw = await fs.readFile(settingsFile(), "utf8");
    cachedSettings = normalizeSettings(JSON.parse(raw) as Partial<PiksySettings>);
  } catch {
    cachedSettings = DEFAULT_SETTINGS;
  }
  return cachedSettings;
}

async function writeSettings(settings: PiksySettings): Promise<void> {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2), "utf8");
}

function macPrivacyUrl(key: PermissionKey): string {
  switch (key) {
    case "microphone":
      return "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
    case "accessibility":
      return "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
    case "screenRecording":
    case "screenContent":
      return "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
  }
}

async function refreshPermissionSnapshot(): Promise<PermissionSnapshot> {
  const nativeSnapshot = await getNativePermissionSnapshot();
  cachedPermissions = {
    microphone: normalizePermissionStatus(nativeSnapshot.microphone),
    accessibility: normalizePermissionStatus(nativeSnapshot.accessibility),
    screenRecording: normalizePermissionStatus(nativeSnapshot.screenRecording),
    screenContent: normalizePermissionStatus(nativeSnapshot.screenContent)
  };
  return cachedPermissions;
}

async function requestPermission(key: PermissionKey): Promise<PermissionSnapshot> {
  const nativeSnapshot = await requestNativePermission(key);
  cachedPermissions = {
    microphone: normalizePermissionStatus(nativeSnapshot.microphone),
    accessibility: normalizePermissionStatus(nativeSnapshot.accessibility),
    screenRecording: normalizePermissionStatus(nativeSnapshot.screenRecording),
    screenContent: normalizePermissionStatus(nativeSnapshot.screenContent)
  };
  return cachedPermissions;
}

function labeledImageBlocks(screenshots: NativeScreenshotPayload[]) {
  return screenshots.flatMap((screenshot, index) => {
    const label =
      `${screenshot.label ?? `screen ${index + 1}`}` +
      ` (image dimensions: ${screenshot.screenshotWidthInPixels ?? screenshot.width}x${screenshot.screenshotHeightInPixels ?? screenshot.height} pixels)`;
    return [
      { type: "text", text: label },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: screenshot.mediaType,
          data: screenshot.data
        }
      }
    ];
  });
}

function companionSystemPrompt(): string {
  return [
    "you're piksy, a friendly always-on companion that lives in the user's menu bar. the user just spoke to you via push-to-talk and you can see their screen(s).",
    "default to one or two sentences unless the user asks for depth. be direct, casual, warm, and write for speech.",
    "if pointing would help, use pointAt-style tags exactly like [POINT:x,y:label:screenN]. coordinates use the screenshot pixel space, origin top-left.",
    "if the cursor screen is relevant, omit screenN or use screen1. if another display is relevant, include its screen number from the image label."
  ].join("\n");
}

function textFromChatPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const value = payload as {
    text?: unknown;
    content?: unknown;
    response?: unknown;
    message?: { content?: unknown };
    delta?: { text?: unknown; content?: unknown };
    choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown }; text?: unknown }>;
  };
  if (typeof value.text === "string") return value.text;
  if (typeof value.response === "string") return value.response;
  if (typeof value.content === "string") return value.content;
  if (Array.isArray(value.content)) {
    return value.content.map((block) => (block && typeof block === "object" && "text" in block ? String((block as { text?: unknown }).text ?? "") : "")).join("");
  }
  if (typeof value.message?.content === "string") return value.message.content;
  if (typeof value.delta?.text === "string") return value.delta.text;
  if (typeof value.delta?.content === "string") return value.delta.content;
  if (Array.isArray(value.choices)) {
    return value.choices.map((choice) => String(choice.delta?.content ?? choice.message?.content ?? choice.text ?? "")).join("");
  }
  return "";
}

async function readChatResponseText(response: Response): Promise<string> {
  const raw = await response.text();
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (!trimmed.includes("\ndata:") && !trimmed.startsWith("data:")) {
    try {
      return textFromChatPayload(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }

  return trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line.length > 0 && line !== "[DONE]")
    .map((line) => {
      try {
        return textFromChatPayload(JSON.parse(line));
      } catch {
        return "";
      }
    })
    .join("");
}

function spokenTextWithoutPointTags(text: string): string {
  return text.replace(/\[POINT\s*:\s*(?:none|(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*:\s*([^:\]]+?))?(?:\s*:\s*screen(\d+))?)\s*\]/gi, "").trim();
}

function pointingSequence(text: string): Array<{ point: PointAtPayload; speech: string }> {
  const pattern = /\[POINT\s*:\s*(?:none|(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*:\s*([^:\]]+?))?(?:\s*:\s*screen(\d+))?)\s*\]/gi;
  const matches = Array.from(text.matchAll(pattern));
  if (matches.length === 0) {
    return [];
  }

  const firstMatchIndex = matches[0]?.index ?? 0;
  const prefixSpeech = text.slice(0, firstMatchIndex).trim();
  return matches.flatMap((match, index) => {
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || match.index === undefined) {
      return [];
    }
    const nextMatchIndex = matches[index + 1]?.index ?? text.length;
    const tagEndIndex = match.index + match[0].length;
    const suffixSpeech = text.slice(tagEndIndex, nextMatchIndex).trim();
    const speech = index === 0 && prefixSpeech ? [prefixSpeech, suffixSpeech].filter(Boolean).join(" ") : suffixSpeech;
    return [
      {
        point: {
          x,
          y,
          label: match[3]?.trim() ?? "element",
          screenIndex: match[4] ? Math.max(0, Number(match[4]) - 1) : 0
        },
        speech
      }
    ];
  });
}

function mapScreenshotPointToDesktopPoint(point: PointAtPayload, screenshots: NativeScreenshotPayload[]): PointAtPayload | null {
  const screenshot = screenshots[point.screenIndex] ?? screenshots.find((candidate) => candidate.isCursorScreen) ?? screenshots[0];
  if (!screenshot) {
    return null;
  }

  const screenshotWidth = screenshot.screenshotWidthInPixels ?? screenshot.width;
  const screenshotHeight = screenshot.screenshotHeightInPixels ?? screenshot.height;
  const clampedX = Math.max(0, Math.min(point.x, screenshotWidth));
  const clampedY = Math.max(0, Math.min(point.y, screenshotHeight));
  const display = getScreen().getAllDisplays().find((candidate) => candidate.id === screenshot.displayId);
  const displayBounds = display?.bounds ?? {
    x: screenshot.x,
    y: screenshot.y,
    width: screenshot.width,
    height: screenshot.height
  };
  return {
    ...point,
    x: displayBounds.x + clampedX * (displayBounds.width / screenshotWidth),
    y: displayBounds.y + clampedY * (displayBounds.height / screenshotHeight)
  };
}

async function sendPromptToCompanion(prompt: string): Promise<CompanionResponsePayload> {
  const settings = await readSettings();
  const screenshots = await captureNativeScreenshots();
  const response = await fetch(`${settings.serverUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.selectedModel,
      max_tokens: 768,
      stream: true,
      system: companionSystemPrompt(),
      messages: [
        ...conversationHistory,
        {
          role: "user",
          content: [
            ...labeledImageBlocks(screenshots),
            { type: "text", text: prompt }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Companion chat failed (${response.status}): ${await response.text()}`);
  }

  const text = await readChatResponseText(response);
  conversationHistory.push({ role: "user", content: prompt }, { role: "assistant", content: text });
  while (conversationHistory.length > 20) {
    conversationHistory.shift();
  }

  const sequence = pointingSequence(text).flatMap((step) => {
    const desktopPoint = mapScreenshotPointToDesktopPoint(step.point, screenshots);
    return desktopPoint ? [{ point: desktopPoint, speech: step.speech }] : [];
  });

  return { text, spokenText: spokenTextWithoutPointTags(text), pointingSequence: sequence };
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.permissionsGetSnapshot, () => refreshPermissionSnapshot());
  ipcMain.handle(IPC_CHANNELS.permissionsRequest, async (_event, key: PermissionKey) => {
    try {
      return { success: true, data: await requestPermission(key) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  ipcMain.handle(IPC_CHANNELS.permissionsOpenSettings, async (_event, key: PermissionKey) => {
    try {
      if (process.platform === "darwin") {
        await shell.openExternal(macPrivacyUrl(key));
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.settingsGet, () => readSettings());
  ipcMain.handle(IPC_CHANNELS.settingsSet, async (_event, partial: SettingsSetPayload) => {
    try {
      const next = normalizeSettings({ ...(await readSettings()), ...partial });
      cachedSettings = next;
      await writeSettings(next);
      return { success: true, data: next };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.dictationStart, () => ({ success: true }));
  ipcMain.handle(IPC_CHANNELS.dictationStop, () => ({ success: true, data: { transcript: "" } }));
  ipcMain.handle(IPC_CHANNELS.companionSendPrompt, async (_event, prompt: string) => {
    try {
      publishVoiceState("processing");
      const result = await sendPromptToCompanion(prompt);
      return { success: true, data: result };
    } catch (error) {
      publishVoiceState("idle");
      return { success: false, error: String(error) };
    }
  });
  ipcMain.handle(IPC_CHANNELS.companionCaptureScreens, async () => {
    try {
      return { success: true, data: await captureNativeScreenshots() };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  ipcMain.handle(IPC_CHANNELS.overlayShow, () => {
    showOverlay();
    return { success: true };
  });
  ipcMain.handle(IPC_CHANNELS.overlayHide, () => {
    hideOverlay();
    return { success: true };
  });
  ipcMain.handle(IPC_CHANNELS.overlayPointAt, (_event, target: PointAtPayload) => {
    sendOverlayPoint(target);
    return { success: true };
  });
  ipcMain.handle(IPC_CHANNELS.overlayCursorPosition, (event) => {
    const cursorPoint = getScreen().getCursorScreenPoint();
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const overlayBounds = senderWindow?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: cursorPoint.x - overlayBounds.x,
      y: cursorPoint.y - overlayBounds.y,
      isOnScreen:
        cursorPoint.x >= overlayBounds.x &&
        cursorPoint.x <= overlayBounds.x + overlayBounds.width &&
        cursorPoint.y >= overlayBounds.y &&
        cursorPoint.y <= overlayBounds.y + overlayBounds.height
    };
  });
  ipcMain.on(IPC_CHANNELS.analyticsTrack, (_event, name: string, properties?: Record<string, unknown>) => {
    console.log("[analytics]", name, properties ?? {});
  });
  ipcMain.on(IPC_CHANNELS.appSetVoiceState, (_event, voiceState: "idle" | "listening" | "processing" | "responding") => {
    console.info(`[voice-state] renderer reported: ${voiceState}`);
    sendVoiceState(voiceState);
  });
  ipcMain.on(IPC_CHANNELS.appDismissPanel, () => hidePanel());
  ipcMain.on(IPC_CHANNELS.appQuit, () => app.quit());
}

export function publishVoiceState(voiceState: "idle" | "listening" | "processing" | "responding"): void {
  sendVoiceState(voiceState);
}

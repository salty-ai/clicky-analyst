import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PermissionSnapshot } from "../src/features/permissions/permissionTypes";
import { getMacScreenCaptureHelperPath, getWindowsCaptureHelperPath, getWindowsKeyboardHookHelperPath } from "./nativePaths";

const execFileAsync = promisify(execFile);

export type NativeScreenshot = {
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

export type ShortcutTransition = "down" | "up";

async function execJson<T>(file: string, args: string[], timeout = 30000): Promise<T> {
  const { stdout } = await execFileAsync(file, args, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    timeout
  });
  return JSON.parse(stdout) as T;
}

export async function getNativePermissionSnapshot(): Promise<PermissionSnapshot> {
  if (process.platform !== "darwin") {
    return {
      microphone: "granted",
      accessibility: "granted",
      screenRecording: "granted",
      screenContent: "granted"
    };
  }
  return execJson<PermissionSnapshot>(getMacScreenCaptureHelperPath(), ["--permissions"]);
}

export async function requestNativePermission(kind: "microphone" | "accessibility" | "screenRecording" | "screenContent"): Promise<PermissionSnapshot> {
  if (process.platform !== "darwin") {
    return getNativePermissionSnapshot();
  }

  const helper = getMacScreenCaptureHelperPath();
  if (kind === "microphone") {
    return execJson<PermissionSnapshot>(helper, ["--request-microphone"], 65000);
  }
  if (kind === "accessibility") {
    return execJson<PermissionSnapshot>(helper, ["--request-accessibility"], 65000);
  }
  return execJson<PermissionSnapshot>(helper, ["--request-screen"], 65000);
}

export async function captureNativeScreenshots(): Promise<NativeScreenshot[]> {
  if (process.platform === "darwin") {
    return execJson<NativeScreenshot[]>(getMacScreenCaptureHelperPath(), ["--capture-screens"], 60000);
  }
  if (process.platform === "win32") {
    return execJson<NativeScreenshot[]>(getWindowsCaptureHelperPath(), [], 60000);
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

export function getShortcutHelperExecutablePath(): string | null {
  if (process.platform === "darwin") {
    return getMacScreenCaptureHelperPath();
  }
  if (process.platform === "win32") {
    return getWindowsKeyboardHookHelperPath();
  }
  return null;
}

export function startNativeShortcutMonitor(onTransition: (transition: ShortcutTransition) => void, onError: (error: Error) => void): () => void {
  const executablePath = getShortcutHelperExecutablePath();
  if (!executablePath) {
    return () => undefined;
  }

  const args = process.platform === "darwin" ? ["--keyboard-hook"] : [];
  let child: ChildProcessWithoutNullStreams | null = spawn(executablePath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });

  let pending = "";
  child.stdout.on("data", (chunk: Buffer) => {
    pending += chunk.toString("utf8");
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "SHORTCUT_DOWN") {
        onTransition("down");
      } else if (line === "SHORTCUT_UP") {
        onTransition("up");
      } else if (line === "READY") {
        console.info("[native-shortcut] helper ready");
      }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const message = chunk.toString("utf8").trim();
    if (message) {
      console.warn("[native-shortcut] stderr:", message);
    }
  });
  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") {
      onError(error);
    }
  });
  child.on("error", (error) => {
    console.error("[native-shortcut] process error:", error.message);
    onError(error);
  });
  child.on("exit", (code, signal) => {
    console.warn(`[native-shortcut] process exited: code=${code} signal=${signal}`);
    if (code && code !== 0) {
      onError(new Error(`Shortcut helper exited with code ${code}${signal ? ` (${signal})` : ""}.`));
    }
  });

  return () => {
    if (!child) {
      return;
    }
    const processToStop = child;
    child = null;
    if (!processToStop.killed) {
      try {
        if (processToStop.stdin.writable && !processToStop.stdin.destroyed) {
          processToStop.stdin.write("stop\n", (error) => {
            if (error && (error as NodeJS.ErrnoException).code !== "EPIPE") {
              onError(error);
            }
          });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EPIPE") {
          onError(error instanceof Error ? error : new Error(String(error)));
        }
      }
      processToStop.kill();
    }
  };
}

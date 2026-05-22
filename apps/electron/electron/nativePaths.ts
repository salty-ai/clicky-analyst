import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app } = require("electron") as typeof import("electron");

export function resolveUnpackedAppPath(...segments: string[]): string {
  const resolved = path.join(app.getAppPath(), ...segments);
  if (app.isPackaged) {
    return resolved.replace(/\.asar([/\\])/, ".asar.unpacked$1");
  }
  return resolved;
}

export function getNativeArchTag(platform = process.platform, arch = process.arch): string {
  if (platform === "darwin") {
    return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  }
  if (platform === "win32") {
    return arch === "arm64" ? "win32-arm64" : "win32-x64";
  }
  return `${platform}-${arch}`;
}

export function getPrebundledNativeHelperPath(binaryName: string): string {
  return resolveUnpackedAppPath("electron", "native", "bin", getNativeArchTag(), binaryName);
}

export function getMacScreenCaptureHelperPath(): string {
  return getPrebundledNativeHelperPath("glide-native-helper");
}

export function getWindowsCaptureHelperPath(): string {
  return getPrebundledNativeHelperPath("glide-screen-capture.exe");
}

export function getWindowsKeyboardHookHelperPath(): string {
  return getPrebundledNativeHelperPath("glide-keyboard-hook.exe");
}

export type PermissionKey = "microphone" | "accessibility" | "screenRecording" | "screenContent";
export type PermissionStatus = "granted" | "denied" | "prompt" | "unknown";

export type PermissionSnapshot = Record<PermissionKey, PermissionStatus>;

export const DEFAULT_PERMISSION_SNAPSHOT: PermissionSnapshot = {
  microphone: "unknown",
  accessibility: "unknown",
  screenRecording: "unknown",
  screenContent: "unknown"
};

export function isPermissionGranted(status: PermissionStatus): boolean {
  return status === "granted";
}

export function areAllPermissionsGranted(snapshot: PermissionSnapshot): boolean {
  return Object.values(snapshot).every(isPermissionGranted);
}

export function normalizePermissionStatus(value: unknown): PermissionStatus {
  if (value === "granted" || value === "denied" || value === "prompt" || value === "unknown") {
    return value;
  }
  if (value === true) {
    return "granted";
  }
  if (value === false) {
    return "denied";
  }
  return "unknown";
}

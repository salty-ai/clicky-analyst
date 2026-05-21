import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { publishVoiceState, registerIpcHandlers } from "./ipc/register";
import { requestNativePermission, startNativeShortcutMonitor } from "./nativeBridge";
import { createPanelWindow, hidePanel, initializeWindowLifecycle, showOverlay, showPanelNearTray } from "./windows";

const require = createRequire(import.meta.url);
const { app, Menu, nativeImage, session, systemPreferences, Tray } = require("electron") as typeof import("electron");
const electronDir = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(electronDir, "..");

let tray: Electron.Tray | null = null;
let stopShortcutMonitor: (() => void) | null = null;
let shortcutRetryTimer: NodeJS.Timeout | null = null;
const TRAY_ICON_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAA0VXHyAAABdUlEQVQ4EaWTQU/bQBBG36zXcRxCICiHSpVQBeqhEtw48P+5cuyh5YyqojZSQUEmsXeXGRJbpBgVlTnsaLTfvJnxrCXEmIT/N/eeZCvremsbVd6G7gc81LCoOnbLM+bf3JcAU1zP4eIr8kN9gmWAO+X9vE38XmxDfFdm03VKiRCF1W2gurzh/tDhDvcZlWIsiq0M6MKot1ahCUKoSvI0pqxqZt+vKMKMdPIJdj1eElqjsw5gc5a54Ar1k4Z89Qun4yTb07druF8iZ8ewo4JegOoOdjbgYUaKqrNDTbS9eHXDMnqa888UA8Fvvl7XgQmfWlNQ8F73q93UNfX+Hn+mM6psQD4bM2wSuRdEAdbIFsAgqwZqySicZz4cc3f6hcnHER/ywMDUOqZZO8UWwDZYrXRt5ITJlHK34OCoIBtaio7VZlm4MYn6L7RB62NIuPkCyRxpOtL3uq7a3j/3vYAngWFfz+sYL19ie/WGZJOuAX3DtaB/+EdsFnfOEzP/NAAAAABJRU5ErkJggg==";

if (process.platform === "darwin" && app.isPackaged) {
  app.dock?.hide();
}

if (process.platform === "darwin") {
  app.setActivationPolicy?.("accessory");
}

function showPanelFromTray(): void {
  showPanelNearTray(tray?.getBounds());
}

function createTray(): void {
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, "base64"));
  icon.setTemplateImage(process.platform === "darwin");
  tray = new Tray(icon);
  tray.setTitle(process.platform === "darwin" ? "Piksy" : "");
  tray.setToolTip("Piksy");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Piksy", click: showPanelFromTray },
      { type: "separator" },
      { label: "Quit Piksy", click: () => app.quit() }
    ])
  );
  tray.on("click", showPanelFromTray);
}

async function prepareNativePermissions(): Promise<void> {
  const allowedPermissions = new Set(["media", "audioCapture", "microphone"]);

  // Match Recordly's approach: allow both Chromium's permission check and
  // runtime permission request paths. Electron can use different permission
  // names for getUserMedia depending on platform/version.
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => allowedPermissions.has(permission));
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.has(permission));
  });
  session.defaultSession.setDevicePermissionHandler((details) => allowedPermissions.has(details.deviceType));

  if (process.platform !== "darwin") {
    return;
  }

  const microphoneStatus = systemPreferences.getMediaAccessStatus("microphone");
  if (microphoneStatus !== "granted") {
    const granted = await systemPreferences.askForMediaAccess("microphone");
    console.info(`[permissions] microphone request result: ${granted}`);
  }

  try {
    const snapshot = await requestNativePermission("accessibility");
    console.info(`[permissions] accessibility status: ${snapshot.accessibility}`);
  } catch (error) {
    console.warn("[permissions] failed to request accessibility permission", error);
  }
}

function startShortcutMonitorIfNeeded(): void {
  if (stopShortcutMonitor) {
    return;
  }

  let shortcutDownAt = 0;

  stopShortcutMonitor = startNativeShortcutMonitor(
    (transition) => {
      console.info(`[native-shortcut] transition: ${transition} at ${Date.now()}`);
      if (transition === "down") {
        shortcutDownAt = Date.now();
        hidePanel();
        publishVoiceState("listening");
        return;
      }
      // Ignore releases that come too quickly — the native event tap can
      // produce a spurious UP when both modifiers are pressed near-simultaneously.
      const held = Date.now() - shortcutDownAt;
      if (held < 300) {
        console.warn(`[native-shortcut] ignored release after ${held}ms`);
        return;
      }
      publishVoiceState("processing");
    },
    (error) => {
      console.warn("[native-shortcut]", error.message);
      stopShortcutMonitor?.();
      stopShortcutMonitor = null;
    }
  );
}

app.whenReady().then(async () => {
  initializeWindowLifecycle();
  await prepareNativePermissions();
  registerIpcHandlers();
  createPanelWindow();
  createTray();
  startShortcutMonitorIfNeeded();
  shortcutRetryTimer = setInterval(startShortcutMonitorIfNeeded, 5000);
  showOverlay();
  showPanelFromTray();
});

app.on("activate", () => {
  showPanelFromTray();
});

app.on("window-all-closed", () => undefined);

app.on("before-quit", () => {
  if (shortcutRetryTimer) {
    clearInterval(shortcutRetryTimer);
    shortcutRetryTimer = null;
  }
  stopShortcutMonitor?.();
  stopShortcutMonitor = null;
});

import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electron = require("electron") as typeof import("electron");
const { app, BrowserWindow } = electron;
const electronDir = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(electronDir, "..");
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(APP_ROOT, "dist");

let panelWindow: Electron.BrowserWindow | null = null;
const overlayWindows = new Map<number, Electron.BrowserWindow>();
let outsidePanelClickHandler: ((event: Electron.Event) => void) | null = null;
let isWindowLifecycleInitialized = false;
let cursorStreamTimer: NodeJS.Timeout | null = null;
let lastCursorPoint: Electron.Point | null = null;

function getScreen(): Electron.Screen {
  return electron.screen;
}

function rendererUrl(windowType: "panel" | "overlay"): string {
  const params = new URLSearchParams({ windowType });
  if (VITE_DEV_SERVER_URL) {
    return `${VITE_DEV_SERVER_URL}?${params.toString()}`;
  }
  return `file://${path.join(RENDERER_DIST, "index.html")}?${params.toString()}`;
}

export function createPanelWindow(): Electron.BrowserWindow {
  if (panelWindow && !panelWindow.isDestroyed()) {
    return panelWindow;
  }

  panelWindow = new BrowserWindow({
    width: 320,
    height: 360,
    show: false,
    frame: false,
    resizable: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(electronDir, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      sandbox: false
    }
  });
  panelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panelWindow.setAlwaysOnTop(true, "floating", 1);
  panelWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`[preload-error] ${preloadPath}: ${error.message}`);
  });
  panelWindow.loadURL(rendererUrl("panel"));
  panelWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      event.preventDefault();
      panelWindow?.hide();
    }
  });
  panelWindow.on("closed", () => {
    panelWindow = null;
  });
  panelWindow.on("blur", () => {
    setTimeout(() => hidePanel(), 300);
  });
  return panelWindow;
}

function configureOverlayWindow(window: Electron.BrowserWindow, display: Electron.Display): void {
  window.setBounds(display.bounds, false);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setAlwaysOnTop(true, "screen-saver", 1);
  window.setIgnoreMouseEvents(true, { forward: true });
  window.moveTop();
}

function createOverlayWindowForDisplay(display: Electron.Display): Electron.BrowserWindow {
  const existing = overlayWindows.get(display.id);
  if (existing && !existing.isDestroyed()) {
    configureOverlayWindow(existing, display);
    return existing;
  }

  const overlayWindow = new BrowserWindow({
    ...display.bounds,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: true,
    hasShadow: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(electronDir, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });
  configureOverlayWindow(overlayWindow, display);
  overlayWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`[preload-error] ${preloadPath}: ${error.message}`);
  });
  overlayWindow.loadURL(rendererUrl("overlay"));
  overlayWindow.on("closed", () => {
    overlayWindows.delete(display.id);
  });
  overlayWindows.set(display.id, overlayWindow);
  return overlayWindow;
}

function reconcileOverlayWindows(): Electron.BrowserWindow[] {
  const displays = getScreen().getAllDisplays();
  const displayIds = new Set(displays.map((display) => display.id));
  for (const [displayId, window] of overlayWindows) {
    if (!displayIds.has(displayId)) {
      if (!window.isDestroyed()) {
        window.close();
      }
      overlayWindows.delete(displayId);
    }
  }
  return displays.map(createOverlayWindowForDisplay);
}

function installOutsidePanelClickHandler(): void {
  if (outsidePanelClickHandler) {
    return;
  }
  outsidePanelClickHandler = () => {
    if (!panelWindow || panelWindow.isDestroyed() || !panelWindow.isVisible()) {
      return;
    }
    const clickPoint = getScreen().getCursorScreenPoint();
    if (pointInRect(clickPoint, panelWindow.getBounds())) {
      return;
    }
    hidePanel();
  };
  app.on("browser-window-focus", outsidePanelClickHandler);
}

function removeOutsidePanelClickHandler(): void {
  if (!outsidePanelClickHandler) {
    return;
  }
  app.off("browser-window-focus", outsidePanelClickHandler);
  outsidePanelClickHandler = null;
}

function pointInRect(point: Electron.Point, rect: Electron.Rectangle): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function cursorPayloadForBounds(cursorPoint: Electron.Point, bounds: Electron.Rectangle): { x: number; y: number; isOnScreen: boolean } {
  return {
    x: cursorPoint.x - bounds.x,
    y: cursorPoint.y - bounds.y,
    isOnScreen: pointInRect(cursorPoint, bounds)
  };
}

function displayContainingPoint(point: Electron.Point): Electron.Display {
  return getScreen().getDisplayNearestPoint(point);
}

export function showPanelNearTray(trayBounds?: Electron.Rectangle): void {
  const panel = createPanelWindow();
  const anchor = trayBounds && trayBounds.width > 0 ? trayBounds : undefined;
  const electronScreen = getScreen();
  const display = anchor ? electronScreen.getDisplayNearestPoint({ x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 }) : electronScreen.getPrimaryDisplay();
  const bounds = panel.getBounds();
  const x = anchor ? Math.round(anchor.x + anchor.width / 2 - bounds.width / 2) : Math.round(display.workArea.x + display.workArea.width - bounds.width - 12);
  const y = anchor ? Math.round(anchor.y + anchor.height + 4) : Math.round(display.workArea.y + 4);
  const clampedX = Math.max(display.workArea.x + 4, Math.min(x, display.workArea.x + display.workArea.width - bounds.width - 4));
  panel.setPosition(clampedX, y, false);
  panel.show();
  panel.focus();
  panel.moveTop();
  installOutsidePanelClickHandler();
}

export function hidePanel(): void {
  panelWindow?.hide();
  removeOutsidePanelClickHandler();
}

export function showOverlay(): Electron.BrowserWindow[] {
  const windows = reconcileOverlayWindows();
  for (const overlay of windows) {
    overlay.showInactive();
    overlay.moveTop();
  }
  startCursorStream();
  return windows;
}

export function hideOverlay(): void {
  for (const overlay of overlayWindows.values()) {
    overlay.hide();
  }
  stopCursorStream();
}

export function sendOverlayPoint(target: { x: number; y: number; label: string; screenIndex: number }): void {
  const point = { x: target.x, y: target.y };
  const display = displayContainingPoint(point);
  const overlay = createOverlayWindowForDisplay(display);
  const bounds = overlay.getBounds();
  overlay.webContents.send("piksy:overlay:point-changed", {
    ...target,
    x: target.x - bounds.x,
    y: target.y - bounds.y
  });
  overlay.showInactive();
}

export function sendVoiceState(voiceState: "idle" | "listening" | "processing" | "responding"): void {
  panelWindow?.webContents.send("piksy:voice-state:changed", voiceState);
  const overlays = reconcileOverlayWindows();
  for (const overlay of overlays) {
    overlay.webContents.send("piksy:voice-state:changed", voiceState);
  }
  if (voiceState === "idle") {
    return;
  }
  for (const overlay of overlays) {
    overlay.showInactive();
  }
}

export function closeAllWindows(): void {
  stopCursorStream();
  panelWindow?.close();
  for (const overlay of overlayWindows.values()) {
    overlay.close();
  }
  overlayWindows.clear();
}

function startCursorStream(): void {
  if (cursorStreamTimer) {
    return;
  }
  cursorStreamTimer = setInterval(() => {
    const cursorPoint = getScreen().getCursorScreenPoint();
    if (lastCursorPoint && lastCursorPoint.x === cursorPoint.x && lastCursorPoint.y === cursorPoint.y) {
      return;
    }
    lastCursorPoint = cursorPoint;
    for (const overlay of overlayWindows.values()) {
      if (overlay.isDestroyed() || !overlay.isVisible()) {
        continue;
      }
      overlay.webContents.send("piksy:overlay:cursor-position-changed", cursorPayloadForBounds(cursorPoint, overlay.getBounds()));
    }
  }, 8);
}

function stopCursorStream(): void {
  if (!cursorStreamTimer) {
    return;
  }
  clearInterval(cursorStreamTimer);
  cursorStreamTimer = null;
  lastCursorPoint = null;
}

export function initializeWindowLifecycle(): void {
  if (isWindowLifecycleInitialized) {
    return;
  }
  isWindowLifecycleInitialized = true;
  const electronScreen = getScreen();
  electronScreen.on("display-added", reconcileOverlayWindows);
  electronScreen.on("display-removed", reconcileOverlayWindows);
  electronScreen.on("display-metrics-changed", reconcileOverlayWindows);
}

app.on("before-quit", closeAllWindows);

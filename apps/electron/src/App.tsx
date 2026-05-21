import { useEffect, useMemo, useRef, useState } from "react";
import { CompanionPanel } from "./features/panel/CompanionPanel";
import { DEFAULT_PERMISSION_SNAPSHOT, type PermissionKey, type PermissionSnapshot } from "./features/permissions/permissionTypes";
import { DEFAULT_SETTINGS, type PiksySettings, type PiksyVoiceState } from "./features/settings/settingsTypes";
import { CursorOverlay } from "./features/overlay/CursorOverlay";
import { ResponseOverlay } from "./features/overlay/ResponseOverlay";
import { BrowserAssemblyStreamingDictationSession } from "./features/dictation/assemblyAiStreaming";
// TTS temporarily disabled.
// import { BrowserTtsClient } from "./features/tts/ttsClient";
import { isElectronBridgeAvailable, piksyBridge } from "./piksyBridge";

const BUDDY_CURSOR_OFFSET = { x: 35, y: 25 };
const TARGET_CURSOR_OFFSET = { x: -7, y: -2 };
const POINT_TARGET_DWELL_MS = 1200;
const POINTING_STEP_DELAY_MS = 1700;

function buddyPointFromCursor(point: { x: number; y: number }) {
  return {
    x: point.x + BUDDY_CURSOR_OFFSET.x,
    y: point.y + BUDDY_CURSOR_OFFSET.y
  };
}

function easeInOut(progress: number) {
  return progress * progress * (3 - 2 * progress);
}

function bezierPoint(start: { x: number; y: number }, control: { x: number; y: number }, end: { x: number; y: number }, progress: number) {
  const inverse = 1 - progress;
  return {
    x: inverse * inverse * start.x + 2 * inverse * progress * control.x + progress * progress * end.x,
    y: inverse * inverse * start.y + 2 * inverse * progress * control.y + progress * progress * end.y
  };
}

export function App() {
  const [permissions, setPermissions] = useState<PermissionSnapshot>(DEFAULT_PERMISSION_SNAPSHOT);
  const [settings, setSettings] = useState<PiksySettings>(DEFAULT_SETTINGS);
  const [voiceState, setVoiceState] = useState<PiksyVoiceState>("idle");
  const [responseText, setResponseText] = useState("");
  const [cursorPoint, setCursorPoint] = useState({ x: 120, y: 120 });
  const [buddyPoint, setBuddyPointState] = useState(() => buddyPointFromCursor({ x: 120, y: 120 }));
  const [isCursorOnThisOverlay, setIsCursorOnThisOverlay] = useState(true);
  const [navigationBubbleText, setNavigationBubbleText] = useState("");
  const [buddyRotationDegrees, setBuddyRotationDegrees] = useState(0);
  const [buddyScale, setBuddyScale] = useState(1);
  const cursorPointRef = useRef(cursorPoint);
  const buddyPointRef = useRef(buddyPoint);
  const isNavigatingRef = useRef(false);
  const navigationRunRef = useRef(0);
  const navigationFrameRef = useRef<number | null>(null);
  const navigationTimeoutRef = useRef<number | null>(null);
  const dictationSessionRef = useRef<BrowserAssemblyStreamingDictationSession | null>(null);
  // const ttsClientRef = useRef(new BrowserTtsClient());
  const settingsRef = useRef(settings);

  const setBuddyPoint = (point: { x: number; y: number }) => {
    buddyPointRef.current = point;
    setBuddyPointState(point);
  };
  const windowType = useMemo(() => new URLSearchParams(window.location.search).get("windowType") ?? "panel", []);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (windowType !== "overlay") {
      return undefined;
    }

    const updateCursorPoint = (point: { x: number; y: number; isOnScreen: boolean }) => {
      cursorPointRef.current = point;
      setCursorPoint(point);
      setIsCursorOnThisOverlay(point.isOnScreen);
      if (!isNavigatingRef.current) {
        setBuddyPoint(buddyPointFromCursor(point));
        setBuddyRotationDegrees(0);
        setBuddyScale(1);
      }
    };

    void piksyBridge.overlay.cursorPosition().then(updateCursorPoint);
    const unsubscribeCursor = piksyBridge.overlay.onCursorPositionChanged(updateCursorPoint);
    return () => {
      unsubscribeCursor?.();
    };
  }, [windowType]);

  useEffect(() => {
    void piksyBridge.permissions.getSnapshot().then(setPermissions);
    void piksyBridge.settings.get().then(setSettings);
    const unsubscribeTranscript = piksyBridge.dictation.onTranscript((transcript) => {
      setResponseText(transcript);
    });
    const unsubscribePoint = piksyBridge.overlay.onPointChanged((target) => {
      navigationRunRef.current += 1;
      const navigationRun = navigationRunRef.current;
      if (navigationFrameRef.current !== null) {
        window.cancelAnimationFrame(navigationFrameRef.current);
        navigationFrameRef.current = null;
      }
      if (navigationTimeoutRef.current !== null) {
        window.clearTimeout(navigationTimeoutRef.current);
        navigationTimeoutRef.current = null;
      }

      setNavigationBubbleText(target.label);
      setVoiceState("idle");

      const start = buddyPointRef.current;
      const end = {
        x: target.x + TARGET_CURSOR_OFFSET.x,
        y: target.y + TARGET_CURSOR_OFFSET.y
      };
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      const duration = Math.min(Math.max(distance / 800, 0.6), 1.4) * 1000;
      const control = {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2 - Math.min(distance * 0.2, 80)
      };
      const startedAt = performance.now();
      isNavigatingRef.current = true;

      const flyToTarget = (now: number) => {
        const progress = Math.min((now - startedAt) / duration, 1);
        const easedProgress = easeInOut(progress);
        const nextPoint = bezierPoint(start, control, end, easedProgress);
        setBuddyPoint(nextPoint);
        setBuddyRotationDegrees(0);
        setBuddyScale(1 + Math.sin(progress * Math.PI) * 0.3);
        if (navigationRun !== navigationRunRef.current) {
          return;
        }
        if (progress < 1) {
          navigationFrameRef.current = window.requestAnimationFrame(flyToTarget);
          return;
        }

        navigationFrameRef.current = null;
        navigationTimeoutRef.current = window.setTimeout(() => {
          navigationTimeoutRef.current = null;
          if (navigationRun !== navigationRunRef.current) {
            return;
          }
          const returnStart = end;
          const returnEnd = buddyPointFromCursor(cursorPointRef.current);
          const returnDistance = Math.hypot(returnEnd.x - returnStart.x, returnEnd.y - returnStart.y);
          const returnDuration = Math.min(Math.max(returnDistance / 800, 0.6), 1.4) * 1000;
          const returnControl = {
            x: (returnStart.x + returnEnd.x) / 2,
            y: (returnStart.y + returnEnd.y) / 2 - Math.min(returnDistance * 0.2, 80)
          };
          const returnStartedAt = performance.now();

          const flyBack = (returnNow: number) => {
            const returnProgress = Math.min((returnNow - returnStartedAt) / returnDuration, 1);
            const easedReturnProgress = easeInOut(returnProgress);
            const nextPoint = bezierPoint(returnStart, returnControl, returnEnd, easedReturnProgress);
            setBuddyPoint(nextPoint);
            setBuddyRotationDegrees(0);
            setBuddyScale(1 + Math.sin(returnProgress * Math.PI) * 0.3);
            if (navigationRun !== navigationRunRef.current) {
              return;
            }
            if (returnProgress < 1) {
              navigationFrameRef.current = window.requestAnimationFrame(flyBack);
              return;
            }
            setNavigationBubbleText("");
            isNavigatingRef.current = false;
            setBuddyRotationDegrees(0);
            setBuddyScale(1);
            setBuddyPoint(buddyPointFromCursor(cursorPointRef.current));
            navigationFrameRef.current = null;
          };

          navigationFrameRef.current = window.requestAnimationFrame(flyBack);
        }, POINT_TARGET_DWELL_MS);
      };

      navigationFrameRef.current = window.requestAnimationFrame(flyToTarget);
    });
    const unsubscribeVoiceState = piksyBridge.app.onVoiceStateChanged((nextVoiceState) => {
      setVoiceState(nextVoiceState);
      if (nextVoiceState === "listening") {
        setResponseText("");
      }
    });
    return () => {
      navigationRunRef.current += 1;
      if (navigationFrameRef.current !== null) {
        window.cancelAnimationFrame(navigationFrameRef.current);
      }
      if (navigationTimeoutRef.current !== null) {
        window.clearTimeout(navigationTimeoutRef.current);
      }
      unsubscribeTranscript?.();
      unsubscribePoint?.();
      unsubscribeVoiceState?.();
    };
  }, []);

  useEffect(() => {
    if (windowType !== "panel") {
      return undefined;
    }

    let isDisposed = false;
    const unsubscribeVoiceState = piksyBridge.app.onVoiceStateChanged((nextVoiceState) => {
      if (nextVoiceState === "listening") {
        // ttsClientRef.current.stop();
        dictationSessionRef.current?.cancel();
        const session = new BrowserAssemblyStreamingDictationSession({
          serverUrl: settingsRef.current.serverUrl,
          onTranscriptUpdate: (transcript) => {
            if (!isDisposed) {
              setResponseText(transcript);
            }
          },
          onError: (error) => {
            console.warn("[dictation]", error.message);
            if (!isDisposed) {
              setResponseText(`Microphone error: ${error.message}`);
            }
          }
        });
        dictationSessionRef.current = session;
        void session.start().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn("[dictation]", message);
          if (dictationSessionRef.current === session) {
            dictationSessionRef.current = null;
            setResponseText(`Microphone error: ${message}`);
            piksyBridge.app.setVoiceState("idle");
          }
        });
        return;
      }

      if (nextVoiceState === "processing") {
        const session = dictationSessionRef.current;
        dictationSessionRef.current = null;
        if (!session) {
          return;
        }
        void session.stop().then((transcript) => {
          if (transcript.length === 0) {
            piksyBridge.app.setVoiceState("idle");
            return;
          }
          setResponseText(transcript);
          void piksyBridge.companion.sendPrompt(transcript).then(async (result) => {
            if (!result.data) {
              piksyBridge.app.setVoiceState("idle");
              return;
            }
            const response = result.data;
            setResponseText(response.spokenText || response.text);
            if (response.pointingSequence.length === 0) {
              piksyBridge.app.setVoiceState("responding");
              // await ttsClientRef.current.speak(settingsRef.current.serverUrl, response.spokenText || response.text);
              piksyBridge.app.setVoiceState("idle");
              return;
            }

            for (const step of response.pointingSequence) {
              piksyBridge.app.setVoiceState("idle");
              await piksyBridge.overlay.pointAt(step.point);
              await new Promise((resolve) => window.setTimeout(resolve, POINTING_STEP_DELAY_MS));
              if (step.speech.trim()) {
                piksyBridge.app.setVoiceState("responding");
                setResponseText(step.speech);
                // await ttsClientRef.current.speak(settingsRef.current.serverUrl, step.speech);
              }
            }
            piksyBridge.app.setVoiceState("idle");
          }).catch((error) => {
            console.warn("[companion]", error instanceof Error ? error.message : String(error));
            piksyBridge.app.setVoiceState("idle");
          });
        }).catch((error) => {
          console.warn("[dictation]", error instanceof Error ? error.message : String(error));
          piksyBridge.app.setVoiceState("idle");
        });
      }
    });

    return () => {
      isDisposed = true;
      dictationSessionRef.current?.cancel();
      dictationSessionRef.current = null;
      // ttsClientRef.current.stop();
      unsubscribeVoiceState?.();
    };
  }, [windowType]);

  async function handleGrantPermission(key: PermissionKey) {
    const result = await piksyBridge.permissions.request(key);
    if (result.data) {
      setPermissions(result.data);
    }
  }

  async function handleStart() {
    const result = await piksyBridge.settings.set({ hasCompletedOnboarding: true });
    if (result.data) {
      setSettings(result.data);
    }
    setVoiceState("responding");
    setResponseText("hey! i'm Piksy");
  }

  if (windowType === "overlay") {
    return (
      <>
        <CursorOverlay
          x={buddyPoint.x}
          y={buddyPoint.y}
          voiceState={voiceState}
          visible={settings.isPiksyCursorEnabled}
          isCursorOnScreen={isCursorOnThisOverlay || isNavigatingRef.current}
          bubbleText={navigationBubbleText || (settings.hasCompletedOnboarding ? undefined : "hey! i'm Piksy")}
          rotationDegrees={buddyRotationDegrees}
          scale={buddyScale}
        />
        <ResponseOverlay text={responseText} x={cursorPoint.x} y={cursorPoint.y} visible={voiceState === "responding"} />
      </>
    );
  }

  return (
    <main className="piksy-shell">
      {!isElectronBridgeAvailable ? (
        <div className="bridge-warning" role="status">
          Open Piksy from the Electron app, not the Vite browser URL.
        </div>
      ) : null}
      <CompanionPanel
        permissions={permissions}
        settings={settings}
        voiceState={voiceState}
        onDismiss={() => piksyBridge.app.dismissPanel()}
        onFindApp={() => void piksyBridge.permissions.openSettings("accessibility")}
        onGrantPermission={handleGrantPermission}
        onQuit={() => piksyBridge.app.quit()}
        onStart={handleStart}
      />
      <div hidden>
        <button type="button" onClick={() => setVoiceState("listening")} />
        <button type="button" onClick={() => setBuddyPoint({ x: buddyPoint.x + 20, y: buddyPoint.y + 20 })} />
      </div>
    </main>
  );
}

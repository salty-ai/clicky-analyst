import { useCallback, useEffect, useRef, useState } from "react";
import type { PiksyVoiceState } from "../settings/settingsTypes";
import { piksyBridge } from "../../piksyBridge";
import "./notchIsland.css";

export function NotchIsland() {
  const [voiceState, setVoiceState] = useState<PiksyVoiceState>("idle");
  const [statusText, setStatusText] = useState("");
  const [responseText, setResponseText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const collapseTimer = useRef<number | null>(null);

  useEffect(() => {
    const unsubVoice = piksyBridge.app.onVoiceStateChanged((state) => {
      setVoiceState(state);
      if (state === "listening") { setResponseText(""); setStatusText(""); }
      if (state === "idle") setStatusText("");
    });
    const unsubTranscript = piksyBridge.dictation.onTranscript(setResponseText);
    const unsubStatus = piksyBridge.notch.onStatus(setStatusText);
    return () => { unsubVoice?.(); unsubTranscript?.(); unsubStatus?.(); };
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (collapseTimer.current) { clearTimeout(collapseTimer.current); collapseTimer.current = null; }
    setExpanded(true);
    piksyBridge.notch.setIgnoreMouse(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    collapseTimer.current = window.setTimeout(() => {
      setExpanded(false);
      piksyBridge.notch.setIgnoreMouse(true);
      collapseTimer.current = null;
    }, 500);
  }, []);

  const isActive = voiceState !== "idle";
  const label = statusText
    || (voiceState === "listening" ? "Listening"
      : voiceState === "processing" ? "Processing"
      : voiceState === "responding" ? (responseText.slice(0, 40) || "Speaking")
      : "⌥⌘");

  return (
    <div className="di-root">
      <div className="di-zone" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} />
      <div
        className={`di ${expanded || isActive ? "di--visible" : ""}`}
        data-state={voiceState}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <span className="di__text">{label}</span>
        <span className="di__accent" data-state={voiceState} />
      </div>
    </div>
  );
}

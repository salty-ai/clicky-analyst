import { useCallback, useEffect, useRef, useState } from "react";
import type { GlideVoiceState } from "../settings/settingsTypes";
import { glideBridge } from "../../glideBridge";
import "./notchIsland.css";

function stateLabel(voiceState: GlideVoiceState) {
  switch (voiceState) {
    case "listening": return "Listening";
    case "processing": return "Thinking";
    case "responding": return "Speaking";
    default: return "Idle";
  }
}

export function NotchIsland() {
  const [voiceState, setVoiceState] = useState<GlideVoiceState>("idle");
  const [statusText, setStatusText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const collapseTimer = useRef<number | null>(null);

  useEffect(() => {
    const unsubVoice = glideBridge.app.onVoiceStateChanged((state) => {
      setVoiceState(state);
      if (state === "listening") glideBridge.notch.haptic();
    });
    const unsubStatus = glideBridge.notch.onStatus(setStatusText);
    return () => { unsubVoice?.(); unsubStatus?.(); };
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
    collapseTimer.current = null;
    setExpanded(true);
    glideBridge.notch.setIgnoreMouse(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    collapseTimer.current = window.setTimeout(() => {
      setExpanded(false);
      glideBridge.notch.setIgnoreMouse(true);
      collapseTimer.current = null;
    }, 300);
  }, []);

  const active = voiceState !== "idle";
  const label = statusText || stateLabel(voiceState);

  return (
    <div className="di-root">
      <div className="di-hover-zone" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} />
      <section
        className="di"
        data-state={voiceState}
        data-expanded={expanded}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <header className="di-header">
          {(expanded || active) ? <span className="di-label">{label}</span> : <span className="di-idle-dot" aria-hidden="true" />}
          {expanded ? <span className="di-brand">Glide</span> : null}
          {active ? <span className="di-state-icon" aria-hidden="true"><span /><span /><span /><span /><span /></span> : null}
        </header>
        {expanded ? (
          <div className="di-body">
            <div className="di-row"><span>⌘</span><p>Hold ⌃⌥ to talk</p></div>
            <div className="di-row"><span>⌁</span><p>Glide cursor</p><button type="button" aria-label="Glide cursor enabled" /></div>
            <button className="di-replay" type="button">Replay Onboarding</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

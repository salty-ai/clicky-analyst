import type { PiksyVoiceState } from "../settings/settingsTypes";

type CursorOverlayProps = {
  x: number;
  y: number;
  voiceState: PiksyVoiceState;
  visible: boolean;
  isCursorOnScreen?: boolean;
  bubbleText?: string;
  audioPowerLevel?: number;
  rotationDegrees?: number;
  scale?: number;
};

export function CursorOverlay({
  x,
  y,
  voiceState,
  visible,
  isCursorOnScreen = true,
  bubbleText,
  audioPowerLevel = 0.5,
  rotationDegrees = 0,
  scale = 1
}: CursorOverlayProps) {
  const transform = `translate(${x}px, ${y}px) rotate(${rotationDegrees}deg) scale(${scale})`;
  const opacity = visible && isCursorOnScreen ? 1 : 0;
  const bars = [0.45, 0.85, 0.6].map((scale, index) => (
    <span key={index} style={{ height: `${8 + audioPowerLevel * scale * 18}px` }} />
  ));

  return (
    <div className="cursor-overlay" aria-hidden="true">
      {bubbleText ? (
        <div className="cursor-bubble" style={{ transform: `translate(${x + 10}px, ${y + 18}px)`, opacity }}>
          {bubbleText}
        </div>
      ) : null}
      {voiceState === "listening" ? (
        <div className="waveform" style={{ transform, opacity }}>
          <div className="waveform-bars">{bars}</div>
        </div>
      ) : null}
      {voiceState === "processing" ? <div className="spinner" style={{ transform, opacity }} /> : null}
      {(voiceState === "idle" || voiceState === "responding") ? (
        <svg className="pink-cursor" viewBox="0 0 22 22" style={{ transform, opacity }}>
          <path
            d="M7.04 2.2 C7.28 1.94 7.7 1.95 7.96 2.19 L19.36 12.64 C19.78 13.03 19.53 13.74 18.96 13.8 L12.54 14.08 L9.66 20.24 C9.42 20.78 8.65 20.72 8.48 20.16 L5.72 4.84 C5.62 4.28 6.65 2.63 7.04 2.2 Z"
            fill="#F7A6C6"
          />
        </svg>
      ) : null}
    </div>
  );
}

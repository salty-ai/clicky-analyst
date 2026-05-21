type ResponseOverlayProps = {
  text: string;
  x: number;
  y: number;
  visible: boolean;
};

export function ResponseOverlay({ text, x, y, visible }: ResponseOverlayProps) {
  if (!visible) {
    return null;
  }

  if (text.length === 0) {
    return null;
  }

  return (
    <div className="response-overlay" style={{ transform: `translate(${x + 22}px, ${y + 6}px)` }}>
      {text}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import "./Fader.css";

interface Props {
  value: number; // 0.0 – 1.0
  onChange: (v: number) => void;
  onChangeEnd?: (v: number) => void;
  height?: number;
  label?: string;
  color?: string;
  disabled?: boolean;
}

/** Converte valor linear [0,1] → posição CSS em % (0% = fundo, 100% = topo). */
const valToPercent = (v: number) => v * 100;

/** Converte posição relativa ao trilho → valor linear [0,1]. */
const yToVal = (relY: number, trackH: number) =>
  Math.max(0, Math.min(1, 1 - relY / trackH));

/** Exibe dB: 0 dBFS = 1.0, -inf = 0. */
function formatDb(v: number): string {
  if (v <= 0) return "-∞";
  if (v >= 1) return "0";
  const db = 20 * Math.log10(v);
  return db.toFixed(1);
}

export function Fader({
  value,
  onChange,
  onChangeEnd,
  height = 110,
  label,
  color = "#4caf50",
  disabled = false,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const localRef = useRef(value);

  useEffect(() => {
    localRef.current = value;
  }, [value]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [disabled]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || disabled) return;
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const newVal = yToVal(relY, rect.height);
      localRef.current = newVal;
      onChange(newVal);
    },
    [dragging, disabled, onChange]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      setDragging(false);
      onChangeEnd?.(localRef.current);
    },
    [dragging, onChangeEnd]
  );

  const pct = valToPercent(value);

  return (
    <div className="fader-root" style={{ height }} title={`${formatDb(value)} dBFS`}>
      <div
        ref={trackRef}
        className="fader-track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Fill */}
        {/* Thumb */}
        <div
          className={`fader-thumb ${dragging ? "dragging" : ""}`}
          style={{
            bottom: `calc(${pct}% - 14px)`,
            cursor: disabled ? "not-allowed" : dragging ? "grabbing" : "grab",
            borderColor: color,
          }}
        >
          <span className="fader-db">{formatDb(value)}</span>
        </div>
      </div>
      {label && <span className="fader-label">{label}</span>}
    </div>
  );
}

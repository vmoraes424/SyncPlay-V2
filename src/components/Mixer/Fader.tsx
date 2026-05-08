import { useCallback, useEffect, useRef, useState } from "react";
import defaultThumb from "../../assets/vus/volume-thumb.png";

interface Props {
  value: number; // 0.0 – 1.0
  onChange: (v: number) => void;
  onChangeEnd?: (v: number) => void;
  height?: number;
  label?: string;
  color?: string;
  disabled?: boolean;
  /** Sprite do thumb (padrão: volume-thumb). */
  thumbSrc?: string;
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
  thumbSrc = defaultThumb,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const localRef = useRef(value);

  useEffect(() => {
    localRef.current = value;
  }, [value]);

  const applyLevelFromPointer = useCallback(
    (e: React.PointerEvent) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const newVal = yToVal(relY, rect.height);
      localRef.current = newVal;
      onChange(newVal);
    },
    [onChange]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      e.preventDefault();
      const track = trackRef.current;
      if (!track) return;
      track.setPointerCapture(e.pointerId);
      draggingRef.current = true;
      setDragging(true);
      applyLevelFromPointer(e);
    },
    [disabled, applyLevelFromPointer]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current || disabled) return;
      applyLevelFromPointer(e);
    },
    [disabled, applyLevelFromPointer]
  );

  const endGesture = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      try {
        trackRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* já liberado */
      }
      draggingRef.current = false;
      setDragging(false);
      onChangeEnd?.(localRef.current);
    },
    [onChangeEnd]
  );

  const pct = valToPercent(value);

  const thumbHalf = 14;

  return (
    <div
      className="flex min-h-0 w-min select-none flex-col items-center gap-1"
      style={{ height }}
      title={`${formatDb(value)} dBFS`}
    >
      <div
        ref={trackRef}
        className="relative isolate flex min-h-[40px] flex-1 cursor-pointer items-stretch justify-center after:pointer-events-none after:absolute after:top-0 after:bottom-0 after:left-1/2 after:z-1 after:h-full after:w-1 after:-translate-x-1/2 after:rounded-[5px] after:border after:border-[#333] after:bg-[#111]"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        <div
          className="absolute left-1/2 z-2 flex w-8 min-h-5 -translate-x-1/2 items-center justify-center overflow-visible border-0 bg-transparent p-0 shadow-none"
          style={{
            bottom: `calc(${pct}% - ${thumbHalf}px)`,
            cursor: disabled ? "not-allowed" : dragging ? "grabbing" : "grab",
            borderColor: color,
          }}
        >
          <img
            className={`pointer-events-none block h-auto max-h-8 w-full object-contain ${dragging ? "brightness-110" : ""}`}
            src={thumbSrc}
            alt=""
            draggable={false}
          />
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[8px] leading-none bg-[#aaa] text-black">
            {formatDb(value)}
          </span>
        </div>
      </div>
      {label ? (
        <span className="max-w-[50px] truncate text-center text-[9px] tracking-wide text-[#888] uppercase">{label}</span>
      ) : null}
    </div>
  );
}

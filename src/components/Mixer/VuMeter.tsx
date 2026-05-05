import { useEffect, useRef } from "react";
import { VuLevel } from "../../hooks/useMixer";

interface Props {
  level: VuLevel;
  height?: number;
  /** Largura de cada medidor (L e R têm um canvas próprio) */
  barWidth?: number;
  /** Espaço horizontal entre o VU L e o VU R */
  gap?: number;
}

const METER_GREEN = "#4caf50";
const METER_BG = "#0a0a0a";

/** Amplitude linear (pico ou RMS) → percentagem da barra (curva tipo dB perceptual). */
function amplitudeToPercent(linear: number): number {
  if (linear <= 0) return 0;
  const db = Math.max(-60, 20 * Math.log10(linear));
  return (db + 60) / 60;
}

function VuMeterSide({
  peak,
  height,
  barWidth,
  title,
}: {
  peak: number;
  height: number;
  barWidth: number;
  title: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = barWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${barWidth}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, barWidth, height);
    ctx.fillStyle = METER_BG;
    ctx.fillRect(0, 0, barWidth, height);

    const pct = amplitudeToPercent(peak);
    const barH = Math.max(0, pct * height);
    ctx.fillStyle = METER_GREEN;
    ctx.fillRect(0, height - barH, barWidth, barH);
  }, [peak, height, barWidth]);

  return (
    <canvas
      ref={canvasRef}
      title={title}
      role="img"
      aria-label={title}
      style={{ display: "block", borderRadius: 0 }}
    />
  );
}

/** Dois medidores independentes (L/R), cada um com seu próprio canvas. */
export function VuMeter({ level, height = 120, barWidth = 11, gap = 1 }: Props) {
  return (
    <div className="flex items-end" style={{ gap }}>
      <VuMeterSide
        peak={level.peak_left}
        height={height}
        barWidth={barWidth}
        title="VU canal esquerdo"
      />
      <VuMeterSide
        peak={level.peak_right}
        height={height}
        barWidth={barWidth}
        title="VU canal direito"
      />
    </div>
  );
}

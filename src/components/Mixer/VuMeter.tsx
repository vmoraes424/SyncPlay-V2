import { useEffect, useRef } from "react";
import { VuLevel } from "../../hooks/useMixer";

interface Props {
  level: VuLevel;
  height?: number;
  width?: number;
  /** Largura de cada barra (L ou R) em px */
  barWidth?: number;
}

// Gradiente: verde → amarelo → laranja → vermelho
const GRADIENT_STOPS: [number, string][] = [
  [0.0, "#1a7a1a"],
  [0.6, "#4caf50"],
  [0.75, "#cddc39"],
  [0.85, "#ff9800"],
  [0.95, "#f44336"],
  [1.0, "#b71c1c"],
];

function buildGradient(ctx: CanvasRenderingContext2D, height: number) {
  const g = ctx.createLinearGradient(0, height, 0, 0);
  for (const [stop, color] of GRADIENT_STOPS) {
    g.addColorStop(stop, color);
  }
  return g;
}

/** Converte RMS linear → percentagem da barra (curva perceptual logarítmica). */
function rmsToPercent(rms: number): number {
  if (rms <= 0) return 0;
  // dBFS: 20 * log10(rms), mapeado de -60 dB (fundo) a 0 dB (topo)
  const db = Math.max(-60, 20 * Math.log10(rms));
  return (db + 60) / 60;
}

export function VuMeter({ level, height = 120, width = 30, barWidth = 11 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, width, height);

    const gap = width - barWidth * 2;
    const xL = gap / 2;
    const xR = xL + barWidth + 1;

    const gradient = buildGradient(ctx, height);

    const drawBar = (x: number, rms: number, peak: number) => {
      const pct = rmsToPercent(rms);
      const barH = Math.max(0, pct * height);

      // Barra RMS
      ctx.fillStyle = gradient;
      ctx.fillRect(x, height - barH, barWidth, barH);

      // Marcações de segmentos (linhas separadoras escuras a cada 6 dB ~10% height)
      ctx.fillStyle = "#0a0a0a";
      for (let seg = 1; seg <= 9; seg++) {
        const y = height - seg * (height / 10);
        ctx.fillRect(x, y, barWidth, 1);
      }

      // Linha de pico
      const peakPct = rmsToPercent(peak);
      if (peakPct > 0) {
        const peakY = height - peakPct * height - 1;
        ctx.fillStyle = peakPct > 0.9 ? "#f44336" : "#ffffff";
        ctx.fillRect(x, Math.max(0, peakY), barWidth, 2);
      }
    };

    drawBar(xL, level.rms_left, level.peak_left);
    drawBar(xR, level.rms_right, level.peak_right);
  }, [level, height, width, barWidth]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block", borderRadius: 2 }}
    />
  );
}

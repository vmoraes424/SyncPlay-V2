import { useEffect, useRef } from "react";
import { VuLevel } from "../../hooks/useMixer";

interface Props {
  level: VuLevel;
  height?: number;
  barWidth?: number;
  gap?: number;
}

const METER_BG = "#0a0a0a";

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
  
  // O peak agora vem direto do Rust como uma porcentagem pronta (0.0 a 1.0)
  const targetPeakRef = useRef(0);
  const currentPeakRef = useRef(0);
  
  // Física da Linha de Retenção
  const holdPeakRef = useRef(0);
  const peakVelocityRef = useRef(0); 

  const animationRef = useRef<number>(null);

  useEffect(() => {
    targetPeakRef.current = peak;
  }, [peak]);

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

    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, "#4caf50"); 
    gradient.addColorStop(0.65, "#ffeb3b"); 
    gradient.addColorStop(1, "#f44336"); 

    const draw = () => {
      // Interpolação suave a 60FPS
      const diff = targetPeakRef.current - currentPeakRef.current;
      
      if (diff > 0) {
        currentPeakRef.current += diff * 0.7; // Sobe muito rápido
      } else {
        currentPeakRef.current += diff * 0.95; // Desce quase instantaneamente (mas sem travar)
      }

      // Gravidade da linha branca
      if (currentPeakRef.current >= holdPeakRef.current) {
        holdPeakRef.current = currentPeakRef.current;
        peakVelocityRef.current = 0; 
      } else {
        peakVelocityRef.current += 0.00035; // Aceleração G
        holdPeakRef.current -= peakVelocityRef.current;
        
        if (holdPeakRef.current < 0) {
          holdPeakRef.current = 0;
          peakVelocityRef.current = 0;
        }
      }

      ctx.clearRect(0, 0, barWidth, height);
      
      // Fundo escuro
      ctx.fillStyle = METER_BG;
      ctx.fillRect(0, 0, barWidth, height);

      // Barra de nível
      const barH = Math.max(0, currentPeakRef.current * height);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, height - barH, barWidth, barH);

      // Linha de pico retido
      const holdY = height - Math.max(0, holdPeakRef.current * height);
      ctx.fillStyle = "#ffffff"; 
      ctx.fillRect(0, Math.max(0, holdY - 1), barWidth, 2);

      animationRef.current = requestAnimationFrame(draw);
    };

    animationRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [height, barWidth]);

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

export function VuMeter({ level, height = 120, barWidth = 5, gap = 1 }: Props) {
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
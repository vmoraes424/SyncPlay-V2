import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";
import type { VuLevel } from "../../hooks/useMixer";
import { Fader } from "./Fader";
import { VuMeter } from "./VuMeter";

/** deltaY típico por “click” da rolagem (linha); deltaMode DOM_DELTA_LINE ≈ 120 no Windows/macOS. */
const WHEEL_LINE_PX = 120;
/** Quanto mover o ganho [0,1] por cada linha de rolagem. */
const WHEEL_GAIN_PER_LINE = 0.08;

function DbScale({ height }: { height: number }) {
  return (
    <div
      className="flex w-3 shrink-0 flex-col justify-between py-0.5 text-right text-[6px] font-semibold leading-none text-neutral-500 select-none"
      style={{ height }}
      aria-hidden
    >
      <span>0</span>
      <span>-20</span>
      <span>-40</span>
      <span>-∞</span>
    </div>
  );
}

export interface MixerStripTemplateProps {
  /** Conteúdo acima da faixa Fader + VU (ex.: selector de dispositivo no bus). */
  header?: ReactNode;
  faderValue: number;
  onFaderChange: (v: number) => void;
  faderColor: string;
  faderHeight?: number;
  faderThumbSrc?: string;
  faderDisabled?: boolean;
  vuLevel: VuLevel;
  vuBarWidth?: number;
  vuGap?: number;
  showDbScale?: boolean;
  muted: boolean;
  onMuteToggle: () => void;
  /** Ícone atual do mute (liga/desliga conforme `muted`). */
  muteIconSrc: string;
  muteButtonTitle?: string;
  label: string;
  className?: string;
  style?: CSSProperties;
  /** Sem borda/padding do cartão — uso dentro de ChannelStrip. */
  embed?: boolean;
}

/** Layout compartilhado: escala dB · fader · VU · mute · rótulo. */
export function MixerStripTemplate({
  header,
  faderValue,
  onFaderChange,
  faderColor,
  faderHeight = 120,
  faderThumbSrc,
  faderDisabled,
  vuLevel,
  vuBarWidth = 5,
  vuGap = 1,
  showDbScale = true,
  muted,
  onMuteToggle,
  muteIconSrc,
  muteButtonTitle = "Mute",
  label,
  className = "",
  style,
  embed = false,
}: MixerStripTemplateProps) {
  const chrome = embed ? "" : "border border-[#1a1a1a] p-2";

  const faderValueRef = useRef(faderValue);
  useEffect(() => {
    faderValueRef.current = faderValue;
  }, [faderValue]);

  const wheelAreaRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (faderDisabled) return;
      if (e.deltaY === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const v = faderValueRef.current;
      // deltaY > 0 = rolar “para baixo” → diminuir ganho (como puxar o fader para baixo).
      const deltaVal = (-e.deltaY / WHEEL_LINE_PX) * WHEEL_GAIN_PER_LINE;
      const next = Math.max(0, Math.min(1, v + deltaVal));
      if (Math.abs(next - v) > 1e-6) onFaderChange(next);
    },
    [faderDisabled, onFaderChange]
  );

  useEffect(() => {
    const el = wheelAreaRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  return (
    <div
      className={`box-border flex min-h-0 h-[270px] shrink-0 flex-col items-center gap-1.5 text-center transition-opacity ${chrome} ${className}`}
      style={style}
    >
      {header}

      <div
        ref={wheelAreaRef}
        className="flex w-full min-h-0 flex-1 flex-col items-center gap-1.5"
      >
        <div className="flex w-full shrink-0 flex-row items-end justify-center gap-1">
          {showDbScale ? <DbScale height={faderHeight} /> : null}
          <div className="flex shrink-0 flex-col items-center mr-2">
            <Fader
              value={faderValue}
              onChange={onFaderChange}
              height={faderHeight}
              color={faderColor}
              thumbSrc={faderThumbSrc}
              disabled={faderDisabled}
            />
          </div>
          <div className="shrink-0">
            <VuMeter level={vuLevel} height={faderHeight} barWidth={vuBarWidth} gap={vuGap} />
          </div>
        </div>

        <button
          type="button"
          className="mx-auto flex max-h-8 max-w-full cursor-pointer items-center justify-center rounded border border-[#222] bg-black/25 p-0.5 transition-[filter,transform] hover:brightness-110 active:scale-[0.97]"
          onClick={onMuteToggle}
          title={muteButtonTitle}
          aria-pressed={muted}
        >
          <img
            src={muteIconSrc}
            alt=""
            className="pointer-events-none block max-h-7 max-w-[72px] object-contain"
            draggable={false}
          />
        </button>

        <span className="max-w-full truncate text-[9px] font-semibold uppercase tracking-wide text-[#6e6e6e]">
          {label}
        </span>
      </div>
    </div>
  );
}

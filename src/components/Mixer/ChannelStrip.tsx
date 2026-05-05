import { useCallback } from "react";
import {
  ChannelGain,
  ChannelRouting,
  VuLevel,
} from "../../hooks/useMixer";
import { Fader } from "./Fader";
import { VuMeter } from "./VuMeter";

const CHANNEL_LABELS: Record<string, string> = {
  playlist: "Playlist",
  vem: "VEM",
  mic: "Mic",
  linein: "Line In",
};

const CHANNEL_COLORS: Record<string, string> = {
  playlist: "#4caf50",
  vem: "#ff9800",
  mic: "#f44336",
  linein: "#2196f3",
};

/** Base dos botões do strip (equivalente a `.channel-btn` legado). */
const BTN_BASE =
  "flex min-h-[18px] min-w-0 flex-1 items-center justify-center gap-0.5 rounded-sm border border-[#111] bg-linear-to-b from-[#555] to-[#333] px-0.5 py-0.5 font-[Arial,sans-serif] text-[9px] font-bold uppercase tracking-wide text-[#ccc] transition-[background,color,box-shadow] active:scale-[0.97] active:shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)]";

interface Props {
  channelId: string;
  gain: ChannelGain;
  routing: ChannelRouting;
  vuLevel: VuLevel;
  onSetGain: (v: number) => void;
  onSetMuted: (v: boolean) => void;
  onToggleMaster: () => void;
  onToggleMonitor: () => void;
  onToggleRetorno: () => void;
  onToggleOut: () => void;
}

export function ChannelStrip({
  channelId,
  gain,
  routing,
  vuLevel,
  onSetGain,
  onSetMuted,
  onToggleMaster,
  onToggleMonitor,
  onToggleRetorno,
  onToggleOut,
}: Props) {
  const label = CHANNEL_LABELS[channelId] ?? channelId;
  const color = CHANNEL_COLORS[channelId] ?? "#4caf50";
  /** Larguras tipo `.vu-vem1` / `.vu-microfone1` (90px) vs `.vu-block` padrão (70px). */
  const wideStrip = channelId === "vem" || channelId === "mic";

  const handleMuteToggle = useCallback(() => {
    onSetMuted(!gain.muted);
  }, [gain.muted, onSetMuted]);

  return (
    <div
      data-channel={channelId}
      className={`box-border flex min-h-0 shrink-0 flex-col items-center justify-between border border-[#1a1a1a] bg-[var(--secondary-gray,#262626)] p-2 text-center transition-opacity ${
        wideStrip ? "w-[90px] min-w-[90px]" : "w-[70px] min-w-[70px]"
      } ${gain.muted ? "opacity-50" : "opacity-100"}`}
    >
      {/* .vu-top-controls */}
      <div className="vu-top-controls flex w-full flex-col gap-1.5">
        <div className="flex w-full gap-[5px]">
          <button
            type="button"
            className={`${BTN_BASE} w-full flex-initial ${
              routing.out
                ? "bg-linear-to-b from-[#1a3a1a] to-[#0a2a0a] text-green-300"
                : ""
            }`}
            onClick={onToggleOut}
            title="Arm saída (placa). Desligado: só VU no fader, sem áudio no DAC."
          >
            <span
              className="size-2 shrink-0 rounded-full border border-black/40"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            OUT
          </button>
        </div>

        <button
          type="button"
          className={`${BTN_BASE} w-full flex-initial ${
            routing.master
              ? "bg-linear-to-b from-[#2a4a2a] to-[#1a3a1a] text-green-300"
              : ""
          }`}
          onClick={onToggleMaster}
          title="Rota Master (PGM)"
        >
          MASTER
        </button>

        <div className="bottom-buttons flex w-full gap-[5px]">
          <button
            type="button"
            className={`${BTN_BASE} ${
              routing.monitor
                ? "bg-linear-to-b from-[#3e2a10] to-[#2a1a08] text-[#d2952f]"
                : ""
            }`}
            onClick={onToggleMonitor}
            title="Rota Monitor"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width={12} height={12} aria-hidden>
              <path d="M3 2a1 1 0 00-1 1v8a1 1 0 001 1h4v2H5v1h6v-1H9v-2h4a1 1 0 001-1V3a1 1 0 00-1-1H3zm0 1h10v8H3V3z" />
            </svg>
          </button>

          <button
            type="button"
            className={`${BTN_BASE} ${
              routing.retorno
                ? "bg-linear-to-b from-[#2a3a3a] to-[#1a2a2a] text-white"
                : ""
            }`}
            onClick={onToggleRetorno}
            title="Retorno (fone)"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width={12} height={12} aria-hidden>
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM3 8a5 5 0 0110 0h-1.5A3.5 3.5 0 004.5 8H3zm1 0a4 4 0 018 0h-2a2 2 0 00-4 0H4z" />
            </svg>
          </button>
        </div>
      </div>

      {/* .vu-channels — escala dB + fader (.volume-vu) + medidor (.vu-box) */}
      <div className="vu-channels vu-out flex min-h-0 w-full flex-1 flex-row items-end justify-center gap-1">
        <div
          className="vu-db-scale flex h-[120px] w-3 shrink-0 select-none flex-col justify-between py-0.5 text-right text-[6px] font-semibold leading-none text-neutral-500"
          aria-hidden
        >
          <span>0</span>
          <span>-20</span>
          <span>-40</span>
          <span>-∞</span>
        </div>

        <div className="volume-vu shrink-0">
          <Fader value={gain.value} onChange={onSetGain} height={120} color={color} />
        </div>

        <div className="vu-box shrink-0">
          <VuMeter level={vuLevel} height={120} barWidth={11} gap={1} />
        </div>
      </div>

      {/* .vu-buttons — mute + rótulo */}
      <div className="vu-buttons flex w-full flex-col items-center gap-1.5">
        <button
          type="button"
          className={`${BTN_BASE} size-7 max-h-7 max-w-7 min-h-0 flex-none rounded-md p-0 ${
            gain.muted
              ? "bg-linear-to-b from-[#3a1a1a] to-[#2a0a0a] text-[#f44336]"
              : ""
          }`}
          onClick={handleMuteToggle}
          title="Mute"
        >
          M
        </button>
        <span
          className="max-w-full truncate text-[9px] font-semibold uppercase tracking-wide"
          style={{ color }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

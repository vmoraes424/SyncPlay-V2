import { useCallback } from "react";
import vemMute from "../../assets/vus/vem-off.png";
import vem from "../../assets/vus/vem.png";
import vuLineMuted from "../../assets/vus/volume-line-off.png";
import vuLine from "../../assets/vus/volume-line.png";
import vuMicMuted from "../../assets/vus/volume-mic-off.png";
import vuMic from "../../assets/vus/volume-mic.png";
import vuOnAirOff from "../../assets/vus/volume-onair-off.png";
import vuOnAir from "../../assets/vus/volume-onair.png";
import {
  ChannelGain,
  ChannelRouting,
  VuLevel,
  type ChannelId,
} from "../../hooks/useMixer";
import { MixerStripTemplate } from "./MixerStripTemplate";

const FALLBACK_MUTE = { on: vuLine, off: vuLineMuted };

/** Ícones só do botão mute (thumb do fader é sempre volume-thumb). */
const CHANNEL_MUTE_ICONS: Partial<Record<ChannelId, { on: string; off: string }>> = {
  playlist: { on: vuOnAir, off: vuOnAirOff },
  vem: { on: vem, off: vemMute },
  mic: { on: vuMic, off: vuMicMuted },
  linein: { on: vuLine, off: vuLineMuted },
};

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

const BTN_BASE =
  "flex min-h-[18px] min-w-0 flex-1 items-center justify-center gap-0.5 rounded-xs border border-[#111] bg-linear-to-b from-[#555] to-[#333] px-0.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[#2c2c2c] transition-[background,color,box-shadow] active:scale-[0.97] active:shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)]";

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
  const labelColor = CHANNEL_COLORS[channelId] ?? "#4caf50";

  /** Larguras tipo `.vu-vem1` / `.vu-microfone1` (90px) vs padrão (70px). */
  const wideStrip = channelId === "vem" || channelId === "mic";

  const muteIcons = CHANNEL_MUTE_ICONS[channelId as ChannelId] ?? FALLBACK_MUTE;
  const muteIconSrc = gain.muted ? muteIcons.off : muteIcons.on;

  const muteButtonTitle =
    channelId === "playlist"
      ? gain.muted
        ? "Fora do ar"
        : "On Air"
      : gain.muted
        ? "Unmute"
        : "Mute";

  const handleMuteToggle = useCallback(() => {
    onSetMuted(!gain.muted);
  }, [gain.muted, onSetMuted]);

  return (
    <div
      data-channel={channelId}
      className={`box-border flex min-h-0 shrink-0 flex-col items-center justify-between border border-[#1a1a1a] bg-(--secondary-gray,#353535) p-2 text-center transition-opacity ${
        wideStrip ? "w-[90px] min-w-[90px]" : "w-[70px] min-w-[70px]"
      }`}
    >
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
              style={{ backgroundColor: labelColor }}
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

      <MixerStripTemplate
        embed
        className="vu-channels vu-out mt-1 w-full min-h-0 flex-1 justify-end"
        faderValue={gain.value}
        onFaderChange={onSetGain}
        faderColor={labelColor}
        faderHeight={120}
        vuLevel={vuLevel}
        vuBarWidth={5}
        vuGap={1}
        muted={gain.muted}
        onMuteToggle={handleMuteToggle}
        muteIconSrc={muteIconSrc}
        muteButtonTitle={muteButtonTitle}
        label={label}
      />
    </div>
  );
}

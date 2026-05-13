import { useCallback } from "react";
import vemMute from "../../assets/vus/vem-off.png";
import vem from "../../assets/vus/vem.png";
import vuLineMuted from "../../assets/vus/volume-line-off.png";
import vuLine from "../../assets/vus/volume-line.png";
import vuMicMuted from "../../assets/vus/volume-mic-off.png";
import vuMic from "../../assets/vus/volume-mic.png";
import vuOnAirOff from "../../assets/vus/volume-onair-off.png";
import vuOnAir from "../../assets/vus/volume-onair.png";
import vuCueMuted from "../../assets/vus/volume-cue-off.png";
import vuCue from "../../assets/vus/volume-cue.png";
import vuIntroChorus from "../../assets/vus/volume-introChorus.png";
import vuIntroChorusOff from "../../assets/vus/volume-introChorus-off.png";
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
  intro_chorus: { on: vuIntroChorus, off: vuIntroChorusOff },
  vem: { on: vem, off: vemMute },
  mic: { on: vuMic, off: vuMicMuted },
  linein: { on: vuLine, off: vuLineMuted },
  cue: { on: vuCue, off: vuCueMuted },
};

const CHANNEL_LABELS: Record<string, string> = {
  playlist: "Playlist",
  intro_chorus: "REFRÃO",
  vem: "V.E.M.",
  mic: "Mic",
  linein: "Line In",
  cue: "CUE",
};

const CHANNEL_COLORS: Record<string, string> = {
  playlist: "#4caf50",
  intro_chorus: "#43a035",
  vem: "#ff9800",
  mic: "#f44336",
  linein: "#2196f3",
  cue: "#9c27b0",
};

const BTN_BASE =
  "flex min-h-[18px] min-w-0 flex-1 items-center justify-center gap-0.5 rounded-xs border border-[#111] cursor-pointer bg-linear-to-b from-[#555] to-[#333] px-0.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[#2c2c2c] transition-[background,color,box-shadow] active:scale-[0.97] active:shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)]";

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
  const label = CHANNEL_LABELS[channelId] ?? channelId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const labelColor = CHANNEL_COLORS[channelId] ?? "#9e9e9e";

  /** Larguras tipo `.vu-vem1` / `.vu-microfone1` (90px) vs padrão (70px). */
  const wideStrip = channelId === "vem" || channelId === "mic";

  const muteIcons = CHANNEL_MUTE_ICONS[channelId as ChannelId] ?? FALLBACK_MUTE;
  const muteIconSrc = gain.muted ? muteIcons.off : muteIcons.on;

  const muteButtonTitle =
    channelId === "playlist"
      ? gain.muted
        ? "Fora do ar"
        : "On Air"
      : channelId === "intro_chorus"
        ? gain.muted
          ? "Unmute refrão / intro"
          : "Mute refrão / intro"
        : gain.muted
          ? "Unmute"
          : "Mute";

  const handleMuteToggle = useCallback(() => {
    onSetMuted(!gain.muted);
  }, [gain.muted, onSetMuted]);

  return (
    <div
      data-channel={channelId}
      className={`box-border flex min-h-0 shrink-0 flex-col items-center justify-between border border-[#1a1a1a] bg-(--secondary-gray,#353535) p-2 text-center transition-opacity ${wideStrip ? "w-[90px] min-w-[90px]" : "w-[60px] min-w-[60px]"
        }`}
    >
      <div className="vu-top-controls flex w-full flex-col gap-1.5">
        <div className="flex w-full gap-[5px]">
          <button
            type="button"
            className={`${BTN_BASE} w-full flex-initial ${routing.out
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
          className={`${BTN_BASE} w-full flex-initial ${routing.master
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
            className={`${BTN_BASE} ${routing.monitor
              ? "bg-linear-to-b from-[#3e2a10] to-[#2a1a08] text-[#d2952f]"
              : ""
              }`}
            onClick={onToggleMonitor}
            title="Rota Monitor"
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px"
              fill="currentColor">
              <path
                d="M680-80H280q-33 0-56.5-23.5T200-160v-640q0-33 23.5-56.5T280-880h400q33 0 56.5 23.5T760-800v640q0 33-23.5 56.5T680-80Zm0-80v-640H280v640h400ZM480-600q33 0 56.5-23.5T560-680q0-33-23.5-56.5T480-760q-33 0-56.5 23.5T400-680q0 33 23.5 56.5T480-600Zm0 400q66 0 113-47t47-113q0-66-47-113t-113-47q-66 0-113 47t-47 113q0 66 47 113t113 47Zm0-80q-33 0-56.5-23.5T400-360q0-33 23.5-56.5T480-440q33 0 56.5 23.5T560-360q0 33-23.5 56.5T480-280ZM280-800v640-640Z" />
            </svg>
          </button>

          <button
            type="button"
            className={`${BTN_BASE} ${routing.retorno
              ? "bg-linear-to-b from-[#2a3a3a] to-[#1a2a2a] text-white"
              : ""
              }`}
            onClick={onToggleRetorno}
            title="Retorno (fone)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px"
              fill="currentColor">
              <path
                d="M240-80q62 0 101.5-31t60.5-91q17-50 32.5-70t71.5-64q62-50 98-113t36-151q0-119-80.5-199.5T360-880q-119 0-199.5 80.5T80-600h80q0-85 57.5-142.5T360-800q85 0 142.5 57.5T560-600q0 68-27 116t-77 86q-52 38-81 74t-43 78q-14 44-33.5 65T240-160q-33 0-56.5-23.5T160-240H80q0 66 47 113t113 47Zm120-420q42 0 71-29.5t29-70.5q0-42-29-71t-71-29q-42 0-71 29t-29 71q0 41 29 70.5t71 29.5Zm380 121-59-59q19-37 29-77.5t10-84.5q0-44-10-84t-29-77l59-59q29 49 44.5 104.5T800-600q0 61-15.5 116.5T740-379Zm117 116-59-58q39-60 60.5-130T880-598q0-78-22-148.5T797-877l60-60q49 72 76 157.5T960-600q0 94-27 179.5T857-263Z" />
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

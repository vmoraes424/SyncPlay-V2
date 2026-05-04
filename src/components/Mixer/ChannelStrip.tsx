import { useCallback } from "react";
import {
  ChannelGain,
  ChannelRouting,
  VuLevel,
} from "../../hooks/useMixer";
import { Fader } from "./Fader";
import { VuMeter } from "./VuMeter";
import "./ChannelStrip.css";

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

interface Props {
  channelId: string;
  gain: ChannelGain;
  routing: ChannelRouting;
  vuLevel: VuLevel;
  onSetGain: (v: number) => void;
  onSetMuted: (v: boolean) => void;
  onToggleMaster: () => void;
  onToggleMonitor: () => void;
  onToggleFone: () => void;
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
  onToggleFone,
  onToggleOut,
}: Props) {
  const label = CHANNEL_LABELS[channelId] ?? channelId;
  const color = CHANNEL_COLORS[channelId] ?? "#4caf50";

  const handleMuteToggle = useCallback(() => {
    onSetMuted(!gain.muted);
  }, [gain.muted, onSetMuted]);

  return (
    <div className={`channel-strip ${gain.muted ? "channel-strip--muted" : ""}`}>
      {/* Cabeçalho com label e mute */}
      <div className="channel-strip__header">
        <span className="channel-strip__label" style={{ color }}>
          {label}
        </span>
        <button
          className={`channel-btn channel-btn--mute ${gain.muted ? "active" : ""}`}
          onClick={handleMuteToggle}
          title="Mute"
        >
          M
        </button>
      </div>

      {/* VU + Fader lado a lado */}
      <div className="channel-strip__av">
        <VuMeter level={vuLevel} height={120} width={28} barWidth={11} />
        <Fader
          value={gain.value}
          onChange={onSetGain}
          height={120}
          color={color}
        />
      </div>

      {/* Botões de roteamento */}
      <div className="channel-strip__routes">
        <button
          className={`channel-btn channel-btn--master ${routing.master ? "active" : ""}`}
          onClick={onToggleMaster}
          title="Rota Master (PGM)"
        >
          MASTER
        </button>

        <div className="channel-strip__routes-row">
          <button
            className={`channel-btn channel-btn--monitor ${routing.monitor ? "active" : ""}`}
            onClick={onToggleMonitor}
            title="Rota Monitor"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width={12} height={12}>
              <path d="M3 2a1 1 0 00-1 1v8a1 1 0 001 1h4v2H5v1h6v-1H9v-2h4a1 1 0 001-1V3a1 1 0 00-1-1H3zm0 1h10v8H3V3z" />
            </svg>
          </button>

          <button
            className={`channel-btn channel-btn--fone ${routing.fone ? "active" : ""}`}
            onClick={onToggleFone}
            title="Retorno (Fone)"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width={12} height={12}>
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM3 8a5 5 0 0110 0h-1.5A3.5 3.5 0 004.5 8H3zm1 0a4 4 0 018 0h-2a2 2 0 00-4 0H4z" />
            </svg>
          </button>
        </div>

        <button
          className={`channel-btn channel-btn--out ${routing.out ? "active" : ""}`}
          onClick={onToggleOut}
          title="Saída dedicada (OUT)"
        >
          OUT
        </button>
      </div>
    </div>
  );
}

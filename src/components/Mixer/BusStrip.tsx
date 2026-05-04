import { useCallback } from "react";
import { AudioDevice, BusConfig, VuLevel } from "../../hooks/useMixer";
import { Fader } from "./Fader";
import { VuMeter } from "./VuMeter";
import "./BusStrip.css";

const BUS_LABELS: Record<string, string> = {
  master: "Master",
  monitor: "Monitor",
  fone: "Retorno",
};

const BUS_COLORS: Record<string, string> = {
  master: "#4caf50",
  monitor: "#ff9800",
  fone: "#80cbc4",
};

const BUS_BG: Record<string, string> = {
  master: "#1a2e1a",
  monitor: "#2e1e0a",
  fone: "#0e2020",
};

interface Props {
  busId: "master" | "monitor" | "fone";
  config: BusConfig;
  vuLevel: VuLevel;
  devices: AudioDevice[];
  onSetGain: (v: number) => void;
  onSetMuted: (v: boolean) => void;
  onSetDevice: (id: string | null) => void;
}

export function BusStrip({
  busId,
  config,
  vuLevel,
  devices,
  onSetGain,
  onSetMuted,
  onSetDevice,
}: Props) {
  const label = BUS_LABELS[busId] ?? busId;
  const color = BUS_COLORS[busId] ?? "#4caf50";
  const bg = BUS_BG[busId] ?? "#1a1a1a";

  const handleMuteToggle = useCallback(() => {
    onSetMuted(!config.muted);
  }, [config.muted, onSetMuted]);

  const handleDeviceChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      onSetDevice(val === "default" ? null : val);
    },
    [onSetDevice]
  );

  const currentDevice = config.device_id ?? "default";

  return (
    <div className={`bus-strip ${config.muted ? "bus-strip--muted" : ""}`} style={{ background: bg }}>
      {/* Cabeçalho */}
      <div className="bus-strip__header">
        <span className="bus-strip__label" style={{ color }}>
          {label}
        </span>
        <button
          className={`channel-btn channel-btn--mute ${config.muted ? "active" : ""}`}
          onClick={handleMuteToggle}
          title="Mute"
        >
          M
        </button>
      </div>

      {/* VU + Fader */}
      <div className="bus-strip__av">
        <VuMeter level={vuLevel} height={120} width={30} barWidth={12} />
        <Fader
          value={config.gain}
          onChange={onSetGain}
          height={120}
          color={color}
          label="GAIN"
        />
      </div>

      {/* Seletor de dispositivo */}
      <select
        className="bus-strip__device-select"
        value={currentDevice}
        onChange={handleDeviceChange}
        title="Dispositivo de saída"
      >
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </div>
  );
}

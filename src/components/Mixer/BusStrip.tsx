import { useCallback } from "react";
import vuMasterMuted from "../../assets/vus/master-off.png";
import vuMaster from "../../assets/vus/master.png";
import vuMonitorMuted from "../../assets/vus/volume-monitor-off.png";
import vuMonitor from "../../assets/vus/volume-monitor.png";
import vuFoneMuted from "../../assets/vus/volume-fone-off.png";
import vuFone from "../../assets/vus/volume-fone.png";
import { AudioDevice, BusConfig, VuLevel, type BusId } from "../../hooks/useMixer";
import { MixerStripTemplate } from "./MixerStripTemplate";

const BUS_LABELS: Record<string, string> = {
  retorno: "Retorno",
  monitor: "Monitor",
  master: "Master",
};

const BUS_LABEL_COLORS: Record<string, string> = {
  retorno: "#80cbc4",
  monitor: "#ff9800",
  master: "#4caf50",
};

const BUS_BG: Record<string, string> = {
  retorno: "#0e2020",
  monitor: "#2e1e0a",
  master: "#1a2e1a",
};

const BUS_LABEL_ICONS: Record<BusId, { on: string; off: string }> = {
  retorno: { on: vuFone, off: vuFoneMuted },
  monitor: { on: vuMonitor, off: vuMonitorMuted },
  master: { on: vuMaster, off: vuMasterMuted },
};

interface Props {
  busId: "retorno" | "monitor" | "master";
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
  const labelColor = BUS_LABEL_COLORS[busId] ?? "#4caf50";
  const faderColor = labelColor;
  const bg = BUS_BG[busId] ?? "#1a1a1a";
  const labelIcons = BUS_LABEL_ICONS[busId];
  const muteIconSrc = config.muted ? labelIcons.off : labelIcons.on;

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

  const header = (
    <select
      className="w-full cursor-pointer truncate rounded border border-[#333] bg-[#0a0a0a] px-1 py-0.5 text-[8px] text-[#888] focus:border-[#555] focus:text-[#ccc] focus:outline-none"
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
  );

  return (
    <MixerStripTemplate
      header={header}
      className="w-[78px] min-w-[78px] shrink-0"
      style={{ background: bg }}
      faderValue={config.gain}
      onFaderChange={onSetGain}
      faderColor={faderColor}
      vuLevel={vuLevel}
      vuBarWidth={5}
      vuGap={1}
      muted={config.muted}
      onMuteToggle={handleMuteToggle}
      muteIconSrc={muteIconSrc}
      muteButtonTitle={config.muted ? "Unmute" : "Mute"}
      label={label}
    />
  );
}

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
    <div className="flex flex-col w-full gap-1">
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
      <button
        type="button"
        className="flex min-h-[18px] min-w-0 flex-1 items-center justify-center gap-0.5 rounded-xs border border-[#111] cursor-pointer bg-linear-to-b from-[#555] to-[#333] px-0.5 py-0.3 text-[11px] font-bold uppercase tracking-wide text-[#2c2c2c] transition-[background,color,box-shadow] active:scale-[0.97] active:shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)]" 
        title="Arm saída (placa). Desligado: só VU no fader, sem áudio no DAC."
      >
        OUT
      </button>
      <button
        type="button"
        className="flex min-h-[18px] min-w-0 flex-1 items-center justify-center gap-0.5 rounded-xs border border-[#111] cursor-pointer bg-linear-to-b from-[#555] to-[#333] px-0.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[#2c2c2c] transition-[background,color,box-shadow] active:scale-[0.97] active:shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)]"
        title="FX"
      >
        <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px"
          fill="#2c2c2c">
          <path
            d="M384-240v-72h70l99-120-99-120h-55l-64 322q-8 39-35.5 62.5T237-144q-39 0-66-26.5T144-232q0-24 14-40t36-16q20 0 33 12.5t13 31.5q0 6-1.5 13t-4.5 14q2 1 3 1h3q10 0 15.5-7t8.5-21l62-308h-86v-72h100l21-106q8-39 35.5-62.5T459-816q39 0 66 26.5t27 61.5q0 24-14 40t-36 16q-20 0-33-12.5T456-716q0-6 1.5-13t4.5-14q-2-1-3-1h-3q-10 0-15.5 7t-8.5 21l-19 92h163v72h-29l53 64 53-64h-29v-72h192v72h-69L647-432l100 120h69v72H624v-72h29l-53-64-53 64h29v72H384Z" />
        </svg>
      </button>
    </div>
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

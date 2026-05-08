import { BUSES, CHANNELS, useMixer } from "../../hooks/useMixer";
import { BusStrip } from "./BusStrip";
import { ChannelStrip } from "./ChannelStrip";

export function MixerPanel() {
  const {
    routing,
    devices,
    getChannelGain,
    getChannelRouting,
    getVuLevel,
    getBusConfig,
    setChannelGain,
    setChannelMuted,
    toggleMasterRoute,
    toggleMonitorRoute,
    toggleRetornoRoute,
    toggleOutRoute,
    setBusGain,
    setBusMuted,
    setBusDevice,
  } = useMixer();

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md bg-[#161616]">
      <div
        className="flex flex-1 flex-row items-start gap-0 overflow-y-hidden overflow-x-auto [scrollbar-color:#333_#111] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-[3px] [&::-webkit-scrollbar-thumb]:bg-[#333] [&::-webkit-scrollbar-track]:bg-[#111] [&::-webkit-scrollbar]:h-[6px]"
      >
        {/* Canais de entrada */}
        <div className="flex shrink-0 flex-row">
          {Object.keys(routing.channels)
            .sort((a, b) => {
              const idxA = CHANNELS.indexOf(a as any);
              const idxB = CHANNELS.indexOf(b as any);
              if (idxA !== -1 && idxB !== -1) return idxA - idxB;
              if (idxA !== -1) return -1;
              if (idxB !== -1) return 1;
              return a.localeCompare(b);
            })
            .map((ch) => (
            <ChannelStrip
              key={ch}
              channelId={ch}
              gain={getChannelGain(ch)}
              routing={getChannelRouting(ch)}
              vuLevel={getVuLevel(ch)}
              onSetGain={(v) => setChannelGain(ch, v)}
              onSetMuted={(v) => setChannelMuted(ch, v)}
              onToggleMaster={() => toggleMasterRoute(ch)}
              onToggleMonitor={() => toggleMonitorRoute(ch)}
              onToggleRetorno={() => toggleRetornoRoute(ch)}
              onToggleOut={() => toggleOutRoute(ch)}
            />
          ))}
        </div>

        {/* Buses de saída */}
        <div className="flex shrink-0 flex-row">
          {BUSES.map((bus) => (
            <BusStrip
              key={bus}
              busId={bus}
              config={getBusConfig(bus)}
              vuLevel={getVuLevel(bus)}
              devices={devices}
              onSetGain={(v) => setBusGain(bus, v)}
              onSetMuted={(v) => setBusMuted(bus, v)}
              onSetDevice={(id) => setBusDevice(bus, id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

import { BUSES, CHANNELS, useMixer } from "../../hooks/useMixer";
import { BusStrip } from "./BusStrip";
import { ChannelStrip } from "./ChannelStrip";
import "./MixerPanel.css";

export function MixerPanel() {
  const {
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
    <div className="mixer-panel">
      <div className="mixer-panel__title">
        <span>MIXER</span>
      </div>

      <div className="mixer-panel__body">
        {/* Canais de entrada */}
        <div className="mixer-panel__channels">
          {CHANNELS.map((ch) => (
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

        {/* Separador */}
        <div className="mixer-panel__sep" />

        {/* Buses de saída */}
        <div className="mixer-panel__buses">
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

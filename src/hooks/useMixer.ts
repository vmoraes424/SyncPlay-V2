import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Tipos (espelham os modelos Rust)
// ---------------------------------------------------------------------------

export interface ChannelGain {
  value: number; // 0.0 – 1.0
  muted: boolean;
}

export interface ChannelRouting {
  master: boolean;
  monitor: boolean;
  retorno: boolean;
  out: boolean;
  out_device_id: string | null;
}

export interface BusConfig {
  gain: number;
  muted: boolean;
  device_id: string | null;
}

export interface VuLevel {
  rms_left: number;
  rms_right: number;
  peak_left: number;
  peak_right: number;
}

export interface MixerRouting {
  channels: Record<string, ChannelGain>;
  routing: Record<string, ChannelRouting>;
  master: BusConfig;
  monitor: BusConfig;
  retorno: BusConfig;
}

export interface MixerTickPayload extends MixerRouting {
  levels: Record<string, VuLevel>;
}

export interface AudioDevice {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_BUS: BusConfig = { gain: 1, muted: false, device_id: null };
const DEFAULT_CHANNEL: ChannelGain = { value: 1, muted: false };
const DEFAULT_ROUTING: ChannelRouting = {
  master: true,
  monitor: true,
  retorno: true,
  out: false,
  out_device_id: null,
};
const DEFAULT_VU: VuLevel = {
  rms_left: 0,
  rms_right: 0,
  peak_left: 0,
  peak_right: 0,
};

export const CHANNELS = ["playlist", "vem", "mic", "linein"] as const;
export const BUSES = ["master", "monitor", "retorno"] as const;

export type ChannelId = (typeof CHANNELS)[number];
export type BusId = (typeof BUSES)[number];

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMixer() {
  const [routing, setRouting] = useState<MixerRouting>({
    channels: Object.fromEntries(CHANNELS.map((c) => [c, { ...DEFAULT_CHANNEL }])),
    routing: Object.fromEntries(CHANNELS.map((c) => [c, { ...DEFAULT_ROUTING }])),
    master: { ...DEFAULT_BUS },
    monitor: { ...DEFAULT_BUS },
    retorno: { ...DEFAULT_BUS },
  });

  const [vuLevels, setVuLevels] = useState<Record<string, VuLevel>>(
    Object.fromEntries([...CHANNELS, ...BUSES].map((k) => [k, { ...DEFAULT_VU }]))
  );

  const [devices, setDevices] = useState<AudioDevice[]>([]);

  // Ref para evitar re-subscribe a cada render
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // ------------------------------------------------------------------
  // Carrega estado inicial e lista dispositivos
  // ------------------------------------------------------------------
  useEffect(() => {
    invoke<MixerRouting>("get_mixer_state").then(setRouting).catch(console.error);
    invoke<AudioDevice[]>("list_audio_devices_cmd").then(setDevices).catch(console.error);
  }, []);

  // ------------------------------------------------------------------
  // Escuta evento mixer:tick com VU levels + estado
  // ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    listen<MixerTickPayload>("mixer:tick", (event) => {
      if (cancelled) return;
      const raw = event.payload as MixerTickPayload & { fone?: BusConfig };
      const { levels, ...rest } = raw;
      const merged: MixerRouting = {
        ...rest,
        retorno: rest.retorno ?? raw.fone ?? { ...DEFAULT_BUS },
      };
      setVuLevels((prev) => ({ ...prev, ...levels }));
      setRouting(merged);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenRef.current = unlisten;
      }
    });

    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  // ------------------------------------------------------------------
  // Ações do canal
  // ------------------------------------------------------------------

  const setChannelGain = useCallback((channel: string, value: number) => {
    invoke("set_channel_gain", { channel, value }).catch(console.error);
  }, []);

  const setChannelMuted = useCallback((channel: string, muted: boolean) => {
    invoke("set_channel_muted", { channel, muted }).catch(console.error);
  }, []);

  const toggleMasterRoute = useCallback((channel: string) => {
    invoke("toggle_master_route", { channel }).catch(console.error);
  }, []);

  const toggleMonitorRoute = useCallback((channel: string) => {
    invoke("toggle_monitor_route", { channel }).catch(console.error);
  }, []);

  const toggleRetornoRoute = useCallback((channel: string) => {
    invoke("toggle_retorno_route", { channel }).catch(console.error);
  }, []);

  const toggleOutRoute = useCallback((channel: string) => {
    invoke("toggle_out_route", { channel }).catch(console.error);
  }, []);

  // ------------------------------------------------------------------
  // Ações do bus
  // ------------------------------------------------------------------

  const setBusGain = useCallback((bus: string, value: number) => {
    invoke("set_bus_gain", { bus, value }).catch(console.error);
  }, []);

  const setBusMuted = useCallback((bus: string, muted: boolean) => {
    invoke("set_bus_muted", { bus, muted }).catch(console.error);
  }, []);

  const setBusDevice = useCallback((bus: string, deviceId: string | null) => {
    invoke("set_bus_device", { bus, device_id: deviceId }).catch(console.error);
  }, []);

  // ------------------------------------------------------------------
  // Getters com defaults
  // ------------------------------------------------------------------

  const getChannelGain = useCallback(
    (ch: string): ChannelGain =>
      routing.channels[ch] ?? { ...DEFAULT_CHANNEL },
    [routing.channels]
  );

  const getChannelRouting = useCallback(
    (ch: string): ChannelRouting =>
      routing.routing[ch] ?? { ...DEFAULT_ROUTING },
    [routing.routing]
  );

  const getBusConfig = useCallback(
    (bus: "master" | "monitor" | "retorno"): BusConfig =>
      routing[bus] ?? { ...DEFAULT_BUS },
    [routing]
  );

  const getVuLevel = useCallback(
    (ch: string): VuLevel => vuLevels[ch] ?? { ...DEFAULT_VU },
    [vuLevels]
  );

  return {
    routing,
    vuLevels,
    devices,
    // Canal
    getChannelGain,
    getChannelRouting,
    setChannelGain,
    setChannelMuted,
    toggleMasterRoute,
    toggleMonitorRoute,
    toggleRetornoRoute,
    toggleOutRoute,
    // Bus
    getBusConfig,
    setBusGain,
    setBusMuted,
    setBusDevice,
    // VU
    getVuLevel,
  };
}

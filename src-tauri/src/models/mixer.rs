use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Canais de entrada do mixer (fontes de áudio)
pub const CHANNEL_PLAYLIST: &str = "playlist";
pub const CHANNEL_VEM: &str = "vem";
pub const CHANNEL_MIC: &str = "mic";
pub const CHANNEL_LINEIN: &str = "linein";

/// Buses de saída
pub const BUS_MASTER: &str = "master";
pub const BUS_MONITOR: &str = "monitor";
pub const BUS_FONE: &str = "fone";

// ---------------------------------------------------------------------------
// Tipos básicos
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelGain {
    /// 0.0 – 1.0 (linear; 1.0 = 0 dBFS)
    pub value: f32,
    pub muted: bool,
}

impl Default for ChannelGain {
    fn default() -> Self {
        Self {
            value: 1.0,
            muted: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelRouting {
    pub master: bool,
    pub monitor: bool,
    pub fone: bool,
    pub out: bool,
    pub out_device_id: Option<String>,
}

impl Default for ChannelRouting {
    fn default() -> Self {
        Self {
            master: true,
            monitor: false,
            fone: false,
            out: false,
            out_device_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusConfig {
    /// 0.0 – 1.0
    pub gain: f32,
    pub muted: bool,
    /// None = dispositivo padrão do sistema
    pub device_id: Option<String>,
}

impl Default for BusConfig {
    fn default() -> Self {
        Self {
            gain: 1.0,
            muted: false,
            device_id: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Estado completo de roteamento (persistido em disco)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MixerRouting {
    pub channels: HashMap<String, ChannelGain>,
    pub routing: HashMap<String, ChannelRouting>,
    pub master: BusConfig,
    pub monitor: BusConfig,
    pub fone: BusConfig,
}

impl Default for MixerRouting {
    fn default() -> Self {
        let channels = [
            CHANNEL_PLAYLIST,
            CHANNEL_VEM,
            CHANNEL_MIC,
            CHANNEL_LINEIN,
        ]
        .iter()
        .map(|k| (k.to_string(), ChannelGain::default()))
        .collect();

        let routing = [
            (
                CHANNEL_PLAYLIST,
                ChannelRouting {
                    master: true,
                    monitor: true,
                    fone: false,
                    out: false,
                    out_device_id: None,
                },
            ),
            (
                CHANNEL_VEM,
                ChannelRouting {
                    master: true,
                    monitor: false,
                    fone: false,
                    out: false,
                    out_device_id: None,
                },
            ),
            (
                CHANNEL_MIC,
                ChannelRouting {
                    master: true,
                    monitor: false,
                    fone: true,
                    out: false,
                    out_device_id: None,
                },
            ),
            (
                CHANNEL_LINEIN,
                ChannelRouting {
                    master: true,
                    monitor: false,
                    fone: false,
                    out: false,
                    out_device_id: None,
                },
            ),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect();

        Self {
            channels,
            routing,
            master: BusConfig::default(),
            monitor: BusConfig::default(),
            fone: BusConfig::default(),
        }
    }
}

// ---------------------------------------------------------------------------
// Níveis VU (leitura em tempo real – não persistidos)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VuLevel {
    /// RMS linear 0.0 – 1.0
    pub rms_left: f32,
    pub rms_right: f32,
    /// Pico linear 0.0 – 1.0
    pub peak_left: f32,
    pub peak_right: f32,
}

// ---------------------------------------------------------------------------
// Payload enviado ao frontend a cada tick (~33 ms)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MixerTickPayload {
    pub levels: HashMap<String, VuLevel>,
    pub channels: HashMap<String, ChannelGain>,
    pub routing: HashMap<String, ChannelRouting>,
    pub master: BusConfig,
    pub monitor: BusConfig,
    pub fone: BusConfig,
}

// ---------------------------------------------------------------------------
// Informação de dispositivo de áudio
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
}

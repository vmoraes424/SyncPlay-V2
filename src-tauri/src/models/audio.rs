use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AudioItem {
    pub id: String,
    pub path: String,
    pub mix_end_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    /// Duração do crossfade (fade-in da próxima + fade-out desta, durante o mix).
    pub fade_duration_ms: Option<u64>,
    /// Fadeout automático (mix natural). 0 ou None = sem ramp, toca até o fim.
    pub fade_out_time_ms: Option<u64>,
    /// Fadeout ao trocar manualmente (espaço ou clique). Música=3000, mídia=1500.
    pub manual_fade_out_ms: Option<u64>,
    pub media_type: Option<String>,
    /// Permite forçar o áudio para um canal específico do mixer (ex: "cue")
    pub mixer_bus: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PlaybackState {
    pub current_index: Option<usize>,
    pub current_id: Option<String>,
    pub is_playing: bool,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub background_ids: Vec<String>,
    pub background_positions: HashMap<String, u64>,
    pub background_durations: HashMap<String, u64>,
    pub independent_positions: HashMap<String, u64>,
    pub independent_durations: HashMap<String, u64>,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            current_index: None,
            current_id: None,
            is_playing: false,
            position_ms: 0,
            duration_ms: 0,
            background_ids: Vec::new(),
            background_positions: HashMap::new(),
            background_durations: HashMap::new(),
            independent_positions: HashMap::new(),
            independent_durations: HashMap::new(),
        }
    }
}

pub enum AudioCommand {
    SetQueue(Vec<AudioItem>),
    PlayIndex(usize),
    Pause,
    Resume,
    Seek(u64),
    /// Mesma faixa da fila: fade-out do trecho atual e nova decodificação a partir de `position_ms`.
    SeekWithFade {
        position_ms: u64,
        mixer_bus: Option<String>,
    },
    /// Salta para `index` com crossfade e seek inicial em `position_ms`.
    PlayIndexWithSeekFade {
        index: usize,
        position_ms: u64,
        mixer_bus: Option<String>,
    },
    SkipWithFade,
    /// Toca um áudio de forma independente da playlist principal (ex: CUE/Preview, Soundpad)
    PlayIndependent(AudioItem),
    /// Para um áudio independente pelo seu ID
    StopIndependent(String),
    /// Pula para uma posição específica em um áudio independente
    SeekIndependent(String, u64),
}

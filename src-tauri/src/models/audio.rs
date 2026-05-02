use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AudioItem {
    pub id: String,
    pub path: String,
    pub mix_end_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    pub fade_duration_ms: Option<u64>,
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
}

pub enum AudioCommand {
    SetQueue(Vec<AudioItem>),
    PlayIndex(usize),
    Pause,
    Resume,
    Seek(u64),
    SkipWithFade,
}

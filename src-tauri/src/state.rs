use crate::core::audio::start_audio_engine;
use crate::core::mixer::load_mixer_routing;
use crate::error::{AppError, AppResult};
use crate::models::audio::{AudioCommand, PlaybackState};
use crate::models::mixer::{MixerRouting, VuLevel};
use std::collections::HashMap;
use std::sync::{mpsc, Arc, Mutex};

pub struct AppState {
    tx: Mutex<mpsc::Sender<AudioCommand>>,
    playback: Arc<Mutex<PlaybackState>>,
    /// Estado de roteamento / ganho persistido em disco.
    pub mixer_routing: Arc<Mutex<MixerRouting>>,
    /// Nível VU do canal playlist – atualizado pela thread de áudio via VuMeterSource.
    pub playlist_vu: Arc<Mutex<VuLevel>>,
    /// Snapshot de todos os níveis VU – lido pelo frontend via evento Tauri.
    pub vu_snapshot: Arc<Mutex<HashMap<String, VuLevel>>>,
}

impl AppState {
    pub fn new() -> Self {
        let mixer_routing = Arc::new(Mutex::new(load_mixer_routing()));
        let playlist_vu = Arc::new(Mutex::new(VuLevel::default()));
        let vu_snapshot = Arc::new(Mutex::new(HashMap::new()));

        let (tx, playback) = start_audio_engine(
            mixer_routing.clone(),
            playlist_vu.clone(),
            vu_snapshot.clone(),
        );

        Self {
            tx: Mutex::new(tx),
            playback,
            mixer_routing,
            playlist_vu,
            vu_snapshot,
        }
    }

    pub fn send_audio_command(&self, command: AudioCommand) -> AppResult<()> {
        self.tx
            .lock()
            .map_err(|e| AppError::State(e.to_string()))?
            .send(command)?;
        Ok(())
    }

    pub fn playback_state(&self) -> AppResult<PlaybackState> {
        Ok(self
            .playback
            .lock()
            .map_err(|e| AppError::State(e.to_string()))?
            .clone())
    }
}

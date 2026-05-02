use crate::core::audio::start_audio_engine;
use crate::error::{AppError, AppResult};
use crate::models::audio::{AudioCommand, PlaybackState};
use std::sync::{mpsc, Arc, Mutex};

pub struct AppState {
    tx: Mutex<mpsc::Sender<AudioCommand>>,
    playback: Arc<Mutex<PlaybackState>>,
}

impl AppState {
    pub fn new() -> Self {
        let (tx, playback) = start_audio_engine();

        Self {
            tx: Mutex::new(tx),
            playback,
        }
    }

    pub fn send_audio_command(&self, command: AudioCommand) -> AppResult<()> {
        self.tx
            .lock()
            .map_err(|error| AppError::State(error.to_string()))?
            .send(command)?;
        Ok(())
    }

    pub fn playback_state(&self) -> AppResult<PlaybackState> {
        Ok(self
            .playback
            .lock()
            .map_err(|error| AppError::State(error.to_string()))?
            .clone())
    }
}

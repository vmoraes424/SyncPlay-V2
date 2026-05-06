use crate::core::audio::start_audio_engine;
use crate::core::mixer::DigitalMixer;
use crate::error::{AppError, AppResult};
use crate::models::audio::{AudioCommand, PlaybackState};
use std::sync::{mpsc, Arc, Mutex};

pub struct AppState {
    tx: Mutex<mpsc::Sender<AudioCommand>>,
    playback: Arc<Mutex<PlaybackState>>,
    // Apenas UMA referência para o coração do sistema: A Mesa de Som
    pub mixer: Arc<Mutex<DigitalMixer>>,
}

impl AppState {
    pub fn new() -> Self {
        // 1. Instancia a nova mesa de som digital (carrega roteamento padrão por dentro)
        let mixer = Arc::new(Mutex::new(DigitalMixer::new()));

        // 2. Inicia o motor de áudio (thread da cpal) passando o clone do mixer
        let (tx, playback) = start_audio_engine(mixer.clone());

        Self {
            tx: Mutex::new(tx),
            playback,
            mixer,
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
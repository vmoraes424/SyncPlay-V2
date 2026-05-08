use crate::error::{AppError, AppResult};
use crate::models::audio::{AudioCommand, PlaybackState};
use std::sync::{mpsc, Arc, Mutex};
use crossbeam_channel::Sender;
use crate::core::mixer::MixerCommand;
use crate::models::mixer::{MixerRouting, VuLevel};
use std::collections::HashMap;

pub struct AppState {
    tx: Mutex<mpsc::Sender<AudioCommand>>,
    playback: Arc<Mutex<PlaybackState>>,
    // Apenas UMA referência para o coração do sistema: A Mesa de Som
    pub mixer_tx: Sender<MixerCommand>,
    pub routing: Arc<Mutex<MixerRouting>>,
    pub vu: Arc<Mutex<HashMap<String, VuLevel>>>,
    pub master_vu: Arc<Mutex<VuLevel>>,
    pub monitor_vu: Arc<Mutex<VuLevel>>,
    pub retorno_vu: Arc<Mutex<VuLevel>>,
}

impl AppState {
    pub fn new() -> Self {
        // 1. Instancia a nova mesa de som digital (carrega roteamento padrão por dentro)
        let (tx, playback, mixer_tx, routing, vu, master_vu, monitor_vu, retorno_vu) = crate::core::audio::start_audio_engine();

        Self {
            tx: Mutex::new(tx),
            playback,
            mixer_tx,
            routing,
            vu,
            master_vu,
            monitor_vu,
            retorno_vu,
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
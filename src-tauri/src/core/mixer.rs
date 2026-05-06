use crate::models::mixer::{MixerRouting, VuLevel};
use ringbuf::Consumer;
use std::sync::Arc;
use crate::core::dsp::{apply_gain, mix_add, calculate_vu};

pub struct AudioTrack {
    pub id: String,
    pub consumer: Consumer<f32, Arc<ringbuf::SharedRb<f32, Vec<std::mem::MaybeUninit<f32>>>>>,
    pub volume: f32,
    pub active: bool,
}

pub struct DigitalMixer {
    pub tracks: Vec<AudioTrack>,
    pub routing: MixerRouting,
    // Buffers internos para processamento por bloco
    pub master_buffer: Vec<f32>,
    pub playlist_vu: VuLevel,
    pub master_vu: VuLevel,
}

impl DigitalMixer {
    pub fn new() -> Self {
        Self {
            tracks: Vec::new(),
            routing: MixerRouting::default(),
            master_buffer: vec![0.0; 2048], // Bloco padrão
            playlist_vu: VuLevel::default(),
            master_vu: VuLevel::default(),
        }
    }

    /// Chamado pela Cpal milhares de vezes por segundo
    pub fn process_audio_block(&mut self, output: &mut [f32]) {
        let frames = output.len();
        if self.master_buffer.len() < frames {
            self.master_buffer.resize(frames, 0.0);
        }
        
        let master_buf = &mut self.master_buffer[..frames];
        master_buf.fill(0.0); // Zera o barramento master

        let mut temp_buf = vec![0.0; frames];

        // Processa cada faixa ativa (Ex: Faixa principal e background fade)
        for track in self.tracks.iter_mut().filter(|t| t.active) {
            let popped = track.consumer.pop_slice(&mut temp_buf);
            if popped < frames {
                // Silêncio se o buffer esvaziar
                temp_buf[popped..].fill(0.0); 
            }

            // 1. Aplica o volume/fader da faixa
            apply_gain(&mut temp_buf, track.volume);

            // 2. Calcula VU (Pré-roteamento, como numa mesa real)
            calculate_vu(&temp_buf, &mut self.playlist_vu, 0.95);

            // 3. Roteamento (Mixagem para o Master)
            // Aqui você pode adicionar ifs para verificar `self.routing` e somar em buses diferentes
            mix_add(master_buf, &temp_buf);
        }

        // Aplica o Fader Master Global
        let master_gain = if self.routing.master.muted { 0.0 } else { self.routing.master.gain };
        apply_gain(master_buf, master_gain);

        // Calcula VU do Master
        calculate_vu(master_buf, &mut self.master_vu, 0.95);

        // Copia o resultado final para a placa de som
        output.copy_from_slice(master_buf);
    }
}
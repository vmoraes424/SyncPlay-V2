use crate::core::dsp::{apply_gain, calculate_vu, mix_add};
use crate::models::mixer::{AudioDevice, MixerRouting, VuLevel};
use ringbuf::traits::{Consumer, Observer};
use ringbuf::HeapCons;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

pub fn list_audio_devices() -> Vec<AudioDevice> {
    // TODO: implementar via cpal::host().output_devices().
    vec![]
}

pub fn save_mixer_routing(_routing: &MixerRouting) {
    // TODO: persistir em disco quando definirmos o caminho/formato (mixer.json).
}

/// Lê o volume de uma faixa (armazenado como f32 bits em um AtomicU32).
#[inline]
pub fn load_volume(v: &AtomicU32) -> f32 {
    f32::from_bits(v.load(Ordering::Relaxed))
}

/// Escreve o volume de uma faixa (converte f32 → bits para o AtomicU32).
#[inline]
pub fn store_volume(v: &AtomicU32, vol: f32) {
    v.store(vol.to_bits(), Ordering::Relaxed);
}

pub struct AudioTrack {
    pub id: String,
    /// Canal lógico do mixer ao qual a faixa está conectada (ex.: `"playlist"`, `"vem"`).
    pub channel_id: String,
    pub consumer: HeapCons<f32>,
    /// Volume da faixa para controle de fade (multiplicado pelo fader do canal).
    /// Armazenado como bits de f32 em AtomicU32 para permitir escrita lock-free
    /// da thread de engine enquanto o callback lê.
    pub volume: Arc<AtomicU32>,
    /// `false` = pausada; o mixer não consome do ring buffer.
    pub active: Arc<AtomicBool>,
    /// Contador de samples (interleaved) consumidos do ring buffer (incrementado no callback).
    pub position_samples: Arc<AtomicU64>,
    /// Quando true, descarta todo o conteúdo pendente do ring buffer desta faixa.
    pub seek_flush_pending: Arc<AtomicBool>,
    /// Sinalizado pelo decoder quando termina (EOF/Stop).
    pub finished: Arc<AtomicBool>,
}

pub struct DigitalMixer {
    pub tracks: Vec<AudioTrack>,
    pub routing: MixerRouting,
    pub master_buffer: Vec<f32>,
    pub temp_buffer: Vec<f32>,
    /// VU pós-fader por canal (chave = `channel_id`).
    pub vu: HashMap<String, VuLevel>,
    pub master_vu: VuLevel,
    pub output_sample_rate: u32,
    pub output_channels: u16,
}

impl DigitalMixer {
    pub fn new() -> Self {
        Self {
            tracks: Vec::new(),
            routing: MixerRouting::default(),
            master_buffer: vec![0.0; 4096],
            temp_buffer: vec![0.0; 4096],
            vu: HashMap::new(),
            master_vu: VuLevel::default(),
            output_sample_rate: 48_000,
            output_channels: 2,
        }
    }

    pub fn set_output_format(&mut self, sample_rate: u32, channels: u16) {
        self.output_sample_rate = sample_rate;
        self.output_channels = channels.max(1);
    }

    /// Callback do cpal — roda em thread real-time, não pode alocar nem bloquear.
    pub fn process_audio_block(&mut self, output: &mut [f32]) {
        let n = output.len();
        if self.master_buffer.len() < n {
            self.master_buffer.resize(n, 0.0);
        }
        if self.temp_buffer.len() < n {
            self.temp_buffer.resize(n, 0.0);
        }

        let master_buf = &mut self.master_buffer[..n];
        master_buf.fill(0.0);

        for track in self.tracks.iter_mut() {
            let temp_buf = &mut self.temp_buffer[..n];

            // Flush pós-seek: remove imediatamente o áudio antigo já pré-bufferizado.
            if track.seek_flush_pending.swap(false, Ordering::AcqRel) {
                while !track.consumer.is_empty() {
                    let dropped = track.consumer.pop_slice(temp_buf);
                    if dropped == 0 {
                        break;
                    }
                }
            }

            if !track.active.load(Ordering::Relaxed) {
                continue;
            }

            // 1. Puxa samples do ring buffer.
            let popped = track.consumer.pop_slice(temp_buf);
            if popped < n {
                temp_buf[popped..].fill(0.0);
            }

            // 2. Atualiza posição (samples interleaved consumidos → ms pela engine).
            track.position_samples.fetch_add(popped as u64, Ordering::Relaxed);

            // 3. Ganho efetivo = fader_track (fade envelope) × fader_canal × mute_canal.
            let track_vol = load_volume(&track.volume);
            let channel_cfg = self.routing.channels.get(&track.channel_id);
            let channel_gain = channel_cfg.map(|c| c.value).unwrap_or(1.0);
            let channel_muted = channel_cfg.map(|c| c.muted).unwrap_or(false);
            let effective_gain = if channel_muted || track_vol == 0.0 {
                0.0
            } else {
                track_vol * channel_gain
            };
            apply_gain(temp_buf, effective_gain);

            // 4. VU pós-fader do canal.
            let vu_entry = self.vu.entry(track.channel_id.clone()).or_default();
            calculate_vu(temp_buf, vu_entry, 0.95);

            // 5. Roteamento para o bus master (monitor/retorno: próxima fase, multi-stream).
            let route_master = self
                .routing
                .routing
                .get(&track.channel_id)
                .map(|r| r.master)
                .unwrap_or(true);
            if route_master {
                mix_add(master_buf, temp_buf);
            }
        }

        // 6. Fader/mute do bus master.
        let master_gain = if self.routing.master.muted {
            0.0
        } else {
            self.routing.master.gain
        };
        apply_gain(master_buf, master_gain);

        // 7. VU master pós-bus.
        calculate_vu(master_buf, &mut self.master_vu, 0.95);

        // 8. Entrega para a placa de som.
        output.copy_from_slice(master_buf);

        // 9. Limpa faixas finalizadas (decoder parou e ring buffer está vazio).
        self.tracks.retain(|t| {
            !(t.finished.load(Ordering::Acquire) && t.consumer.is_empty())
        });
    }
}

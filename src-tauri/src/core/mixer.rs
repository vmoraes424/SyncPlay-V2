//! Mixer de áudio em Rust puro.
//!
//! Responsabilidades:
//! - `VuMeterSource<S>` – wrapper rodio que mede RMS/pico em tempo real.
//! - Enumeração de dispositivos de saída via cpal.
//! - Persistência do estado de roteamento em JSON.

use rodio::Source;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::models::mixer::{AudioDevice, MixerRouting, VuLevel};

// ---------------------------------------------------------------------------
// Acumulador RMS com janela deslizante O(1) por sample
// ---------------------------------------------------------------------------

const VU_WINDOW: usize = 2048; // ~46 ms @ 44100 Hz

struct VuAcc {
    win: [f32; VU_WINDOW],
    pos: usize,
    sum: f32,
    drift_counter: usize,
}

impl VuAcc {
    const RECALC_EVERY: usize = VU_WINDOW * 16;

    fn new() -> Self {
        Self {
            win: [0.0; VU_WINDOW],
            pos: 0,
            sum: 0.0,
            drift_counter: 0,
        }
    }

    /// Insere um sample ao quadrado, retorna RMS da janela.
    fn push(&mut self, s_sq: f32) -> f32 {
        let idx = self.pos % VU_WINDOW;
        let old = self.win[idx];
        self.sum = self.sum - old + s_sq;
        self.win[idx] = s_sq;
        self.pos += 1;

        // Recomputa a soma periodicamente para corrigir drift de ponto flutuante.
        self.drift_counter += 1;
        if self.drift_counter >= Self::RECALC_EVERY {
            self.sum = self.win.iter().sum();
            self.drift_counter = 0;
        }

        (self.sum.max(0.0) / VU_WINDOW as f32).sqrt()
    }
}

// Helper para converter amplitude linear na escala visual de Decibéis (0.0 a 1.0)
#[inline]
fn amp_to_db_normalized(amp: f32) -> f32 {
    if amp <= 0.001 { // Piso de silêncio absoluto (-60dB)
        return 0.0;
    }
    let db = 20.0 * amp.log10();
    let min_db = -60.0; // O medidor vai de -60dB a 0dB
    
    // Normaliza para um range de 0.0 a 1.0 e aplica uma leve curva 
    // visual para deixar os graves mais responsivos
    let normalized = ((db - min_db) / (-min_db)).clamp(0.0, 1.0);
    normalized * normalized
}

pub struct VuMeterSource<S: Source<Item = f32>> {
    inner: S,
    vu: Arc<Mutex<VuLevel>>,
    acc_l: VuAcc,
    acc_r: VuAcc,
    peak_l: f32,
    peak_r: f32,
    peak_decay: f32,
    sample_in_frame: u16,
    channels: u16,
    update_counter: u16, // Adicionado para otimização de CPU
}

impl<S: Source<Item = f32>> VuMeterSource<S> {
    pub fn new(inner: S, vu: Arc<Mutex<VuLevel>>) -> Self {
        let channels = inner.channels().max(1);
        let sample_rate = inner.sample_rate() as f32;
        
        // DECAIMENTO PROFISSIONAL: 
        // 0.00001 significa cair -100dB por segundo. Isso garante que ao pausar,
        // o VU desaparece da tela instantaneamente de forma responsiva.
        let peak_decay = 0.00001_f32.powf(1.0 / sample_rate);
        
        Self {
            inner,
            vu,
            acc_l: VuAcc::new(),
            acc_r: VuAcc::new(),
            peak_l: 0.0,
            peak_r: 0.0,
            peak_decay,
            sample_in_frame: 0,
            channels,
            update_counter: 0,
        }
    }
}

impl<S: Source<Item = f32>> Iterator for VuMeterSource<S> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        let s = self.inner.next()?;
        let abs = s.abs();
        let s_sq = s * s;
        let mut current_rms_l = 0.0;
        let mut current_rms_r = 0.0;

        if self.channels == 1 {
            let rms = self.acc_l.push(s_sq);
            let _ = self.acc_r.push(s_sq);
            if abs > self.peak_l {
                self.peak_l = abs;
            } else {
                self.peak_l *= self.peak_decay;
            }
            self.peak_r = self.peak_l;
            current_rms_l = rms;
            current_rms_r = rms;
        } else {
            match self.sample_in_frame {
                0 => {
                    current_rms_l = self.acc_l.push(s_sq);
                    if abs > self.peak_l { self.peak_l = abs; } else { self.peak_l *= self.peak_decay; }
                }
                1 => {
                    current_rms_r = self.acc_r.push(s_sq);
                    if abs > self.peak_r { self.peak_r = abs; } else { self.peak_r *= self.peak_decay; }
                }
                _ => {}
            }
        }

        self.sample_in_frame += 1;
        if self.sample_in_frame >= self.channels {
            self.sample_in_frame = 0;
            self.update_counter += 1;
            
            // OTIMIZAÇÃO: Só envia os dados pro Mutex a cada 1024 frames 
            // (~43 vezes por segundo), desafogando a thread de áudio e o event loop do Tauri.
            if self.update_counter >= 1024 {
                self.update_counter = 0;
                if let Ok(mut v) = self.vu.try_lock() {
                    // O valor salvo no estado já é a porcentagem visual final em dBFS
                    v.rms_left = amp_to_db_normalized(current_rms_l.sqrt());
                    v.rms_right = amp_to_db_normalized(current_rms_r.sqrt());
                    v.peak_left = amp_to_db_normalized(self.peak_l);
                    v.peak_right = amp_to_db_normalized(self.peak_r);
                }
            }
        }
        Some(s)
    }
}

impl<S: Source<Item = f32>> Source for VuMeterSource<S> {
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }
    fn channels(&self) -> u16 {
        self.inner.channels()
    }
    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }
    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

// ---------------------------------------------------------------------------
// Ganho dinâmico (fader do canal antes do VU; atualizado a cada tick)
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
pub struct AtomicF32(AtomicU32);

impl AtomicF32 {
    pub fn new(v: f32) -> Self {
        Self(AtomicU32::new(v.to_bits()))
    }

    pub fn store(&self, v: f32) {
        self.0.store(v.to_bits(), Ordering::Relaxed);
    }

    pub fn load(&self) -> f32 {
        f32::from_bits(self.0.load(Ordering::Relaxed))
    }
}

pub struct DynamicGainSource<S: Source<Item = f32>> {
    inner: S,
    gain: Arc<AtomicF32>,
}

impl<S: Source<Item = f32>> DynamicGainSource<S> {
    pub fn new(inner: S, gain: Arc<AtomicF32>) -> Self {
        Self { inner, gain }
    }
}

impl<S: Source<Item = f32>> Iterator for DynamicGainSource<S> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        let g = self.gain.load();
        self.inner.next().map(|s| s * g)
    }
}

impl<S: Source<Item = f32>> Source for DynamicGainSource<S> {
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }
    fn channels(&self) -> u16 {
        self.inner.channels()
    }
    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }
    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

// ---------------------------------------------------------------------------
// Enumeração de dispositivos via cpal
// ---------------------------------------------------------------------------

pub fn list_audio_devices() -> Vec<AudioDevice> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let host = cpal::default_host();
    let mut devices = vec![AudioDevice {
        id: "default".to_string(),
        name: "Padrão do sistema".to_string(),
    }];

    if let Ok(iter) = host.output_devices() {
        for device in iter {
            if let Ok(name) = device.name() {
                devices.push(AudioDevice {
                    id: name.clone(),
                    name,
                });
            }
        }
    }

    devices
}

// ---------------------------------------------------------------------------
// Persistência do roteamento
// ---------------------------------------------------------------------------

const MIXER_CONFIG_PATH: &str = "C:/SyncPlay/Configs/mixer-routing.json";

pub fn load_mixer_routing() -> MixerRouting {
    let mut routing: MixerRouting = std::fs::read_to_string(MIXER_CONFIG_PATH)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    routing.merge_missing_defaults();
    routing
}

pub fn save_mixer_routing(routing: &MixerRouting) {
    if let Ok(json) = serde_json::to_string_pretty(routing) {
        let _ = std::fs::write(MIXER_CONFIG_PATH, json);
    }
}

// ---------------------------------------------------------------------------
// Helpers de ganho (OUT = arm p/ DAC; VU = pós-fader, independente de OUT)
// ---------------------------------------------------------------------------

#[inline]
fn bus_send_linear(bus_on: bool, bus: &crate::models::mixer::BusConfig) -> f32 {
    if bus_on && !bus.muted {
        bus.gain
    } else {
        0.0
    }
}

/// Ganho do fader do canal (mute + valor). Entra **antes** do `VuMeterSource`.
pub fn channel_strip_linear_gain(routing: &MixerRouting, channel_id: &str) -> f32 {
    let ch = routing
        .channels
        .get(channel_id)
        .cloned()
        .unwrap_or_default();
    if ch.muted {
        return 0.0;
    }
    ch.value
}

/// Caminho até o DAC: exige `out`; entre os buses marcados usa o maior ganho linear
/// (um único stream de reprodução — evita soma acidental do mesmo sinal).
pub fn channel_playback_path_gain(routing: &MixerRouting, channel_id: &str) -> f32 {
    let route = routing
        .routing
        .get(channel_id)
        .cloned()
        .unwrap_or_default();
    if !route.out {
        return 0.0;
    }
    let m = bus_send_linear(route.master, &routing.master)
        .max(bus_send_linear(route.monitor, &routing.monitor))
        .max(bus_send_linear(route.retorno, &routing.retorno));
    m
}

/// Par `(strip, path)` para o canal — um lock só no engine.
pub fn channel_audio_gains(routing: &MixerRouting, channel_id: &str) -> (f32, f32) {
    (
        channel_strip_linear_gain(routing, channel_id),
        channel_playback_path_gain(routing, channel_id),
    )
}

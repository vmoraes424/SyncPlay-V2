use crate::core::dsp::{apply_gain, calculate_vu, mix_add};
use crate::models::mixer::{MixerRouting, VuLevel};
use crate::models::mixer::AudioDevice;
use crossbeam_channel::Receiver;
use ringbuf::traits::{Consumer, Observer};
use ringbuf::HeapCons;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

// 1. Canal de comunicação Lock-Free
pub enum MixerCommand {
    AddTrack(AudioTrack),
    RemoveTrack(String),
    // Usado para Play/Pause com De-click
    SetTrackState { id: String, playing: bool },
    UpdateRouting(MixerRouting),
}

pub struct AudioTrack {
    pub id: String,
    pub channel_id: String, // Este é o nosso Bus (ex: "playlist", "vinhetas")
    pub consumer: HeapCons<f32>,
    pub volume: Arc<AtomicU32>,
    pub position_samples: Arc<AtomicU64>,
    pub seek_flush_pending: Arc<AtomicBool>,
    pub finished: Arc<AtomicBool>,
    
    // 2. Parâmetros de De-click (Micro-fades)
    pub current_fade: f32,
    pub target_fade: f32, // 1.0 = Play, 0.0 = Pause
}

pub struct DigitalMixer {
    pub tracks: Vec<AudioTrack>,
    pub command_rx: Receiver<MixerCommand>,
    pub routing: MixerRouting,
    
    // 3. Arquitetura de Bus (Opção B)
    pub bus_buffers: HashMap<String, Vec<f32>>,
    pub master_buffer: Vec<f32>,
    pub monitor_buffer: Vec<f32>,
    pub retorno_buffer: Vec<f32>,
    pub temp_buffer: Vec<f32>,
    
    // VU Meters (Atualizados em lock-free)
    pub vu: HashMap<String, VuLevel>,
    pub master_vu: VuLevel,
    pub monitor_vu: VuLevel,
    pub retorno_vu: VuLevel,
    pub output_sample_rate: u32,
    pub output_channels: u16,

    pub shared_vu: Option<Arc<std::sync::Mutex<HashMap<String, VuLevel>>>>,
    pub shared_master_vu: Option<Arc<std::sync::Mutex<VuLevel>>>,
    pub shared_monitor_vu: Option<Arc<std::sync::Mutex<VuLevel>>>,
    pub shared_retorno_vu: Option<Arc<std::sync::Mutex<VuLevel>>>,
}

impl DigitalMixer {
    pub fn process_audio_block(&mut self, output: &mut [f32]) {
        let n = output.len();
        
        // Redimensionar buffers se necessário
        if self.master_buffer.len() < n {
            self.master_buffer.resize(n, 0.0);
            self.monitor_buffer.resize(n, 0.0);
            self.retorno_buffer.resize(n, 0.0);
            self.temp_buffer.resize(n, 0.0);
        }
        self.master_buffer[..n].fill(0.0);
        self.monitor_buffer[..n].fill(0.0);
        self.retorno_buffer[..n].fill(0.0);

        // Processar comandos da thread principal sem bloquear!
        while let Ok(cmd) = self.command_rx.try_recv() {
            match cmd {
                MixerCommand::AddTrack(track) => self.tracks.push(track),
                MixerCommand::RemoveTrack(id) => self.tracks.retain(|t| t.id != id),
                MixerCommand::SetTrackState { id, playing } => {
                    if let Some(track) = self.tracks.iter_mut().find(|t| t.id == id) {
                        track.target_fade = if playing { 1.0 } else { 0.0 };
                    }
                }
                MixerCommand::UpdateRouting(routing) => {
                    self.routing = routing;
                }
            }
        }

        // Preparar Buses (limpar buffers)
        for bus_buf in self.bus_buffers.values_mut() {
            if bus_buf.len() < n { bus_buf.resize(n, 0.0); }
            bus_buf[..n].fill(0.0);
        }
        // Aplica o decaimento em todos os VUs ANTES de calcular os novos
        for vu in self.vu.values_mut() {
            vu.rms_left = 0.0;
            vu.rms_right = 0.0;
            vu.peak_left *= 0.95; 
            vu.peak_right *= 0.95;
        }

        self.master_vu.peak_left *= 0.95;
        self.master_vu.peak_right *= 0.95;
        self.monitor_vu.peak_left *= 0.95;
        self.monitor_vu.peak_right *= 0.95;
        self.retorno_vu.peak_left *= 0.95;
        self.retorno_vu.peak_right *= 0.95;

        // FASE 1: Processar Tracks e enviar para seus Buses
        for track in self.tracks.iter_mut() {
            let temp_buf = &mut self.temp_buffer[..n];
            temp_buf.fill(0.0);

            // Flush pós-seek
            if track.seek_flush_pending.swap(false, Ordering::AcqRel) {
                while !track.consumer.is_empty() {
                    let _ = track.consumer.pop_slice(temp_buf);
                }
            }

            // De-click / Rampa Suave de Volume (aprox. 5ms a 48kHz)
            let fade_speed = 0.01; 
            
            // Só consumimos áudio se a faixa estiver a tocar OU a fazer o fade-out do pause
            if track.target_fade > 0.0 || track.current_fade > 0.001 {
                let popped = track.consumer.pop_slice(temp_buf);
                track.position_samples.fetch_add(popped as u64, Ordering::Relaxed);
                
                let track_vol = f32::from_bits(track.volume.load(Ordering::Relaxed));

                // Aplicar rampa de de-click amostra por amostra (ou por bloco)
                for sample in temp_buf[..popped].iter_mut() {
                    track.current_fade += (track.target_fade - track.current_fade) * fade_speed;
                    *sample *= track_vol * track.current_fade;
                }

                // Somar no Bus correspondente (ex: Bus da Playlist)
                let bus_buf = self.bus_buffers
                    .entry(track.channel_id.clone())
                    .or_insert_with(|| vec![0.0; n]);
                    
                mix_add(&mut bus_buf[..n], &temp_buf[..n]);
            } else {
                // Completamente pausado e fade finalizado
                track.current_fade = 0.0;
            }
        }

        // FASE 2: Processar Efeitos por Bus e somar ao Master
        for (channel_id, bus_buf) in self.bus_buffers.iter_mut() {
            let bus_slice = &mut bus_buf[..n];

            // AQUI ENTRARÃO OS EFEITOS (Compressor, EQ) no futuro:
            // apply_compressor(bus_slice, &self.compressor_settings[channel_id]);

            // Ganho do Canal e Mute
            let channel_cfg = self.routing.channels.get(channel_id);
            let channel_gain = if channel_cfg.map(|c| c.muted).unwrap_or(false) { 0.0 } 
                               else { channel_cfg.map(|c| c.value).unwrap_or(1.0) };
            
            apply_gain(bus_slice, channel_gain);

            // Calcular VU do Bus
            let vu_entry = self.vu.entry(channel_id.clone()).or_default();
            calculate_vu(bus_slice, vu_entry, 1.0); // Nota: sem decaimento aqui, já o fizemos no topo

            // Somar ao Master se estiver roteado
            let route_master = self.routing.routing.get(channel_id).map(|r| r.master).unwrap_or(true);
            if route_master {
                mix_add(&mut self.master_buffer[..n], bus_slice);
            }

            // Somar ao Monitor se estiver roteado
            let route_monitor = self.routing.routing.get(channel_id).map(|r| r.monitor).unwrap_or(true);
            if route_monitor {
                mix_add(&mut self.monitor_buffer[..n], bus_slice);
            }

            // Somar ao Retorno se estiver roteado
            let route_retorno = self.routing.routing.get(channel_id).map(|r| r.retorno).unwrap_or(true);
            if route_retorno {
                mix_add(&mut self.retorno_buffer[..n], bus_slice);
            }
        }

        // FASE 3: Master Bus
        let master_gain = if self.routing.master.muted { 0.0 } else { self.routing.master.gain };
        let master_slice = &mut self.master_buffer[..n];
        apply_gain(master_slice, master_gain);
        calculate_vu(master_slice, &mut self.master_vu, 1.0);

        // FASE 4: Monitor Bus
        let monitor_gain = if self.routing.monitor.muted { 0.0 } else { self.routing.monitor.gain };
        let monitor_slice = &mut self.monitor_buffer[..n];
        apply_gain(monitor_slice, monitor_gain);
        calculate_vu(monitor_slice, &mut self.monitor_vu, 1.0);

        // FASE 5: Retorno Bus
        let retorno_gain = if self.routing.retorno.muted { 0.0 } else { self.routing.retorno.gain };
        let retorno_slice = &mut self.retorno_buffer[..n];
        apply_gain(retorno_slice, retorno_gain);
        calculate_vu(retorno_slice, &mut self.retorno_vu, 1.0);

        // Como ainda só temos uma saída de dispositivo, vamos somar as 3
        // saídas Master, Monitor e Retorno no buffer final de saída
        for i in 0..n {
            output[i] = master_slice[i] + monitor_slice[i] + retorno_slice[i];
        }

        // Limpar faixas terminadas
        self.tracks.retain(|t| {
            !(t.finished.load(Ordering::Acquire) && t.consumer.is_empty())
        });

        if let Some(shared_vu) = &self.shared_vu {
            if let Ok(mut vu_lock) = shared_vu.try_lock() {
                vu_lock.clone_from(&self.vu);
            }
        }
        if let Some(shared_master_vu) = &self.shared_master_vu {
            if let Ok(mut master_vu_lock) = shared_master_vu.try_lock() {
                master_vu_lock.clone_from(&self.master_vu);
            }
        }
        if let Some(shared_monitor_vu) = &self.shared_monitor_vu {
            if let Ok(mut monitor_vu_lock) = shared_monitor_vu.try_lock() {
                monitor_vu_lock.clone_from(&self.monitor_vu);
            }
        }
        if let Some(shared_retorno_vu) = &self.shared_retorno_vu {
            if let Ok(mut retorno_vu_lock) = shared_retorno_vu.try_lock() {
                retorno_vu_lock.clone_from(&self.retorno_vu);
            }
        }
    }
}

// Retorna os dispositivos (você vai implementar futuramente)
pub fn list_audio_devices() -> Vec<AudioDevice> {
    vec![]
}

pub fn save_mixer_routing(_routing: &MixerRouting) {
    // Salvar no disco no futuro
}

#[inline]
pub fn load_volume(v: &AtomicU32) -> f32 {
    f32::from_bits(v.load(Ordering::Relaxed))
}

#[inline]
pub fn store_volume(v: &AtomicU32, vol: f32) {
    v.store(vol.to_bits(), Ordering::Relaxed);
}
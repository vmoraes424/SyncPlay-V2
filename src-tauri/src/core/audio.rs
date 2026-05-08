use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::traits::Split;
use ringbuf::HeapRb;
use std::f32::consts::FRAC_PI_2;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::collections::HashMap; // Corrigido erro de HashMap
use crossbeam_channel::{unbounded, Sender}; // Canal de comandos

use crate::core::decoder::{DecoderCmd, TrackDecoder};
use crate::core::mixer::{store_volume, AudioTrack, DigitalMixer, MixerCommand};
use crate::models::audio::{AudioCommand, AudioItem, PlaybackState};
use crate::models::mixer::CHANNEL_PLAYLIST;

const PREBUFFER_SECONDS: usize = 1;

struct TrackEntry {
    id: String,
    index: usize,
    decoder: TrackDecoder,
    position_samples: Arc<AtomicU64>,
    finished: Arc<AtomicBool>,
    active: Arc<AtomicBool>,
    volume: Arc<AtomicU32>,
    duration_ms: u64,
    mix_end_ms: Option<u64>,
    fade_duration_ms: u64,
    manual_fade_out_ms: u64,
    seek_flush_pending: Arc<AtomicBool>,
}

pub fn start_audio_engine() -> (
    mpsc::Sender<AudioCommand>, 
    Arc<Mutex<PlaybackState>>, 
    Sender<MixerCommand>,
    Arc<Mutex<crate::models::mixer::MixerRouting>>,
    Arc<Mutex<HashMap<String, crate::models::mixer::VuLevel>>>,
    Arc<Mutex<crate::models::mixer::VuLevel>>,
    Arc<Mutex<crate::models::mixer::VuLevel>>,
    Arc<Mutex<crate::models::mixer::VuLevel>>,
) {
    let (tx, rx) = mpsc::channel::<AudioCommand>();
    let (mixer_tx, mixer_rx) = unbounded::<MixerCommand>();
    let playback = Arc::new(Mutex::new(PlaybackState::default()));
    
    let shared_routing = Arc::new(Mutex::new(crate::models::mixer::MixerRouting::default()));
    let shared_vu = Arc::new(Mutex::new(HashMap::new()));
    let shared_master_vu = Arc::new(Mutex::new(crate::models::mixer::VuLevel::default()));
    let shared_monitor_vu = Arc::new(Mutex::new(crate::models::mixer::VuLevel::default()));
    let shared_retorno_vu = Arc::new(Mutex::new(crate::models::mixer::VuLevel::default()));

    let host = cpal::default_host();
    let device = host.default_output_device().expect("Nenhuma placa de som encontrada");
    let config = device.default_output_config().expect("Sem configuração default");

    let target_sample_rate = config.sample_rate().0;
    let target_channels: u16 = config.channels();

    let mut mixer = DigitalMixer {
        tracks: Vec::new(),
        command_rx: mixer_rx,
        routing: shared_routing.lock().unwrap().clone(),
        bus_buffers: HashMap::new(),
        master_buffer: vec![0.0; 4096],
        monitor_buffer: vec![0.0; 4096],
        retorno_buffer: vec![0.0; 4096],
        temp_buffer: vec![0.0; 4096],
        vu: HashMap::new(),
        master_vu: Default::default(),
        monitor_vu: Default::default(),
        retorno_vu: Default::default(),
        output_sample_rate: target_sample_rate,
        output_channels: target_channels,
        shared_vu: Some(shared_vu.clone()),
        shared_master_vu: Some(shared_master_vu.clone()),
        shared_monitor_vu: Some(shared_monitor_vu.clone()),
        shared_retorno_vu: Some(shared_retorno_vu.clone()),
    };

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device
            .build_output_stream(
                &config.into(),
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    mixer.process_audio_block(data);
                },
                |err| eprintln!("Erro na thread de áudio: {}", err),
                None,
            )
            .expect("Falha ao criar stream cpal"),
        fmt => panic!("Formato não suportado: {:?}", fmt),
    };
    stream.play().expect("Falha ao iniciar stream cpal");
    std::mem::forget(stream);

    let mixer_for_thread = mixer_tx.clone();
    let playback_for_thread = playback.clone();
    
    thread::spawn(move || {
        engine_loop(
            rx,
            mixer_for_thread,
            playback_for_thread,
            target_sample_rate,
            target_channels,
        );
    });

    (tx, playback, mixer_tx, shared_routing, shared_vu, shared_master_vu, shared_monitor_vu, shared_retorno_vu)
}

fn engine_loop(
    rx: mpsc::Receiver<AudioCommand>,
    mixer_tx: Sender<MixerCommand>,
    playback: Arc<Mutex<PlaybackState>>,
    sr: u32,
    ch: u16,
) {
    let mut queue: Vec<AudioItem> = Vec::new();
    let mut current: Option<TrackEntry> = None;
    let mut incoming: Option<TrackEntry> = None;
    let mut xfade_total_ms: u64 = 0;
    let mut xfade_started_pos_ms: u64 = 0;

    loop {
        match rx.recv_timeout(Duration::from_millis(33)) {
            Ok(cmd) => handle_command(
                cmd, &mut queue, &mut current, &mut incoming,
                &mut xfade_total_ms, &mut xfade_started_pos_ms,
                &mixer_tx, &playback, sr, ch,
            ),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        process_transitions(
            &queue, &mut current, &mut incoming,
            &mut xfade_total_ms, &mut xfade_started_pos_ms,
            &mixer_tx, &playback, sr, ch,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_command(
    cmd: AudioCommand,
    queue: &mut Vec<AudioItem>,
    current: &mut Option<TrackEntry>,
    incoming: &mut Option<TrackEntry>,
    xfade_total_ms: &mut u64,
    xfade_started_pos_ms: &mut u64,
    mixer_tx: &Sender<MixerCommand>,
    playback: &Arc<Mutex<PlaybackState>>,
    sr: u32,
    ch: u16,
) {
    match cmd {
        AudioCommand::SetQueue(items) => *queue = items,
        AudioCommand::PlayIndex(idx) => {
            let Some(item) = queue.get(idx).cloned() else { return };
            stop_entry(incoming.take(), mixer_tx);
            *xfade_total_ms = 0;
            *xfade_started_pos_ms = 0;
            stop_entry(current.take(), mixer_tx);

            if let Some(entry) = make_track_entry(&item, idx, 1.0, mixer_tx, sr, ch) {
                update_playback_started(&entry, &item.id, playback);
                *current = Some(entry);
            }
        }
        AudioCommand::Pause => {
            if let Some(c) = current.as_ref() {
                c.active.store(false, Ordering::Release);
                let _ = mixer_tx.send(MixerCommand::SetTrackState { id: c.id.clone(), playing: false });
            }
            if let Some(inc) = incoming.as_ref() {
                inc.active.store(false, Ordering::Release);
                let _ = mixer_tx.send(MixerCommand::SetTrackState { id: inc.id.clone(), playing: false });
            }
            if let Ok(mut s) = playback.lock() { s.is_playing = false; }
        }
        AudioCommand::Resume => {
            if let Some(c) = current.as_ref() {
                c.active.store(true, Ordering::Release);
                let _ = mixer_tx.send(MixerCommand::SetTrackState { id: c.id.clone(), playing: true });
            }
            if let Some(inc) = incoming.as_ref() {
                inc.active.store(true, Ordering::Release);
                let _ = mixer_tx.send(MixerCommand::SetTrackState { id: inc.id.clone(), playing: true });
            }
            if let Ok(mut s) = playback.lock() { s.is_playing = true; }
        }
        AudioCommand::Seek(ms) => {
            stop_entry(incoming.take(), mixer_tx);
            *xfade_total_ms = 0;
            *xfade_started_pos_ms = 0;

            if let Some(c) = current.as_ref() {
                let _ = c.decoder.cmd_tx.send(DecoderCmd::Seek(ms));
                c.position_samples.store(ms_to_samples(ms, sr, ch), Ordering::Release);
                c.seek_flush_pending.store(true, Ordering::Release);
                store_volume(&c.volume, 1.0);
            }
            if let Ok(mut s) = playback.lock() { s.position_ms = ms; }
        }
        AudioCommand::SkipWithFade => {
            let fade_ms = current.as_ref().map(|c| c.manual_fade_out_ms).unwrap_or(1500);
            let cur_pos = current.as_ref().map(|c| track_pos_ms(c, sr, ch)).unwrap_or(0);
            let next_idx = current.as_ref().map(|c| c.index + 1);

            stop_entry(incoming.take(), mixer_tx);
            *xfade_total_ms = 0;

            if fade_ms == 0 {
                stop_entry(current.take(), mixer_tx);
                if let Some(ni) = next_idx.and_then(|i| queue.get(i)).cloned() {
                    if let Some(entry) = make_track_entry(&ni, next_idx.unwrap(), 1.0, mixer_tx, sr, ch) {
                        update_playback_started(&entry, &ni.id, playback);
                        *current = Some(entry);
                    }
                } else { clear_playback(playback); }
            } else {
                if let Some(ni) = next_idx.and_then(|i| queue.get(i)).cloned() {
                    if let Some(entry) = make_track_entry(&ni, next_idx.unwrap(), 0.0, mixer_tx, sr, ch) {
                        update_playback_started(&entry, &ni.id, playback);
                        *incoming = Some(entry);
                    }
                }
                *xfade_total_ms = fade_ms;
                *xfade_started_pos_ms = cur_pos;
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn process_transitions(
    queue: &[AudioItem],
    current: &mut Option<TrackEntry>,
    incoming: &mut Option<TrackEntry>,
    xfade_total_ms: &mut u64,
    xfade_started_pos_ms: &mut u64,
    mixer_tx: &Sender<MixerCommand>,
    playback: &Arc<Mutex<PlaybackState>>,
    sr: u32,
    ch: u16,
) {
    if *xfade_total_ms > 0 {
        let cur_pos = current.as_ref().map(|c| track_pos_ms(c, sr, ch)).unwrap_or(0);
        let elapsed = cur_pos.saturating_sub(*xfade_started_pos_ms);
        let progress = (elapsed as f32 / *xfade_total_ms as f32).clamp(0.0, 1.0);

        let angle = progress * FRAC_PI_2;
        if let Some(c) = current.as_ref() { store_volume(&c.volume, angle.cos().powi(2)); }
        if let Some(inc) = incoming.as_ref() { store_volume(&inc.volume, angle.sin().powi(2)); }

        if progress >= 1.0 {
            stop_entry(current.take(), mixer_tx);
            *current = incoming.take();
            if let Some(c) = current.as_ref() { store_volume(&c.volume, 1.0); }
            *xfade_total_ms = 0;
            *xfade_started_pos_ms = 0;
            if let Ok(mut s) = playback.lock() {
                s.position_ms = 0;
                s.is_playing = current.as_ref().map(|c| c.active.load(Ordering::Relaxed)).unwrap_or(false);
            }
        } else {
            if let Ok(mut s) = playback.lock() {
                s.position_ms = incoming.as_ref().map(|i| track_pos_ms(i, sr, ch)).unwrap_or(0);
            }
        }
        return;
    }

    let Some((cur_pos, cur_idx, cur_mix_end, cur_fade_dur, cur_finished, cur_active)) = current.as_ref().map(|c| {
        (track_pos_ms(c, sr, ch), c.index, c.mix_end_ms, c.fade_duration_ms, c.finished.load(Ordering::Acquire), c.active.load(Ordering::Relaxed))
    }) else { return; };

    if let Some(mix_end) = cur_mix_end {
        if cur_fade_dur > 0 {
            let zone_start = mix_end.saturating_sub(cur_fade_dur);
            if cur_pos >= zone_start && incoming.is_none() {
                let next_idx = cur_idx + 1;
                if let Some(next_item) = queue.get(next_idx).cloned() {
                    if let Some(entry) = make_track_entry(&next_item, next_idx, 0.0, mixer_tx, sr, ch) {
                        update_playback_started(&entry, &next_item.id, playback);
                        *incoming = Some(entry);
                        *xfade_total_ms = cur_fade_dur;
                        *xfade_started_pos_ms = cur_pos;
                        return;
                    }
                }
                if cur_pos >= zone_start {
                    *xfade_total_ms = cur_fade_dur;
                    *xfade_started_pos_ms = cur_pos;
                    return;
                }
            }
        }
    }

    if cur_finished {
        // Envia o comando de Stop mas garante que o mixer possa drenar
        let next_idx = cur_idx + 1;
        if let Some(old) = current.take() {
            let _ = mixer_tx.send(MixerCommand::RemoveTrack(old.id.clone()));
        }

        if let Some(next_item) = queue.get(next_idx).cloned() {
            if let Some(entry) = make_track_entry(&next_item, next_idx, 1.0, mixer_tx, sr, ch) {
                update_playback_started(&entry, &next_item.id, playback);
                *current = Some(entry);
                return;
            }
        }
        clear_playback(playback);
        return;
    }

    let duration_ms = current.as_ref().unwrap().duration_ms;
    if let Ok(mut s) = playback.lock() {
        s.position_ms = if duration_ms > 0 { cur_pos.min(duration_ms) } else { cur_pos };
        s.is_playing = cur_active && !cur_finished;
    }
}

fn make_track_entry(
    item: &AudioItem, index: usize, initial_volume: f32,
    mixer_tx: &Sender<MixerCommand>, sr: u32, ch: u16,
) -> Option<TrackEntry> {
    if !std::path::Path::new(&item.path).is_file() { return None; }

    let rb_cap = (sr as usize) * (ch as usize) * PREBUFFER_SECONDS;
    let rb = HeapRb::<f32>::new(rb_cap);
    let (prod, cons) = rb.split();

    let (decoder, info) = match TrackDecoder::new(item.path.as_str(), prod, sr, ch) {
        Ok(v) => v,
        Err(_) => return None,
    };

    let position_samples = Arc::new(AtomicU64::new(0));
    let seek_flush_pending = Arc::new(AtomicBool::new(false));
    let volume = Arc::new(AtomicU32::new(initial_volume.to_bits()));
    let active = Arc::new(AtomicBool::new(true));

    let track = AudioTrack {
        id: item.id.clone(),
        channel_id: CHANNEL_PLAYLIST.to_string(),
        consumer: cons,
        volume: volume.clone(),
        position_samples: position_samples.clone(),
        seek_flush_pending: seek_flush_pending.clone(),
        finished: decoder.finished.clone(),
        current_fade: 0.0, // Fade In inicial suave
        target_fade: 1.0, 
    };

    let _ = mixer_tx.send(MixerCommand::AddTrack(track));

    let duration_ms = if info.duration_ms > 0 { info.duration_ms } else { item.duration_ms.unwrap_or(0) };

    let finished_clone = decoder.finished.clone();

    Some(TrackEntry {
        id: item.id.clone(),
        index,
        decoder, // O decoder é movido aqui
        position_samples,
        finished: finished_clone, // Usa o clone que fizemos acima
        active,
        volume,
        duration_ms,
        mix_end_ms: item.mix_end_ms,
        fade_duration_ms: item.fade_duration_ms.unwrap_or(0),
        manual_fade_out_ms: item.manual_fade_out_ms.unwrap_or(1500),
        seek_flush_pending,
    })
}

fn stop_entry(entry: Option<TrackEntry>, mixer_tx: &Sender<MixerCommand>) {
    if let Some(e) = entry {
        let _ = e.decoder.cmd_tx.send(DecoderCmd::Stop);
        let _ = mixer_tx.send(MixerCommand::RemoveTrack(e.id.clone()));
    }
}

fn update_playback_started(entry: &TrackEntry, id: &str, playback: &Arc<Mutex<PlaybackState>>) {
    if let Ok(mut s) = playback.lock() {
        s.current_id = Some(id.to_string());
        s.current_index = Some(entry.index);
        s.is_playing = true;
        s.position_ms = 0;
        s.duration_ms = entry.duration_ms;
    }
}

fn clear_playback(playback: &Arc<Mutex<PlaybackState>>) {
    if let Ok(mut s) = playback.lock() {
        s.current_id = None; s.current_index = None;
        s.is_playing = false; s.position_ms = 0; s.duration_ms = 0;
    }
}

#[inline]
fn track_pos_ms(entry: &TrackEntry, sr: u32, ch: u16) -> u64 {
    samples_to_ms(entry.position_samples.load(Ordering::Relaxed), sr, ch)
}

#[inline]
fn ms_to_samples(ms: u64, sample_rate: u32, channels: u16) -> u64 {
    let ch = channels.max(1) as u64;
    (ms.saturating_mul(sample_rate as u64) / 1000) * ch
}

#[inline]
fn samples_to_ms(samples: u64, sample_rate: u32, channels: u16) -> u64 {
    let ch = channels.max(1) as u64;
    if sample_rate == 0 || ch == 0 { return 0; }
    (samples / ch).saturating_mul(1000) / sample_rate as u64
}
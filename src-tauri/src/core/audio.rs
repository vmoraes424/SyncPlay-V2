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
    fade_out_time_ms: u64,
    manual_fade_out_ms: u64,
    seek_flush_pending: Arc<AtomicBool>,
    fade_out_start_pos_ms: Option<u64>,
    fade_out_duration_ms: Option<u64>,
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
    let mut finishing: Vec<TrackEntry> = Vec::new();

    loop {
        match rx.recv_timeout(Duration::from_millis(33)) {
            Ok(cmd) => handle_command(
                cmd, &mut queue, &mut current, &mut finishing,
                &mixer_tx, &playback, sr, ch,
            ),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        process_transitions(
            &queue, &mut current, &mut finishing,
            &mixer_tx, &playback, sr, ch,
        );
        
        // Limpa tracks que já terminaram de tocar naturalmente ou terminaram o fadeout
        finishing.retain_mut(|t| {
            let mut remove = false;
            if t.finished.load(Ordering::Acquire) {
                remove = true;
            } else if let (Some(start_pos), Some(dur)) = (t.fade_out_start_pos_ms, t.fade_out_duration_ms) {
                let cur_pos = track_pos_ms(t, sr, ch);
                let elapsed = cur_pos.saturating_sub(start_pos);
                if dur > 0 {
                    let progress = (elapsed as f32 / dur as f32).clamp(0.0, 1.0);
                    let angle = progress * FRAC_PI_2;
                    store_volume(&t.volume, angle.cos().powi(2));
                    if progress >= 1.0 {
                        remove = true;
                    }
                } else {
                    remove = true;
                }
            }

            if remove {
                let _ = t.decoder.cmd_tx.send(DecoderCmd::Stop);
                let _ = mixer_tx.send(MixerCommand::RemoveTrack(t.id.clone()));
                false // remove
            } else {
                true // keep
            }
        });

        // Sincroniza estado unificado de posições para UI
        if let Ok(mut s) = playback.lock() {
            if let Some(c) = current.as_ref() {
                let cur_pos = track_pos_ms(c, sr, ch);
                s.position_ms = if c.duration_ms > 0 { cur_pos.min(c.duration_ms) } else { cur_pos };
                s.is_playing = c.active.load(Ordering::Relaxed) && !c.finished.load(Ordering::Acquire);
            }

            s.background_ids.clear();
            s.background_positions.clear();

            for f in finishing.iter() {
                s.background_ids.push(f.id.clone());
                s.background_positions.insert(f.id.clone(), track_pos_ms(f, sr, ch));
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_command(
    cmd: AudioCommand,
    queue: &mut Vec<AudioItem>,
    current: &mut Option<TrackEntry>,
    finishing: &mut Vec<TrackEntry>,
    mixer_tx: &Sender<MixerCommand>,
    playback: &Arc<Mutex<PlaybackState>>,
    sr: u32,
    ch: u16,
) {
    match cmd {
        AudioCommand::SetQueue(items) => *queue = items,
        AudioCommand::PlayIndex(idx) => {
            let Some(item) = queue.get(idx).cloned() else { return };
            
            if let Some(mut c) = current.take() {
                if c.manual_fade_out_ms > 0 {
                    c.fade_out_start_pos_ms = Some(track_pos_ms(&c, sr, ch));
                    c.fade_out_duration_ms = Some(c.manual_fade_out_ms);
                }
                finishing.push(c);
            }

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
            for t in finishing.iter() {
                t.active.store(false, Ordering::Release);
                let _ = mixer_tx.send(MixerCommand::SetTrackState { id: t.id.clone(), playing: false });
            }
            if let Ok(mut s) = playback.lock() { s.is_playing = false; }
        }
        AudioCommand::Resume => {
            if let Some(c) = current.as_ref() {
                c.active.store(true, Ordering::Release);
                let _ = mixer_tx.send(MixerCommand::SetTrackState { id: c.id.clone(), playing: true });
            }
            for t in finishing.iter() {
                t.active.store(true, Ordering::Release);
                let _ = mixer_tx.send(MixerCommand::SetTrackState { id: t.id.clone(), playing: true });
            }
            if let Ok(mut s) = playback.lock() { s.is_playing = true; }
        }
        AudioCommand::Seek(ms) => {
            for t in finishing.drain(..) {
                stop_entry(Some(t), mixer_tx);
            }

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
            let next_idx = current.as_ref().map(|c| c.index + 1);

            if let Some(mut c) = current.take() {
                if fade_ms > 0 {
                    c.fade_out_start_pos_ms = Some(track_pos_ms(&c, sr, ch));
                    c.fade_out_duration_ms = Some(fade_ms);
                }
                finishing.push(c);
            }

            if let Some(ni) = next_idx.and_then(|i| queue.get(i)).cloned() {
                if let Some(entry) = make_track_entry(&ni, next_idx.unwrap(), 1.0, mixer_tx, sr, ch) {
                    update_playback_started(&entry, &ni.id, playback);
                    *current = Some(entry);
                }
            } else { clear_playback(playback); }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn process_transitions(
    queue: &[AudioItem],
    current: &mut Option<TrackEntry>,
    finishing: &mut Vec<TrackEntry>,
    mixer_tx: &Sender<MixerCommand>,
    playback: &Arc<Mutex<PlaybackState>>,
    sr: u32,
    ch: u16,
) {
    let Some((cur_pos, cur_idx, cur_mix_end, cur_fade_out_time, cur_finished)) = current.as_ref().map(|c| {
        (track_pos_ms(c, sr, ch), c.index, c.mix_end_ms, c.fade_out_time_ms, c.finished.load(Ordering::Acquire))
    }) else { return; };

    if let Some(mix_end) = cur_mix_end {
        // Antecipa o mix em 1 segundo (1000ms) para compensar o tempo do crossfade
        if cur_pos >= mix_end.saturating_sub(1000) {
            let next_idx = cur_idx + 1;
            if let Some(next_item) = queue.get(next_idx).cloned() {
                if let Some(mut old) = current.take() {
                    if cur_fade_out_time > 0 {
                        old.fade_out_start_pos_ms = Some(cur_pos);
                        old.fade_out_duration_ms = Some(cur_fade_out_time);
                    }
                    finishing.push(old);
                }
                if let Some(entry) = make_track_entry(&next_item, next_idx, 1.0, mixer_tx, sr, ch) {
                    update_playback_started(&entry, &next_item.id, playback);
                    *current = Some(entry);
                }
                return;
            }
            
            // Se não tem próxima música, faz fadeout no mix_end
            if cur_fade_out_time > 0 {
                if let Some(mut old) = current.take() {
                    old.fade_out_start_pos_ms = Some(cur_pos);
                    old.fade_out_duration_ms = Some(cur_fade_out_time);
                    finishing.push(old);
                }
                clear_playback(playback);
                return;
            }
        }
    }

    if cur_finished {
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
        fade_out_time_ms: item.fade_out_time_ms.unwrap_or(0),
        manual_fade_out_ms: item.manual_fade_out_ms.unwrap_or(1500),
        seek_flush_pending,
        fade_out_start_pos_ms: None,
        fade_out_duration_ms: None,
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
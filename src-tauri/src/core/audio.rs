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

const PREBUFFER_SECONDS: usize = 1;

static NEXT_MIXER_TRACK_ID: AtomicU64 = AtomicU64::new(1);

struct TrackEntry {
    /// ID lógico da playlist (ex.: `plKey-blockKey-musicKey`); coincide com `AudioItem.id` e com a UI.
    id: String,
    /// ID único da instância no mixer (evita colisão ao sobrepor duas decodificações da mesma faixa).
    mixer_id: String,
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
    let shared_routing_for_thread = shared_routing.clone();
    
    thread::spawn(move || {
        engine_loop(
            rx,
            mixer_for_thread,
            playback_for_thread,
            shared_routing_for_thread,
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
    shared_routing: Arc<Mutex<crate::models::mixer::MixerRouting>>,
    sr: u32,
    ch: u16,
) {
    let mut queue: Vec<AudioItem> = Vec::new();
    let mut current: Option<TrackEntry> = None;
    let mut finishing: Vec<TrackEntry> = Vec::new();
    let mut independent: Vec<TrackEntry> = Vec::new();

    loop {
        match rx.recv_timeout(Duration::from_millis(33)) {
            Ok(cmd) => handle_command(
                cmd, &mut queue, &mut current, &mut finishing, &mut independent,
                &mixer_tx, &playback, &shared_routing, sr, ch,
            ),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        process_transitions(
            &queue, &mut current, &mut finishing,
            &mixer_tx, &playback, &shared_routing, sr, ch,
        );
        
        // Limpa tracks que já terminaram de tocar naturalmente ou terminaram o fadeout
        let mut retain_track = |t: &mut TrackEntry| -> bool {
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
                let _ = mixer_tx.send(MixerCommand::RemoveTrack(t.mixer_id.clone()));
                false // remove
            } else {
                true // keep
            }
        };

        finishing.retain_mut(&mut retain_track);
        independent.retain_mut(&mut retain_track);

        // Sincroniza estado unificado de posições para UI
        if let Ok(mut s) = playback.lock() {
            if let Some(c) = current.as_ref() {
                let cur_pos = track_pos_ms(c, sr, ch);
                s.position_ms = if c.duration_ms > 0 { cur_pos.min(c.duration_ms) } else { cur_pos };
                s.is_playing = c.active.load(Ordering::Relaxed) && !c.finished.load(Ordering::Acquire);
            }

            s.background_ids.clear();
            s.background_positions.clear();
            s.background_durations.clear();

            for f in finishing.iter() {
                s.background_ids.push(f.id.clone());
                s.background_positions.insert(f.id.clone(), track_pos_ms(f, sr, ch));
                s.background_durations.insert(f.id.clone(), f.duration_ms);
            }

            s.independent_positions.clear();
            s.independent_durations.clear();
            for i in independent.iter() {
                s.independent_positions.insert(i.id.clone(), track_pos_ms(i, sr, ch));
                s.independent_durations.insert(i.id.clone(), i.duration_ms);
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn skip_with_fade_to_target_index(
    target_index: Option<usize>,
    queue: &[AudioItem],
    current: &mut Option<TrackEntry>,
    finishing: &mut Vec<TrackEntry>,
    mixer_tx: &Sender<MixerCommand>,
    playback: &Arc<Mutex<PlaybackState>>,
    shared_routing: &Arc<Mutex<crate::models::mixer::MixerRouting>>,
    sr: u32,
    ch: u16,
) {
    let fade_ms = current.as_ref().map(|c| c.manual_fade_out_ms).unwrap_or(1500);

    if let Some(mut c) = current.take() {
        if fade_ms > 0 {
            c.fade_out_start_pos_ms = Some(track_pos_ms(&c, sr, ch));
            c.fade_out_duration_ms = Some(fade_ms);
        }
        finishing.push(c);
    }

    let Some(ti) = target_index else {
        clear_playback(playback);
        return;
    };

    if let Some(item) = queue.get(ti).cloned() {
        if let Some(entry) = make_track_entry(&item, ti, 1.0, mixer_tx, shared_routing, sr, ch) {
            update_playback_started(&entry, &item.id, playback);
            *current = Some(entry);
        } else {
            clear_playback(playback);
        }
    } else {
        clear_playback(playback);
    }
}

#[inline]
fn audio_item_with_mixer_bus(item: &AudioItem, mixer_bus: Option<String>) -> AudioItem {
    let mut out = item.clone();
    if let Some(ref b) = mixer_bus {
        if !b.is_empty() {
            out.mixer_bus = Some(b.clone());
        }
    }
    out
}

/// Seek inicial na faixa recém-aberta e alinha `PlaybackState.position_ms` (após `update_playback_started`).
fn entry_seek_to_ms(
    entry: TrackEntry,
    item_id: &str,
    position_ms: u64,
    playback: &Arc<Mutex<PlaybackState>>,
    sr: u32,
    ch: u16,
) -> TrackEntry {
    let dur = entry.duration_ms;
    let seek_ms = if dur > 0 {
        position_ms.min(dur.saturating_sub(1))
    } else {
        position_ms
    };
    let _ = entry.decoder.cmd_tx.send(DecoderCmd::Seek(seek_ms));
    entry
        .position_samples
        .store(ms_to_samples(seek_ms, sr, ch), Ordering::Release);
    entry.seek_flush_pending.store(true, Ordering::Release);
    store_volume(&entry.volume, 1.0);
    update_playback_started(&entry, item_id, playback);
    if let Ok(mut s) = playback.lock() {
        s.position_ms = seek_ms;
    }
    entry
}

#[allow(clippy::too_many_arguments)]
fn handle_command(
    cmd: AudioCommand,
    queue: &mut Vec<AudioItem>,
    current: &mut Option<TrackEntry>,
    finishing: &mut Vec<TrackEntry>,
    independent: &mut Vec<TrackEntry>,
    mixer_tx: &Sender<MixerCommand>,
    playback: &Arc<Mutex<PlaybackState>>,
    shared_routing: &Arc<Mutex<crate::models::mixer::MixerRouting>>,
    sr: u32,
    ch: u16,
) {
    match cmd {
        AudioCommand::SetQueue(items) => *queue = items,
        AudioCommand::PlayIndex(idx) => {
            if idx >= queue.len() {
                skip_with_fade_to_target_index(
                    None,
                    queue,
                    current,
                    finishing,
                    mixer_tx,
                    playback,
                    shared_routing,
                    sr,
                    ch,
                );
                return;
            }

            let Some(item) = queue.get(idx).cloned() else {
                return;
            };

            if let Some(mut c) = current.take() {
                if c.manual_fade_out_ms > 0 {
                    c.fade_out_start_pos_ms = Some(track_pos_ms(&c, sr, ch));
                    c.fade_out_duration_ms = Some(c.manual_fade_out_ms);
                }
                finishing.push(c);
            }

            if let Some(entry) = make_track_entry(&item, idx, 1.0, mixer_tx, shared_routing, sr, ch) {
                update_playback_started(&entry, &item.id, playback);
                *current = Some(entry);
            }
        }
        AudioCommand::Pause => {
            if let Some(c) = current.as_ref() {
                c.active.store(false, Ordering::Release);
                let _ = mixer_tx.send(MixerCommand::SetTrackState { id: c.mixer_id.clone(), playing: false });
            }
            for t in finishing.iter() {
                t.active.store(false, Ordering::Release);
                let _ = mixer_tx.send(MixerCommand::SetTrackState { id: t.mixer_id.clone(), playing: false });
            }
            for t in independent.iter() {
                t.active.store(false, Ordering::Release);
                let _ = mixer_tx.send(MixerCommand::SetTrackState { id: t.mixer_id.clone(), playing: false });
            }
            if let Ok(mut s) = playback.lock() { s.is_playing = false; }
        }
        AudioCommand::Resume => {
            if let Some(c) = current.as_ref() {
                c.active.store(true, Ordering::Release);
                let _ = mixer_tx.send(MixerCommand::SetTrackState { id: c.mixer_id.clone(), playing: true });
            }
            for t in finishing.iter() {
                t.active.store(true, Ordering::Release);
                let _ = mixer_tx.send(MixerCommand::SetTrackState { id: t.mixer_id.clone(), playing: true });
            }
            for t in independent.iter() {
                t.active.store(true, Ordering::Release);
                let _ = mixer_tx.send(MixerCommand::SetTrackState { id: t.mixer_id.clone(), playing: true });
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
            let target_index = current.as_ref().map(|c| c.index + 1);
            skip_with_fade_to_target_index(
                target_index,
                queue,
                current,
                finishing,
                mixer_tx,
                playback,
                shared_routing,
                sr,
                ch,
            );
        }
        AudioCommand::SeekWithFade {
            position_ms,
            mixer_bus,
        } => {
            for t in finishing.drain(..) {
                stop_entry(Some(t), mixer_tx);
            }

            let Some((idx, fade_ms)) = current.as_ref().map(|c| (c.index, c.manual_fade_out_ms)) else {
                return;
            };

            let Some(base_item) = queue.get(idx).cloned() else {
                return;
            };
            let item = audio_item_with_mixer_bus(&base_item, mixer_bus);

            if let Some(mut c) = current.take() {
                if fade_ms > 0 {
                    c.fade_out_start_pos_ms = Some(track_pos_ms(&c, sr, ch));
                    c.fade_out_duration_ms = Some(fade_ms);
                }
                finishing.push(c);
            }

            if let Some(entry) = make_track_entry(&item, idx, 1.0, mixer_tx, shared_routing, sr, ch) {
                let entry = entry_seek_to_ms(entry, &item.id, position_ms, playback, sr, ch);
                *current = Some(entry);
            }
        }
        AudioCommand::PlayIndexWithSeekFade {
            index,
            position_ms,
            mixer_bus,
        } => {
            for t in finishing.drain(..) {
                stop_entry(Some(t), mixer_tx);
            }
            if index >= queue.len() {
                skip_with_fade_to_target_index(
                    None,
                    queue,
                    current,
                    finishing,
                    mixer_tx,
                    playback,
                    shared_routing,
                    sr,
                    ch,
                );
                return;
            }

            let Some(base_item) = queue.get(index).cloned() else {
                return;
            };
            let item = audio_item_with_mixer_bus(&base_item, mixer_bus);

            let fade_ms = current
                .as_ref()
                .map(|c| c.manual_fade_out_ms)
                .unwrap_or(1500);
            if let Some(mut c) = current.take() {
                if fade_ms > 0 {
                    c.fade_out_start_pos_ms = Some(track_pos_ms(&c, sr, ch));
                    c.fade_out_duration_ms = Some(fade_ms);
                }
                finishing.push(c);
            }

            if let Some(entry) = make_track_entry(&item, index, 1.0, mixer_tx, shared_routing, sr, ch) {
                let entry = entry_seek_to_ms(entry, &item.id, position_ms, playback, sr, ch);
                *current = Some(entry);
            } else {
                clear_playback(playback);
            }
        }
        AudioCommand::PlayIndependent(item) => {
            if let Some(entry) = make_track_entry(&item, 0, 1.0, mixer_tx, shared_routing, sr, ch) {
                independent.push(entry);
            }
        }
        AudioCommand::StopIndependent(id) => {
            if let Some(idx) = independent.iter().position(|t| t.id == id) {
                let mut t = independent.remove(idx);
                let fade_ms = t.manual_fade_out_ms;
                if fade_ms > 0 {
                    t.fade_out_start_pos_ms = Some(track_pos_ms(&t, sr, ch));
                    t.fade_out_duration_ms = Some(fade_ms);
                    finishing.push(t);
                } else {
                    stop_entry(Some(t), mixer_tx);
                }
            }
        }
        AudioCommand::SeekIndependent(id, ms) => {
            if let Some(t) = independent.iter_mut().find(|t| t.id == id) {
                let _ = t.decoder.cmd_tx.send(DecoderCmd::Seek(ms));
                t.position_samples.store(ms_to_samples(ms, sr, ch), Ordering::Release);
                t.seek_flush_pending.store(true, Ordering::Release);
                store_volume(&t.volume, 1.0);
            }
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
    shared_routing: &Arc<Mutex<crate::models::mixer::MixerRouting>>,
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
                        old.fade_out_start_pos_ms = Some(mix_end);
                        old.fade_out_duration_ms = Some(cur_fade_out_time);
                    }
                    finishing.push(old);
                }
                if let Some(entry) = make_track_entry(&next_item, next_idx, 1.0, mixer_tx, shared_routing, sr, ch) {
                    update_playback_started(&entry, &next_item.id, playback);
                    *current = Some(entry);
                }
                return;
            }
            
            // Se não tem próxima música, faz fadeout no mix_end
            if cur_fade_out_time > 0 {
                if let Some(mut old) = current.take() {
                    old.fade_out_start_pos_ms = Some(mix_end);
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
            let _ = mixer_tx.send(MixerCommand::RemoveTrack(old.mixer_id.clone()));
        }

        if let Some(next_item) = queue.get(next_idx).cloned() {
            if let Some(entry) = make_track_entry(&next_item, next_idx, 1.0, mixer_tx, shared_routing, sr, ch) {
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
    mixer_tx: &Sender<MixerCommand>,
    shared_routing: &Arc<Mutex<crate::models::mixer::MixerRouting>>,
    sr: u32, ch: u16,
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

    let mixer_id = format!(
        "m{}",
        NEXT_MIXER_TRACK_ID.fetch_add(1, Ordering::Relaxed)
    );

    let channel_id = item.mixer_bus.clone().unwrap_or_else(|| {
        let media_type = item.media_type.as_deref().unwrap_or("");
        if media_type.eq_ignore_ascii_case("vem") {
            crate::models::mixer::CHANNEL_VEM.to_string()
        } else {
            crate::models::mixer::CHANNEL_PLAYLIST.to_string()
        }
    });

    // Garante que o canal exista no roteamento compartilhado
    {
        if let Ok(mut routing) = shared_routing.lock() {
            let mut changed = false;
            if !routing.channels.contains_key(&channel_id) {
                routing.channels.insert(channel_id.clone(), crate::models::mixer::ChannelGain::default());
                changed = true;
            }
            if !routing.routing.contains_key(&channel_id) {
                routing.routing.insert(channel_id.clone(), crate::models::mixer::ChannelRouting::default());
                changed = true;
            }
            if changed {
                let _ = mixer_tx.send(MixerCommand::UpdateRouting(routing.clone()));
                // Salvar no disco seria ideal, mas como estamos na thread de áudio,
                // vamos deixar apenas em memória. O próximo save explícito (ex: alterar volume) salvará.
            }
        }
    }

    let track = AudioTrack {
        id: mixer_id.clone(),
        channel_id,
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
        mixer_id,
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
        let _ = mixer_tx.send(MixerCommand::RemoveTrack(e.mixer_id.clone()));
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
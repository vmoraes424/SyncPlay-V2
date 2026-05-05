use crate::core::mixer::{
    channel_audio_gains, AtomicF32, DynamicGainSource, VuMeterSource,
};
use crate::models::audio::{AudioCommand, AudioItem, PlaybackState};
use crate::models::mixer::{MixerRouting, VuLevel, CHANNEL_PLAYLIST};
use std::sync::Arc;
use rodio::{Decoder, OutputStream, Sink, Source};
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const MANUAL_CROSSFADE_OUT_MS: u64 = 3000;
const MANUAL_CROSSFADE_IN_MS: u64 = 1500;

/// Com o sink **pausado**, o rodio não consome samples → `VuMeterSource` não roda e picos/RMS
/// ficariam congelados no último valor. Decaimos aqui (e zeramos explícitos em `Pause`).
fn decay_playlist_vu(vu: &mut VuLevel) {
    vu.rms_left = (vu.rms_left * 0.85).max(0.0);
    vu.rms_right = (vu.rms_right * 0.85).max(0.0);
    vu.peak_left = (vu.peak_left * 0.97).max(0.0);
    vu.peak_right = (vu.peak_right * 0.97).max(0.0);
    if vu.rms_left < 0.0001
        && vu.rms_right < 0.0001
        && vu.peak_left < 0.0001
        && vu.peak_right < 0.0001
    {
        *vu = VuLevel::default();
    }
}

// ---------------------------------------------------------------------------
// Faixa ativa
// ---------------------------------------------------------------------------

struct ActiveTrack {
    sink: Sink,
    item: AudioItem,
    index: usize,
    last_update: Instant,
    position: Duration,
    is_playing: bool,
    mix_triggered: bool,
    fade_out_start_pos: Option<u64>,
    fade_in_start_pos: Option<u64>,
    /// Sobrescreve item.fade_duration_ms no fade-in (crossfade manual).
    fade_in_duration_ms: Option<u64>,
    /// Sobrescreve item.fade_out_time_ms no fade-out (crossfade manual).
    fade_out_duration_ms: Option<u64>,
    /// Fator de fade atual [0.0, 1.0].
    fade_factor: f32,
}

impl ActiveTrack {
    fn update_position(&mut self) {
        if self.is_playing {
            let now = Instant::now();
            self.position += now.duration_since(self.last_update);
            self.last_update = now;
        }
    }

    fn play(&mut self) {
        if !self.is_playing {
            self.last_update = Instant::now();
            self.is_playing = true;
            self.sink.play();
        }
    }

    fn pause(&mut self) {
        if self.is_playing {
            self.update_position();
            self.is_playing = false;
            self.sink.pause();
        }
    }

    fn seek(&mut self, target: Duration) {
        self.update_position();
        if self.sink.try_seek(target).is_ok() {
            self.position = target;
            self.last_update = Instant::now();
        }
    }
}

// ---------------------------------------------------------------------------
// Abre arquivo e cria Sink com VuMeterSource
// ---------------------------------------------------------------------------

fn open_track(
    item: &AudioItem,
    stream_handle: &rodio::OutputStreamHandle,
    vu: Arc<Mutex<VuLevel>>,
    strip_gain: Arc<AtomicF32>,
) -> Option<Sink> {
    let file = File::open(&item.path).ok()?;
    let decoder = Decoder::new(BufReader::new(file)).ok()?;
    let f32_src = decoder.convert_samples::<f32>();
    let gained = DynamicGainSource::new(f32_src, strip_gain);
    let vu_src = VuMeterSource::new(gained, vu);
    let sink = Sink::try_new(stream_handle).ok()?;
    sink.append(vu_src);
    Some(sink)
}

// ---------------------------------------------------------------------------
// Engine principal
// ---------------------------------------------------------------------------

pub fn start_audio_engine(
    mixer_routing: Arc<Mutex<MixerRouting>>,
    playlist_vu: Arc<Mutex<VuLevel>>,
    vu_snapshot: Arc<Mutex<HashMap<String, VuLevel>>>,
) -> (mpsc::Sender<AudioCommand>, Arc<Mutex<PlaybackState>>) {
    let (tx, rx) = mpsc::channel::<AudioCommand>();
    let state = Arc::new(Mutex::new(PlaybackState {
        current_index: None,
        current_id: None,
        is_playing: false,
        position_ms: 0,
        duration_ms: 0,
        background_ids: Vec::new(),
        background_positions: HashMap::new(),
    }));

    let state_clone = state.clone();

    thread::spawn(move || {
        let (_stream, stream_handle) = OutputStream::try_default().unwrap();
        let playlist_strip_gain = Arc::new(AtomicF32::new(1.0));
        let mut queue: Vec<AudioItem> = Vec::new();
        let mut current_track: Option<ActiveTrack> = None;
        let mut background_tracks: Vec<ActiveTrack> = Vec::new();

        loop {
            // Fader/mute → antes do VU; OUT + rotas + buses → só no volume do sink (DAC).
            let (strip, playback_path) = {
                let r = mixer_routing.lock().unwrap();
                channel_audio_gains(&r, CHANNEL_PLAYLIST)
            };
            playlist_strip_gain.store(strip);
            let mfactor = playback_path;

            let mut skip_requested = false;

            // ------------------------------------------------------------------
            // Processa comandos da fila
            // ------------------------------------------------------------------
            while let Ok(cmd) = rx.try_recv() {
                match cmd {
                    AudioCommand::SetQueue(new_queue) => {
                        queue = new_queue;
                        if let Some(track) = &mut current_track {
                            if let Some((new_idx, new_item)) = queue
                                .iter()
                                .enumerate()
                                .find(|(_, i)| i.id == track.item.id)
                            {
                                track.index = new_idx;
                                track.item = new_item.clone();
                            }
                        }
                        for bt in &mut background_tracks {
                            if let Some((new_idx, new_item)) = queue
                                .iter()
                                .enumerate()
                                .find(|(_, i)| i.id == bt.item.id)
                            {
                                bt.index = new_idx;
                                bt.item = new_item.clone();
                            }
                        }
                    }

                    AudioCommand::PlayIndex(idx) => {
                        if idx < queue.len() {
                            let item = queue[idx].clone();
                            if let Some(sink) = open_track(
                                &item,
                                &stream_handle,
                                playlist_vu.clone(),
                                playlist_strip_gain.clone(),
                            ) {
                                let mut crossfade = false;
                                if let Some(mut old_track) = current_track.take() {
                                    crossfade = old_track.is_playing;
                                    if crossfade {
                                        let fo = old_track
                                            .item
                                            .manual_fade_out_ms
                                            .unwrap_or(MANUAL_CROSSFADE_OUT_MS);
                                        if fo > 0 {
                                            old_track.fade_out_start_pos =
                                                Some(old_track.position.as_millis() as u64);
                                            old_track.fade_out_duration_ms = Some(fo);
                                        }
                                        background_tracks.push(old_track);
                                    } else {
                                        old_track.sink.stop();
                                    }
                                }

                                log_debug(&format!("PlayIndex={} crossfade={}", idx, crossfade));

                                let initial_ff = if crossfade { 0.0_f32 } else { 1.0_f32 };
                                sink.set_volume(initial_ff * mfactor);
                                sink.play();

                                current_track = Some(ActiveTrack {
                                    sink,
                                    item,
                                    index: idx,
                                    last_update: Instant::now(),
                                    position: Duration::ZERO,
                                    is_playing: true,
                                    mix_triggered: false,
                                    fade_out_start_pos: None,
                                    fade_in_start_pos: if crossfade { Some(0) } else { None },
                                    fade_in_duration_ms: if crossfade {
                                        Some(MANUAL_CROSSFADE_IN_MS)
                                    } else {
                                        None
                                    },
                                    fade_out_duration_ms: None,
                                    fade_factor: initial_ff,
                                });
                            }
                        }
                    }

                    AudioCommand::Pause => {
                        if let Some(t) = &mut current_track {
                            t.pause();
                        }
                        for bt in &mut background_tracks {
                            bt.pause();
                        }
                        if let Ok(mut vu) = playlist_vu.lock() {
                            *vu = VuLevel::default();
                        }
                    }

                    AudioCommand::Resume => {
                        if let Some(t) = &mut current_track {
                            t.play();
                        }
                        for bt in &mut background_tracks {
                            bt.play();
                        }
                    }

                    AudioCommand::Seek(pos_ms) => {
                        if let Some(t) = &mut current_track {
                            t.seek(Duration::from_millis(pos_ms));
                        }
                    }

                    AudioCommand::SkipWithFade => {
                        skip_requested = true;
                    }
                }
            }

            // ------------------------------------------------------------------
            // Tick da faixa atual
            // ------------------------------------------------------------------
            let mut auto_play_next: Option<usize> = None;
            let mut auto_play_is_manual = false;

            if let Some(track) = &mut current_track {
                track.update_position();
                let pos_ms = track.position.as_millis() as u64;

                if skip_requested && !track.mix_triggered {
                    log_debug(&format!("Skip manual pos={}", pos_ms));
                    track.mix_triggered = true;
                    auto_play_next = Some(track.index + 1);
                    auto_play_is_manual = true;
                }

                // Fade in
                let ff = if let Some(start_pos) = track.fade_in_start_pos {
                    let dur = track
                        .fade_in_duration_ms
                        .or(track.item.fade_duration_ms)
                        .unwrap_or(2000);
                    let elapsed = pos_ms.saturating_sub(start_pos);
                    if dur > 0 && elapsed < dur {
                        elapsed as f32 / dur as f32
                    } else {
                        track.fade_in_start_pos = None;
                        1.0
                    }
                } else {
                    1.0
                };

                // Atualiza volume se o fade ou o mixer mudaram
                if (ff - track.fade_factor).abs() > 0.001 {
                    track.fade_factor = ff;
                }
                track.sink.set_volume(track.fade_factor * mfactor);

                let dur_ms = track.item.duration_ms.unwrap_or(0);

                // Trigger de mix
                if !track.mix_triggered {
                    if let Some(mix_end) = track.item.mix_end_ms {
                        let trigger_at = mix_end.saturating_sub(1000);
                        if mix_end > 0 && pos_ms >= trigger_at {
                            log_debug(&format!("Mix por mix_end pos={} mix_end={}", pos_ms, mix_end));
                            track.mix_triggered = true;
                            auto_play_next = Some(track.index + 1);
                        }
                    } else if dur_ms > 0 && pos_ms >= dur_ms {
                        log_debug(&format!("Mix por dur_ms pos={}", pos_ms));
                        track.mix_triggered = true;
                        auto_play_next = Some(track.index + 1);
                    }
                }

                if track.sink.empty() && !track.mix_triggered {
                    log_debug(&format!("Mix por sink vazio pos={}", pos_ms));
                    track.mix_triggered = true;
                    auto_play_next = Some(track.index + 1);
                }

                if let Ok(mut st) = state_clone.lock() {
                    st.current_index = Some(track.index);
                    st.current_id = Some(track.item.id.clone());
                    st.is_playing = track.is_playing;
                    st.position_ms = pos_ms;
                    st.duration_ms = dur_ms;
                }

                if !track.is_playing {
                    if let Ok(mut vu) = playlist_vu.lock() {
                        decay_playlist_vu(&mut vu);
                    }
                }
            } else {
                // Sem faixa: decai o VU
                if let Ok(mut vu) = playlist_vu.lock() {
                    decay_playlist_vu(&mut vu);
                }
                if let Ok(mut st) = state_clone.lock() {
                    st.is_playing = false;
                }
            }

            // Snapshot VU para o frontend
            {
                let vu = playlist_vu.lock().unwrap().clone();
                vu_snapshot
                    .lock()
                    .unwrap()
                    .insert(CHANNEL_PLAYLIST.to_string(), vu);
            }

            // ------------------------------------------------------------------
            // Auto-advance para a próxima faixa
            // ------------------------------------------------------------------
            if let Some(next_idx) = auto_play_next {
                if next_idx < queue.len() {
                    let item = queue[next_idx].clone();
                    if let Some(sink) = open_track(
                        &item,
                        &stream_handle,
                        playlist_vu.clone(),
                        playlist_strip_gain.clone(),
                    ) {
                        log_debug(&format!("Auto-play next={}", next_idx));

                        if let Some(mut old_track) = current_track.take() {
                            if auto_play_is_manual {
                                let fo = old_track
                                    .item
                                    .manual_fade_out_ms
                                    .unwrap_or(MANUAL_CROSSFADE_OUT_MS);
                                if fo > 0 {
                                    old_track.fade_out_start_pos =
                                        Some(old_track.position.as_millis() as u64);
                                    old_track.fade_out_duration_ms = Some(fo);
                                }
                            } else {
                                let fo = old_track.item.fade_out_time_ms.unwrap_or(0);
                                if fo > 0 {
                                    old_track.fade_out_start_pos =
                                        Some(old_track.position.as_millis() as u64);
                                }
                            }
                            background_tracks.push(old_track);
                        }

                        sink.set_volume(0.0);
                        sink.play();

                        current_track = Some(ActiveTrack {
                            sink,
                            item,
                            index: next_idx,
                            last_update: Instant::now(),
                            position: Duration::ZERO,
                            is_playing: true,
                            mix_triggered: false,
                            fade_out_start_pos: None,
                            fade_in_start_pos: Some(0),
                            fade_in_duration_ms: None,
                            fade_out_duration_ms: None,
                            fade_factor: 0.0,
                        });
                    }
                } else {
                    current_track = None;
                    if let Ok(mut st) = state_clone.lock() {
                        st.current_index = None;
                        st.current_id = None;
                        st.position_ms = 0;
                        st.is_playing = false;
                    }
                }
            }

            // ------------------------------------------------------------------
            // Fade-out das faixas em background
            // ------------------------------------------------------------------
            for bt in &mut background_tracks {
                bt.update_position();
                let pos_ms = bt.position.as_millis() as u64;

                if let Some(start_pos) = bt.fade_out_start_pos {
                    let dur = bt
                        .fade_out_duration_ms
                        .or(bt.item.fade_out_time_ms)
                        .unwrap_or(0);
                    if dur > 0 {
                        let elapsed = pos_ms.saturating_sub(start_pos);
                        if elapsed < dur {
                            let ff = 1.0 - (elapsed as f32 / dur as f32);
                            bt.sink.set_volume(ff * mfactor);
                        } else {
                            bt.sink.set_volume(0.0);
                            bt.sink.stop();
                        }
                    }
                }
            }
            background_tracks.retain(|bt| {
                let empty = bt.sink.empty();
                if empty {
                    log_debug(&format!("Background idx={} removido", bt.index));
                }
                !empty
            });

            if let Ok(mut st) = state_clone.lock() {
                st.background_ids =
                    background_tracks.iter().map(|bt| bt.item.id.clone()).collect();
                st.background_positions = background_tracks
                    .iter()
                    .map(|bt| (bt.item.id.clone(), bt.position.as_millis() as u64))
                    .collect();
            }

            thread::sleep(Duration::from_millis(30));
        }
    });

    (tx, state)
}

// ---------------------------------------------------------------------------
// Log de debug
// ---------------------------------------------------------------------------

fn log_debug(msg: &str) {
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("debug_audio.log")
    {
        let _ = writeln!(file, "{}", msg);
    }
}

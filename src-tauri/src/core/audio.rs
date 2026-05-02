use crate::models::audio::{AudioCommand, AudioItem, PlaybackState};
use rodio::{Decoder, OutputStream, Sink};
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// Crossfade ao trocar faixa manualmente (play / tecla): saída da anterior e entrada da nova.
const MANUAL_CROSSFADE_OUT_MS: u64 = 3000;
const MANUAL_CROSSFADE_IN_MS: u64 = 1500;

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
    /// Sobrescreve `item.fade_duration_ms` no fade-in (ex.: troca manual).
    fade_in_duration_ms: Option<u64>,
    /// Sobrescreve `item.fade_duration_ms` no fade-out em background (ex.: troca manual).
    fade_out_duration_ms: Option<u64>,
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

pub fn start_audio_engine() -> (mpsc::Sender<AudioCommand>, Arc<Mutex<PlaybackState>>) {
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
        let mut queue: Vec<AudioItem> = Vec::new();

        let mut current_track: Option<ActiveTrack> = None;
        let mut background_tracks: Vec<ActiveTrack> = Vec::new();

        loop {
            let mut skip_requested = false;

            // Check commands
            while let Ok(cmd) = rx.try_recv() {
                match cmd {
                    AudioCommand::SetQueue(new_queue) => {
                        queue = new_queue;
                        // Realinha índices após editar a fila (inserir/remover itens), sem recriar o sink.
                        if let Some(track) = &mut current_track {
                            if let Some(new_idx) = queue.iter().position(|i| i.id == track.item.id)
                            {
                                track.index = new_idx;
                            }
                        }
                        for bt in &mut background_tracks {
                            if let Some(new_idx) = queue.iter().position(|i| i.id == bt.item.id) {
                                bt.index = new_idx;
                            }
                        }
                    }
                    AudioCommand::PlayIndex(idx) => {
                        if idx < queue.len() {
                            let item = queue[idx].clone();
                            if let Ok(file) = File::open(&item.path) {
                                if let Ok(decoder) = Decoder::new(BufReader::new(file)) {
                                    // Crossfade só se a faixa atual estiver tocando; se estiver pausada,
                                    // encerra sem fade (evita "sumir em fade" ao trocar/retomar manualmente).
                                    let mut crossfade_from_previous = false;
                                    if let Some(mut old_track) = current_track.take() {
                                        crossfade_from_previous = old_track.is_playing;
                                        if crossfade_from_previous {
                                            let fade_out = old_track
                                                .item
                                                .manual_fade_out_ms
                                                .unwrap_or(MANUAL_CROSSFADE_OUT_MS);
                                            if fade_out > 0 {
                                                old_track.fade_out_start_pos =
                                                    Some(old_track.position.as_millis() as u64);
                                                old_track.fade_out_duration_ms = Some(fade_out);
                                            }
                                            background_tracks.push(old_track);
                                        } else {
                                            old_track.sink.stop();
                                        }
                                    }

                                    log_debug(&format!(
                                        "Manually playing index: {}. manual_crossfade: {}",
                                        idx, crossfade_from_previous
                                    ));

                                    let sink = Sink::try_new(&stream_handle).unwrap();
                                    sink.append(decoder);
                                    if crossfade_from_previous {
                                        sink.set_volume(0.0); // Começa mutado para o fade in
                                    } else {
                                        sink.set_volume(1.0);
                                    }
                                    sink.play();

                                    current_track = Some(ActiveTrack {
                                        sink,
                                        item,
                                        index: idx,
                                        last_update: Instant::now(),
                                        position: Duration::from_millis(0),
                                        is_playing: true,
                                        mix_triggered: false,
                                        fade_out_start_pos: None,
                                        fade_in_start_pos: if crossfade_from_previous {
                                            Some(0)
                                        } else {
                                            None
                                        },
                                        fade_in_duration_ms: if crossfade_from_previous {
                                            Some(MANUAL_CROSSFADE_IN_MS)
                                        } else {
                                            None
                                        },
                                        fade_out_duration_ms: None,
                                    });
                                }
                            }
                        }
                    }
                    AudioCommand::Pause => {
                        if let Some(track) = &mut current_track {
                            track.pause();
                        }
                        for bt in &mut background_tracks {
                            bt.pause();
                        }
                    }
                    AudioCommand::Resume => {
                        if let Some(track) = &mut current_track {
                            track.play();
                        }
                        for bt in &mut background_tracks {
                            bt.play();
                        }
                    }
                    AudioCommand::Seek(pos_ms) => {
                        if let Some(track) = &mut current_track {
                            track.seek(Duration::from_millis(pos_ms));
                        }
                    }
                    AudioCommand::SkipWithFade => {
                        skip_requested = true;
                    }
                }
            }

            let mut auto_play_next: Option<usize> = None;
            let mut auto_play_is_manual = false;

            if let Some(track) = &mut current_track {
                track.update_position();
                let pos_ms = track.position.as_millis() as u64;

                if skip_requested && !track.mix_triggered {
                    log_debug(&format!("Mix triggered by manual skip! pos_ms: {}", pos_ms));
                    track.mix_triggered = true;
                    auto_play_next = Some(track.index + 1);
                    auto_play_is_manual = true;
                }

                // Process Fade In
                if let Some(start_pos) = track.fade_in_start_pos {
                    let fade_dur = track
                        .fade_in_duration_ms
                        .or(track.item.fade_duration_ms)
                        .unwrap_or(2000);
                    let elapsed = pos_ms.saturating_sub(start_pos);
                    if fade_dur > 0 && elapsed < fade_dur {
                        let volume = elapsed as f32 / fade_dur as f32;
                        track.sink.set_volume(volume);
                    } else {
                        track.sink.set_volume(1.0);
                        track.fade_in_start_pos = None;
                    }
                }

                let dur_ms = track.item.duration_ms.unwrap_or(0);

                // Mix trigger logic
                if !track.mix_triggered {
                    if let Some(mix_end) = track.item.mix_end_ms {
                        // Dispara 1 segundo antes do mix_end para compensar a latência do buffer
                        // de áudio, garantindo que o countdown mostre o valor correto (ex.: "3"
                        // para um mix de 2 s, em vez de "2").
                        let trigger_at = mix_end.saturating_sub(1000);
                        if mix_end > 0 && pos_ms >= trigger_at {
                            log_debug(&format!(
                                "Mix triggered by mix_end! pos_ms: {}, mix_end: {}, trigger_at: {}",
                                pos_ms, mix_end, trigger_at
                            ));
                            track.mix_triggered = true;
                            auto_play_next = Some(track.index + 1);
                        }
                    } else if dur_ms > 0 && pos_ms >= dur_ms {
                        // Natural end fallback if duration reached
                        log_debug(&format!(
                            "Mix triggered by dur_ms! pos_ms: {}, dur_ms: {}",
                            pos_ms, dur_ms
                        ));
                        track.mix_triggered = true;
                        auto_play_next = Some(track.index + 1);
                    }
                }

                // If it finished naturally
                if track.sink.empty() && !track.mix_triggered {
                    log_debug(&format!(
                        "Mix triggered by natural empty sink! pos_ms: {}",
                        pos_ms
                    ));
                    track.mix_triggered = true;
                    auto_play_next = Some(track.index + 1);
                }

                // Update shared state
                if let Ok(mut st) = state_clone.lock() {
                    st.current_index = Some(track.index);
                    st.current_id = Some(track.item.id.clone());
                    st.is_playing = track.is_playing;
                    st.position_ms = pos_ms;
                    st.duration_ms = dur_ms;
                }
            } else {
                if let Ok(mut st) = state_clone.lock() {
                    st.is_playing = false;
                }
            }

            // Auto-advance
            if let Some(next_idx) = auto_play_next {
                if next_idx < queue.len() {
                    let item = queue[next_idx].clone();
                    if let Ok(file) = File::open(&item.path) {
                        if let Ok(decoder) = Decoder::new(BufReader::new(file)) {
                            log_debug(&format!("Auto-playing next index: {}", next_idx));
                            if let Some(mut old_track) = current_track.take() {
                                if auto_play_is_manual {
                                    // Skip manual (espaço ou clique): usa o fadeout específico
                                    // do tipo de mídia (música=3 s, mídia=1,5 s, VEM=0).
                                    let fade_out = old_track
                                        .item
                                        .manual_fade_out_ms
                                        .unwrap_or(MANUAL_CROSSFADE_OUT_MS);
                                    if fade_out > 0 {
                                        old_track.fade_out_start_pos =
                                            Some(old_track.position.as_millis() as u64);
                                        old_track.fade_out_duration_ms = Some(fade_out);
                                    }
                                } else {
                                    // Mix natural: respeita fade_out_time_ms do arquivo.
                                    // 0 ou None = sem ramp, toca até o fim.
                                    let fade_out = old_track.item.fade_out_time_ms.unwrap_or(0);
                                    if fade_out > 0 {
                                        old_track.fade_out_start_pos =
                                            Some(old_track.position.as_millis() as u64);
                                    }
                                }
                                background_tracks.push(old_track);
                            }
                            let sink = Sink::try_new(&stream_handle).unwrap();
                            sink.append(decoder);
                            sink.set_volume(0.0); // Start silent for fade in
                            sink.play();

                            current_track = Some(ActiveTrack {
                                sink,
                                item,
                                index: next_idx,
                                last_update: Instant::now(),
                                position: Duration::from_millis(0),
                                is_playing: true,
                                mix_triggered: false,
                                fade_out_start_pos: None,
                                fade_in_start_pos: Some(0), // Trigger fade in
                                fade_in_duration_ms: None,
                                fade_out_duration_ms: None,
                            });
                        }
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

            // Cleanup overlap tracks
            for bt in &mut background_tracks {
                bt.update_position();
                let pos_ms = bt.position.as_millis() as u64;

                // Process Fade Out
                if let Some(start_pos) = bt.fade_out_start_pos {
                    // Prioridade: override manual (crossfade por skip/play) → fade_out_time_ms do item.
                    // fade_duration_ms é reservado para o crossfade do mix (fade-in da nova faixa);
                    // não é usado aqui para não misturar os dois conceitos.
                    let fade_dur = bt
                        .fade_out_duration_ms
                        .or(bt.item.fade_out_time_ms)
                        .unwrap_or(0);
                    if fade_dur == 0 {
                        // Sem ramp: toca até o fim naturalmente (sink.empty() removerá a faixa).
                    } else {
                        let elapsed = pos_ms.saturating_sub(start_pos);
                        if elapsed < fade_dur {
                            let volume = 1.0 - (elapsed as f32 / fade_dur as f32);
                            bt.sink.set_volume(volume);
                        } else {
                            bt.sink.set_volume(0.0);
                            bt.sink.stop();
                        }
                    }
                }
            }
            background_tracks.retain(|bt| {
                let is_empty = bt.sink.empty();
                if is_empty {
                    log_debug(&format!(
                        "Background track index {} dropped because sink is empty. pos_ms: {}",
                        bt.index,
                        bt.position.as_millis()
                    ));
                }
                !is_empty
            });

            // Update background IDs in state
            if let Ok(mut st) = state_clone.lock() {
                st.background_ids = background_tracks
                    .iter()
                    .map(|bt| bt.item.id.clone())
                    .collect();
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

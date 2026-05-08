use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::traits::Split;
use ringbuf::HeapRb;
use std::f32::consts::FRAC_PI_2;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::core::decoder::{DecoderCmd, TrackDecoder};
use crate::core::mixer::{load_volume, store_volume, AudioTrack, DigitalMixer};
use crate::models::audio::{AudioCommand, AudioItem, PlaybackState};
use crate::models::mixer::CHANNEL_PLAYLIST;

/// Segundos de pre-buffer no ring buffer (decoder → mixer).
const PREBUFFER_SECONDS: usize = 1;

// ---------------------------------------------------------------------------
// Estrutura interna de faixa (visível apenas pela engine thread)
// ---------------------------------------------------------------------------

struct TrackEntry {
    id: String,
    /// Índice desta faixa na `queue` atual.
    index: usize,
    decoder: TrackDecoder,
    position_samples: Arc<AtomicU64>,
    finished: Arc<AtomicBool>,
    active: Arc<AtomicBool>,
    /// Volume da faixa (f32 bits em AtomicU32). Compartilhado com `AudioTrack` no mixer.
    volume: Arc<AtomicU32>,
    duration_ms: u64,
    /// Posição nesta faixa onde o mix deve acontecer (fim do crossfade).
    mix_end_ms: Option<u64>,
    /// Duração do crossfade em ms. 0 = sem crossfade.
    fade_duration_ms: u64,
    /// Duração do fade-out ao pular manualmente. Default: 1500 ms.
    manual_fade_out_ms: u64,
    /// Sinaliza ao mixer para descartar amostras antigas no próximo callback.
    seek_flush_pending: Arc<AtomicBool>,
}

// ---------------------------------------------------------------------------
// Engine pública
// ---------------------------------------------------------------------------

pub fn start_audio_engine(
    mixer: Arc<Mutex<DigitalMixer>>,
) -> (mpsc::Sender<AudioCommand>, Arc<Mutex<PlaybackState>>) {
    let (tx, rx) = mpsc::channel::<AudioCommand>();
    let playback = Arc::new(Mutex::new(PlaybackState::default()));

    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .expect("Nenhuma placa de som encontrada");
    let config = device
        .default_output_config()
        .expect("Sem configuração default para o device de saída");

    let target_sample_rate = config.sample_rate().0;
    let target_channels: u16 = config.channels();

    if let Ok(mut m) = mixer.lock() {
        m.set_output_format(target_sample_rate, target_channels);
    }

    let mixer_for_callback = mixer.clone();
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device
            .build_output_stream(
                &config.into(),
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    if let Ok(mut m) = mixer_for_callback.try_lock() {
                        m.process_audio_block(data);
                    } else {
                        data.fill(0.0);
                    }
                },
                |err| eprintln!("Erro na thread de áudio: {}", err),
                None,
            )
            .expect("Falha ao criar stream cpal"),
        fmt => panic!("Formato de áudio não suportado: {:?}", fmt),
    };
    stream.play().expect("Falha ao iniciar stream cpal");
    std::mem::forget(stream);

    let mixer_for_thread = mixer.clone();
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

    (tx, playback)
}

// ---------------------------------------------------------------------------
// Loop principal da engine
// ---------------------------------------------------------------------------

fn engine_loop(
    rx: mpsc::Receiver<AudioCommand>,
    mixer: Arc<Mutex<DigitalMixer>>,
    playback: Arc<Mutex<PlaybackState>>,
    sr: u32,
    ch: u16,
) {
    let mut queue: Vec<AudioItem> = Vec::new();
    // Faixa em reprodução (ou fazendo fade-out durante crossfade).
    let mut current: Option<TrackEntry> = None;
    // Faixa entrando (fade-in durante crossfade). Torna-se `current` ao final.
    let mut incoming: Option<TrackEntry> = None;
    // Parâmetros do crossfade ativo (0 = nenhum).
    let mut xfade_total_ms: u64 = 0;
    // Posição de `current` no momento em que o crossfade começou.
    let mut xfade_started_pos_ms: u64 = 0;

    loop {
        match rx.recv_timeout(Duration::from_millis(33)) {
            Ok(cmd) => handle_command(
                cmd,
                &mut queue,
                &mut current,
                &mut incoming,
                &mut xfade_total_ms,
                &mut xfade_started_pos_ms,
                &mixer,
                &playback,
                sr,
                ch,
            ),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        process_transitions(
            &queue,
            &mut current,
            &mut incoming,
            &mut xfade_total_ms,
            &mut xfade_started_pos_ms,
            &mixer,
            &playback,
            sr,
            ch,
        );
    }
}

// ---------------------------------------------------------------------------
// Comandos do usuário
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn handle_command(
    cmd: AudioCommand,
    queue: &mut Vec<AudioItem>,
    current: &mut Option<TrackEntry>,
    incoming: &mut Option<TrackEntry>,
    xfade_total_ms: &mut u64,
    xfade_started_pos_ms: &mut u64,
    mixer: &Arc<Mutex<DigitalMixer>>,
    playback: &Arc<Mutex<PlaybackState>>,
    sr: u32,
    ch: u16,
) {
    match cmd {
        AudioCommand::SetQueue(items) => {
            *queue = items;
        }

        AudioCommand::PlayIndex(idx) => {
            let Some(item) = queue.get(idx).cloned() else {
                eprintln!(
                    "syncplay: PlayIndex({idx}) inválido (fila tem {} itens)",
                    queue.len()
                );
                return;
            };
            if !std::path::Path::new(&item.path).is_file() {
                eprintln!("syncplay: arquivo não encontrado: {}", item.path);
                return;
            }
            // Cancela qualquer crossfade em andamento.
            stop_entry(incoming.take(), mixer);
            *xfade_total_ms = 0;
            *xfade_started_pos_ms = 0;

            stop_entry(current.take(), mixer);

            if let Some(entry) = make_track_entry(&item, idx, 1.0, mixer, sr, ch) {
                update_playback_started(&entry, &item.id, playback);
                *current = Some(entry);
            }
        }

        AudioCommand::Pause => {
            if let Some(c) = current.as_ref() {
                c.active.store(false, Ordering::Release);
            }
            if let Some(inc) = incoming.as_ref() {
                inc.active.store(false, Ordering::Release);
            }
            if let Ok(mut s) = playback.lock() {
                s.is_playing = false;
            }
        }

        AudioCommand::Resume => {
            if let Some(c) = current.as_ref() {
                c.active.store(true, Ordering::Release);
            }
            if let Some(inc) = incoming.as_ref() {
                inc.active.store(true, Ordering::Release);
            }
            if let Ok(mut s) = playback.lock() {
                s.is_playing = true;
            }
        }

        AudioCommand::Seek(ms) => {
            // Cancela crossfade: seek implica retomada do fluxo normal.
            stop_entry(incoming.take(), mixer);
            *xfade_total_ms = 0;
            *xfade_started_pos_ms = 0;

            if let Some(c) = current.as_ref() {
                let _ = c.decoder.cmd_tx.send(DecoderCmd::Seek(ms));
                c.position_samples
                    .store(ms_to_samples(ms, sr, ch), Ordering::Release);
                c.seek_flush_pending.store(true, Ordering::Release);
                store_volume(&c.volume, 1.0);
            }
            if let Ok(mut s) = playback.lock() {
                s.position_ms = ms;
            }
        }

        AudioCommand::SkipWithFade => {
            let fade_ms = current
                .as_ref()
                .map(|c| c.manual_fade_out_ms)
                .unwrap_or(1500);
            let cur_pos = current
                .as_ref()
                .map(|c| track_pos_ms(c, sr, ch))
                .unwrap_or(0);
            let next_idx = current.as_ref().map(|c| c.index + 1);

            // Cancela crossfade anterior (se existia).
            stop_entry(incoming.take(), mixer);
            *xfade_total_ms = 0;

            if fade_ms == 0 {
                // Corte seco.
                stop_entry(current.take(), mixer);
                if let Some(ni) = next_idx.and_then(|i| queue.get(i)).cloned() {
                    let ni_idx = next_idx.unwrap();
                    if let Some(entry) = make_track_entry(&ni, ni_idx, 1.0, mixer, sr, ch) {
                        update_playback_started(&entry, &ni.id, playback);
                        *current = Some(entry);
                    }
                } else {
                    clear_playback(playback);
                }
            } else {
                // Fade-out da atual + fade-in da próxima.
                if let Some(ni) = next_idx.and_then(|i| queue.get(i)).cloned() {
                    let ni_idx = next_idx.unwrap();
                    if let Some(entry) = make_track_entry(&ni, ni_idx, 0.0, mixer, sr, ch) {
                        // Atualiza PlaybackState para mostrar a faixa chegando imediatamente.
                        update_playback_started(&entry, &ni.id, playback);
                        *incoming = Some(entry);
                    }
                }
                // Inicia crossfade (mesmo que incoming seja None = só fade-out).
                *xfade_total_ms = fade_ms;
                *xfade_started_pos_ms = cur_pos;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tick de transições automáticas (crossfade + auto-advance)
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn process_transitions(
    queue: &[AudioItem],
    current: &mut Option<TrackEntry>,
    incoming: &mut Option<TrackEntry>,
    xfade_total_ms: &mut u64,
    xfade_started_pos_ms: &mut u64,
    mixer: &Arc<Mutex<DigitalMixer>>,
    playback: &Arc<Mutex<PlaybackState>>,
    sr: u32,
    ch: u16,
) {
    // === CROSSFADE EM ANDAMENTO ===
    if *xfade_total_ms > 0 {
        let cur_pos = current.as_ref().map(|c| track_pos_ms(c, sr, ch)).unwrap_or(0);
        let elapsed = cur_pos.saturating_sub(*xfade_started_pos_ms);
        let progress = if *xfade_total_ms > 0 {
            (elapsed as f32 / *xfade_total_ms as f32).clamp(0.0, 1.0)
        } else {
            1.0
        };

        // Envelope cossenoidal igual-potência:
        //   vol_out = cos(progress × π/2)²   → começa em 1, termina em 0
        //   vol_in  = sin(progress × π/2)²   → começa em 0, termina em 1
        let angle = progress * FRAC_PI_2;
        let vol_out = angle.cos().powi(2);
        let vol_in = angle.sin().powi(2);

        if let Some(c) = current.as_ref() {
            store_volume(&c.volume, vol_out);
        }
        if let Some(inc) = incoming.as_ref() {
            store_volume(&inc.volume, vol_in);
        }

        // Crossfade concluído?
        if progress >= 1.0 {
            stop_entry(current.take(), mixer);
            *current = incoming.take();
            if let Some(c) = current.as_ref() {
                store_volume(&c.volume, 1.0);
            }
            *xfade_total_ms = 0;
            *xfade_started_pos_ms = 0;
            // PlaybackState já foi atualizado para a faixa que entrou;
            // só corrige position_ms = 0 e is_playing.
            if let Ok(mut s) = playback.lock() {
                s.position_ms = 0;
                s.is_playing = current
                    .as_ref()
                    .map(|c| c.active.load(Ordering::Relaxed))
                    .unwrap_or(false);
            }
        } else {
            // Atualiza posição no PlaybackState com a faixa que já está "em cena" (incoming).
            if let Ok(mut s) = playback.lock() {
                s.position_ms = incoming
                    .as_ref()
                    .map(|i| track_pos_ms(i, sr, ch))
                    .unwrap_or(0);
            }
        }
        return;
    }

    // === SEM CROSSFADE ===

    // Lê valores do current sem segurá-lo como referência além desta seção.
    let Some((cur_pos, cur_idx, cur_mix_end, cur_fade_dur, cur_finished, cur_active)) = current
        .as_ref()
        .map(|c| {
            (
                track_pos_ms(c, sr, ch),
                c.index,
                c.mix_end_ms,
                c.fade_duration_ms,
                c.finished.load(Ordering::Acquire),
                c.active.load(Ordering::Relaxed),
            )
        })
    else {
        return;
    };

    // Verifica se entramos na zona de crossfade automático.
    if let Some(mix_end) = cur_mix_end {
        if cur_fade_dur > 0 {
            let zone_start = mix_end.saturating_sub(cur_fade_dur);
            // Só dispara uma vez (incoming ainda não existe).
            if cur_pos >= zone_start && incoming.is_none() {
                let next_idx = cur_idx + 1;
                if let Some(next_item) = queue.get(next_idx).cloned() {
                    if let Some(entry) =
                        make_track_entry(&next_item, next_idx, 0.0, mixer, sr, ch)
                    {
                        update_playback_started(&entry, &next_item.id, playback);
                        *incoming = Some(entry);
                        *xfade_total_ms = cur_fade_dur;
                        *xfade_started_pos_ms = cur_pos;
                        // Próximo tick já entra no ramo de crossfade.
                        return;
                    }
                }
                // Sem próxima faixa: só fade-out da atual até o mix_end.
                if cur_pos >= zone_start {
                    *xfade_total_ms = cur_fade_dur;
                    *xfade_started_pos_ms = cur_pos;
                    return;
                }
            }
        }
    }

    // Fim natural da faixa (sem crossfade).
    if cur_finished {
        let drained = mixer
            .try_lock()
            .map(|m| {
                !m.tracks
                    .iter()
                    .any(|t| t.id == current.as_ref().map(|c| c.id.as_str()).unwrap_or(""))
            })
            .unwrap_or(false);

        if drained {
            let next_idx = cur_idx + 1;
            // Remove o current (decoder já encerrou; ring buffer já está vazio).
            if let Some(old) = current.take() {
                if let Ok(mut m) = mixer.lock() {
                    m.tracks.retain(|t| t.id != old.id);
                }
                // old é dropado aqui; sem necesidade de Send para DecoderCmd::Stop.
            }

            if let Some(next_item) = queue.get(next_idx).cloned() {
                if let Some(entry) = make_track_entry(&next_item, next_idx, 1.0, mixer, sr, ch) {
                    update_playback_started(&entry, &next_item.id, playback);
                    *current = Some(entry);
                    return;
                }
            }
            // Fim da fila.
            clear_playback(playback);
            return;
        }
    }

    // Atualização periódica de posição.
    let Some(c) = current.as_ref() else {
        return;
    };
    let duration_ms = c.duration_ms;
    if let Ok(mut s) = playback.lock() {
        s.position_ms = if duration_ms > 0 {
            cur_pos.min(duration_ms)
        } else {
            cur_pos
        };
        s.is_playing = cur_active && !cur_finished;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Cria um `TrackEntry` e empurra a `AudioTrack` correspondente no mixer.
fn make_track_entry(
    item: &AudioItem,
    index: usize,
    initial_volume: f32,
    mixer: &Arc<Mutex<DigitalMixer>>,
    sr: u32,
    ch: u16,
) -> Option<TrackEntry> {
    if !std::path::Path::new(&item.path).is_file() {
        eprintln!("syncplay: arquivo não encontrado: {}", item.path);
        return None;
    }

    let rb_cap = (sr as usize) * (ch as usize) * PREBUFFER_SECONDS;
    let rb = HeapRb::<f32>::new(rb_cap);
    let (prod, cons) = rb.split();

    let (decoder, info) = match TrackDecoder::new(item.path.as_str(), prod, sr, ch) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("syncplay: decoder falhou para {}: {}", item.path, e);
            return None;
        }
    };

    let position_samples = Arc::new(AtomicU64::new(0));
    let active = Arc::new(AtomicBool::new(true));
    let seek_flush_pending = Arc::new(AtomicBool::new(false));
    let volume = Arc::new(AtomicU32::new(initial_volume.to_bits()));
    let finished = decoder.finished.clone();

    let track = AudioTrack {
        id: item.id.clone(),
        channel_id: CHANNEL_PLAYLIST.to_string(),
        consumer: cons,
        volume: volume.clone(),
        active: active.clone(),
        position_samples: position_samples.clone(),
        seek_flush_pending: seek_flush_pending.clone(),
        finished: finished.clone(),
    };

    if let Ok(mut m) = mixer.lock() {
        m.tracks.push(track);
    } else {
        eprintln!("syncplay: mixer envenenado, abortando make_track_entry");
        return None;
    }

    let duration_ms = if info.duration_ms > 0 {
        info.duration_ms
    } else {
        item.duration_ms.unwrap_or(0)
    };

    Some(TrackEntry {
        id: item.id.clone(),
        index,
        decoder,
        position_samples,
        finished,
        active,
        volume,
        duration_ms,
        mix_end_ms: item.mix_end_ms,
        fade_duration_ms: item.fade_duration_ms.unwrap_or(0),
        manual_fade_out_ms: item.manual_fade_out_ms.unwrap_or(1500),
        seek_flush_pending,
    })
}

/// Para um entry: sinaliza o decoder e remove a faixa do mixer.
fn stop_entry(entry: Option<TrackEntry>, mixer: &Arc<Mutex<DigitalMixer>>) {
    if let Some(e) = entry {
        let _ = e.decoder.cmd_tx.send(DecoderCmd::Stop);
        if let Ok(mut m) = mixer.lock() {
            m.tracks.retain(|t| t.id != e.id);
        }
    }
}

/// Atualiza o `PlaybackState` ao iniciar uma nova faixa (position = 0, is_playing = true).
fn update_playback_started(entry: &TrackEntry, id: &str, playback: &Arc<Mutex<PlaybackState>>) {
    if let Ok(mut s) = playback.lock() {
        s.current_id = Some(id.to_string());
        s.current_index = Some(entry.index);
        s.is_playing = true;
        s.position_ms = 0;
        s.duration_ms = entry.duration_ms;
    }
}

/// Limpa o `PlaybackState` (fim de fila, stop).
fn clear_playback(playback: &Arc<Mutex<PlaybackState>>) {
    if let Ok(mut s) = playback.lock() {
        s.current_id = None;
        s.current_index = None;
        s.is_playing = false;
        s.position_ms = 0;
        s.duration_ms = 0;
    }
}

/// Posição atual da faixa em milissegundos.
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
    if sample_rate == 0 || ch == 0 {
        return 0;
    }
    (samples / ch).saturating_mul(1000) / sample_rate as u64
}

/// Leitura não usada externamente — exposta para testes futuros.
#[allow(dead_code)]
fn _read_volume(entry: &TrackEntry) -> f32 {
    load_volume(&entry.volume)
}

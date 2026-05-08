use crate::error::{AppError, AppResult};
use ringbuf::traits::Producer;
use ringbuf::HeapProd;
use rubato::{FftFixedIn, Resampler};
use std::fs::File;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Tamanho de chunk de entrada do resampler (em frames por canal).
/// 1024 frames @ 48 kHz ≈ 21 ms — bom equilíbrio entre latência e overhead.
const CHUNK: usize = 1024;

pub enum DecoderCmd {
    /// Posição em milissegundos no áudio fonte.
    Seek(u64),
    Stop,
}

#[derive(Debug, Clone, Copy)]
pub struct DecoderInfo {
    pub duration_ms: u64,
    pub source_sample_rate: u32,
    pub source_channels: u16,
    pub target_sample_rate: u32,
    pub target_channels: u16,
}

pub struct TrackDecoder {
    pub cmd_tx: crossbeam_channel::Sender<DecoderCmd>,
    /// Sinalizado pelo decoder quando termina (EOF, Stop ou erro).
    pub finished: Arc<AtomicBool>,
}

impl TrackDecoder {
    /// Inicia uma thread que decodifica o arquivo, normaliza canais (mono/multi → `target_channels`),
    /// faz resampling para `target_sample_rate` quando necessário e empurra samples
    /// estéreo entrelaçados no `producer`. Retorna o handle e metadados básicos do arquivo.
    pub fn new<P: AsRef<Path>>(
        path: P,
        producer: HeapProd<f32>,
        target_sample_rate: u32,
        target_channels: u16,
    ) -> AppResult<(Self, DecoderInfo)> {
        let path_buf = path.as_ref().to_path_buf();

        let file = File::open(&path_buf)
            .map_err(|e| AppError::AudioDecode(format!("abrir {:?}: {}", path_buf, e)))?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = path_buf.extension().and_then(|s| s.to_str()) {
            hint.with_extension(ext);
        }

        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                mss,
                &FormatOptions::default(),
                &MetadataOptions::default(),
            )
            .map_err(|e| AppError::AudioDecode(format!("probe {:?}: {}", path_buf, e)))?;

        let format = probed.format;

        let (track_id, codec_params, source_sample_rate, source_channels, n_frames) = {
            let track = format
                .default_track()
                .ok_or_else(|| AppError::AudioDecode(format!("sem faixa em {:?}", path_buf)))?;
            let sr = track.codec_params.sample_rate.ok_or_else(|| {
                AppError::AudioDecode(format!("sample rate desconhecido em {:?}", path_buf))
            })?;
            let chs = track
                .codec_params
                .channels
                .map(|c| c.count() as u16)
                .unwrap_or(1)
                .max(1);
            let nf = track.codec_params.n_frames.unwrap_or(0);
            (track.id, track.codec_params.clone(), sr, chs, nf)
        };

        let duration_ms = if source_sample_rate > 0 {
            ((n_frames as f64) / (source_sample_rate as f64) * 1000.0) as u64
        } else {
            0
        };

        let info = DecoderInfo {
            duration_ms,
            source_sample_rate,
            source_channels,
            target_sample_rate,
            target_channels,
        };

        let finished = Arc::new(AtomicBool::new(false));
        let finished_for_thread = finished.clone();

        let (cmd_tx, cmd_rx) = crossbeam_channel::unbounded::<DecoderCmd>();

        thread::spawn(move || {
            decoder_loop(
                path_buf,
                format,
                track_id,
                codec_params,
                source_sample_rate,
                source_channels,
                target_sample_rate,
                target_channels,
                producer,
                cmd_rx,
                finished_for_thread.clone(),
            );
            finished_for_thread.store(true, Ordering::Release);
        });

        Ok((Self { cmd_tx, finished }, info))
    }
}

#[allow(clippy::too_many_arguments)]
fn decoder_loop(
    path_buf: std::path::PathBuf,
    mut format: Box<dyn symphonia::core::formats::FormatReader>,
    track_id: u32,
    codec_params: symphonia::core::codecs::CodecParameters,
    source_sample_rate: u32,
    source_channels: u16,
    target_sample_rate: u32,
    target_channels: u16,
    mut producer: HeapProd<f32>,
    cmd_rx: crossbeam_channel::Receiver<DecoderCmd>,
    _finished: Arc<AtomicBool>,
) {
    let mut decoder = match symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
    {
        Ok(d) => d,
        Err(e) => {
            eprintln!("TrackDecoder: codec não suportado para {:?}: {}", path_buf, e);
            return;
        }
    };

    let need_resample = source_sample_rate != target_sample_rate;
    let target_ch = target_channels as usize;
    let source_ch = source_channels as usize;

    let mut resampler: Option<FftFixedIn<f32>> = if need_resample {
        match FftFixedIn::<f32>::new(
            source_sample_rate as usize,
            target_sample_rate as usize,
            CHUNK,
            2,
            target_ch,
        ) {
            Ok(rs) => Some(rs),
            Err(e) => {
                eprintln!("TrackDecoder: falha ao criar resampler: {}", e);
                return;
            }
        }
    } else {
        None
    };

    // Buffers planares (1 vetor por canal target).
    let mut planar: Vec<Vec<f32>> = vec![Vec::with_capacity(CHUNK * 2); target_ch];

    // Buffer de saída do resampler (alocado uma vez para evitar realloc no real-time).
    let mut out_bufs: Vec<Vec<f32>> = match resampler.as_mut() {
        Some(rs) => rs.output_buffer_allocate(true),
        None => vec![Vec::with_capacity(CHUNK); target_ch],
    };

    let mut sample_buf: Option<SampleBuffer<f32>> = None;
    let mut interleaved: Vec<f32> = Vec::with_capacity(CHUNK * target_ch * 2);

    'outer: loop {
        // 1) Processa comandos pendentes (Seek/Stop) sem bloquear.
        while let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                DecoderCmd::Stop => break 'outer,
                DecoderCmd::Seek(ms) => {
                    let frac = ms as f64 / 1000.0;
                    let ts = (frac * source_sample_rate as f64) as u64;
                    let _ = format.seek(
                        SeekMode::Accurate,
                        SeekTo::TimeStamp { ts, track_id },
                    );
                    for b in planar.iter_mut() {
                        b.clear();
                    }
                    if let Some(rs) = resampler.as_mut() {
                        rs.reset();
                    }
                }
            }
        }

        // 2) Acumula CHUNK frames nos buffers planares (decodificando + de-interleave + normalização de canais).
        let mut eof = false;
        while planar[0].len() < CHUNK {
            let packet = match format.next_packet() {
                Ok(p) => p,
                Err(_) => {
                    eof = true;
                    break;
                }
            };
            if packet.track_id() != track_id {
                continue;
            }
            let audio_buf = match decoder.decode(&packet) {
                Ok(b) => b,
                Err(_) => {
                    eof = true;
                    break;
                }
            };
            if sample_buf.is_none() {
                sample_buf = Some(SampleBuffer::<f32>::new(
                    audio_buf.capacity() as u64,
                    *audio_buf.spec(),
                ));
            }
            let buf = sample_buf.as_mut().unwrap();
            buf.copy_interleaved_ref(audio_buf);
            let samples = buf.samples();

            for frame in samples.chunks_exact(source_ch) {
                if source_ch == 1 {
                    let v = frame[0];
                    for ch in 0..target_ch {
                        planar[ch].push(v);
                    }
                } else if source_ch >= target_ch {
                    for ch in 0..target_ch {
                        planar[ch].push(frame[ch]);
                    }
                } else {
                    // source_ch entre 2 e target_ch-1 (raro): copia o que tem e duplica último.
                    for ch in 0..source_ch {
                        planar[ch].push(frame[ch]);
                    }
                    let last = frame[source_ch - 1];
                    for ch in source_ch..target_ch {
                        planar[ch].push(last);
                    }
                }
            }
        }

        // Sem CHUNK frames suficientes e EOF: encerra.
        // (Os últimos < CHUNK frames são descartados — perda imperceptível em arquivos de música.)
        if planar[0].len() < CHUNK {
            if eof {
                break 'outer;
            }
            continue;
        }

        // 3) Resample (ou pass-through) para target_sample_rate.
        let frames_out: usize;
        if let Some(rs) = resampler.as_mut() {
            let inputs: Vec<&[f32]> = planar.iter().map(|v| &v[..CHUNK]).collect();
            match rs.process_into_buffer(&inputs, &mut out_bufs, None) {
                Ok((_in_used, out_written)) => {
                    frames_out = out_written;
                }
                Err(e) => {
                    eprintln!("TrackDecoder: erro no resample: {}", e);
                    break 'outer;
                }
            }
            for b in planar.iter_mut() {
                b.drain(..CHUNK);
            }

            interleaved.clear();
            interleaved.reserve(frames_out * target_ch);
            for i in 0..frames_out {
                for ch in 0..target_ch {
                    interleaved.push(out_bufs[ch][i]);
                }
            }
        } else {
            frames_out = CHUNK;
            interleaved.clear();
            interleaved.reserve(frames_out * target_ch);
            for i in 0..frames_out {
                for ch in 0..target_ch {
                    interleaved.push(planar[ch][i]);
                }
            }
            for b in planar.iter_mut() {
                b.drain(..CHUNK);
            }
        }

        // 4) Empurra para o ring buffer com backpressure, atendendo Stop/Seek se chegarem.
        let mut written = 0usize;
        while written < interleaved.len() {
            written += producer.push_slice(&interleaved[written..]);
            if written < interleaved.len() {
                match cmd_rx.recv_timeout(Duration::from_millis(5)) {
                    Ok(DecoderCmd::Stop) => break 'outer,
                    Ok(DecoderCmd::Seek(ms)) => {
                        let frac = ms as f64 / 1000.0;
                        let ts = (frac * source_sample_rate as f64) as u64;
                        let _ = format.seek(
                            SeekMode::Accurate,
                            SeekTo::TimeStamp { ts, track_id },
                        );
                        for b in planar.iter_mut() {
                            b.clear();
                        }
                        if let Some(rs) = resampler.as_mut() {
                            rs.reset();
                        }
                        // Descarta o restante do `interleaved` (resíduo pré-seek).
                        break;
                    }
                    Err(_) => {} // timeout: tenta empurrar de novo
                }
            }
        }
    }
}

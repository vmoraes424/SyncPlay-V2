use ringbuf::{HeapRb, Producer};
use std::fs::File;
use std::path::Path;
use std::thread;
use std::time::Duration;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub enum DecoderCmd {
    Seek(u64), // Posição em ms
    Stop,
}

pub struct TrackDecoder {
    pub cmd_tx: crossbeam_channel::Sender<DecoderCmd>,
    pub is_playing: bool,
}

impl TrackDecoder {
    pub fn new<P: AsRef<Path>>(
        path: P,
        mut producer: Producer<f32, std::sync::Arc<ringbuf::SharedRb<f32, Vec<std::mem::MaybeUninit<f32>>>>>,
    ) -> Self {
        let (cmd_tx, cmd_rx) = crossbeam_channel::unbounded::<DecoderCmd>();
        let path_buf = path.as_ref().to_path_buf();

        thread::spawn(move || {
            let file = File::open(&path_buf).unwrap();
            let mss = MediaSourceStream::new(Box::new(file), Default::default());
            let mut hint = Hint::new();
            if let Some(ext) = path_buf.extension().and_then(|s| s.to_str()) {
                hint.with_extension(ext);
            }

            let probed = symphonia::default::get_probe()
                .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
                .unwrap();

            let mut format = probed.format;
            let track = format.default_track().unwrap();
            let track_id = track.id;
            let mut decoder = symphonia::default::get_codecs()
                .make(&track.codec_params, &DecoderOptions::default())
                .unwrap();

            let mut sample_buf = None;

            loop {
                // Processa comandos (como Seek ou Stop)
                if let Ok(cmd) = cmd_rx.try_recv() {
                    match cmd {
                        DecoderCmd::Stop => break,
                        DecoderCmd::Seek(ms) => {
                            let frac = ms as f64 / 1000.0;
                            // Converte MS para o timestamp nativo do arquivo
                            let ts = (frac * track.codec_params.sample_rate.unwrap() as f64) as u64;
                            let _ = format.seek(
                                symphonia::core::formats::SeekMode::Accurate,
                                symphonia::core::formats::SeekTo::TimeStamp { ts, track_id },
                            );
                        }
                    }
                }

                // Pausa a leitura se o RingBuffer estiver cheio (evita estourar a RAM)
                if producer.is_full() {
                    thread::sleep(Duration::from_millis(10));
                    continue;
                }

                match format.next_packet() {
                    Ok(packet) => {
                        if packet.track_id() != track_id { continue; }
                        match decoder.decode(&packet) {
                            Ok(audio_buf) => {
                                if sample_buf.is_none() {
                                    sample_buf = Some(SampleBuffer::<f32>::new(
                                        audio_buf.capacity() as u64,
                                        *audio_buf.spec(),
                                    ));
                                }
                                if let Some(buf) = &mut sample_buf {
                                    buf.copy_interleaved_ref(audio_buf);
                                    let samples = buf.samples();
                                    
                                    // Empurra pro buffer até conseguir gravar tudo
                                    let mut written = 0;
                                    while written < samples.len() {
                                        written += producer.push_slice(&samples[written..]);
                                        if written < samples.len() {
                                            thread::sleep(Duration::from_millis(1)); // Aguarda o Cpal consumir
                                        }
                                    }
                                }
                            }
                            Err(_) => break, // Fim ou erro
                        }
                    }
                    Err(_) => break, // Fim do arquivo
                }
            }
        });

        Self { cmd_tx, is_playing: true }
    }
}
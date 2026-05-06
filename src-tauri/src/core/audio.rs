use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::HeapRb;
use std::sync::{Arc, Mutex};
use std::thread;

use crate::core::decoder::TrackDecoder;
use crate::core::mixer::{DigitalMixer, AudioTrack};
use crate::models::audio::{AudioCommand, PlaybackState};
use std::sync::mpsc;

pub fn start_audio_engine(
    mixer: Arc<Mutex<DigitalMixer>>,
) -> (mpsc::Sender<AudioCommand>, Arc<Mutex<PlaybackState>>) {
    let (tx, rx) = mpsc::channel::<AudioCommand>();
    let state = Arc::new(Mutex::new(PlaybackState::default()));

    // Inicializa Placa de Som (Cpal)
    let host = cpal::default_host();
    let device = host.default_output_device().expect("Nenhuma placa de som encontrada");
    let config = device.default_output_config().unwrap();

    let mixer_clone = mixer.clone();
    
    // Callback de Áudio Crítico (Tempo Real)
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_output_stream(
            &config.into(),
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                // A placa pede áudio, o mixer entrega processado!
                if let Ok(mut m) = mixer_clone.try_lock() {
                    m.process_audio_block(data);
                } else {
                    data.fill(0.0); // Prevenção de travamentos
                }
            },
            |err| eprintln!("Erro na thread de áudio: {}", err),
            None,
        ).unwrap(),
        _ => panic!("Formato de áudio não suportado"),
    };

    stream.play().unwrap();

    // Thread de Comandos (Gerencia Play/Pause e Fila)
    let state_clone = state.clone();
    thread::spawn(move || {
        let _stream_keepalive = stream; // Mantém o stream vivo
        let mut active_decoders: Vec<TrackDecoder> = Vec::new();

        loop {
            if let Ok(cmd) = rx.try_recv() {
                match cmd {
                    AudioCommand::PlayIndex(idx) => {
                        // Exemplo de como carregar uma música
                        // Na prática, você pega o path do seu 'queue'
                        let path = "C:/musica_exemplo.mp3"; 
                        
                        // Cria buffer de 5 segundos
                        let rb = HeapRb::<f32>::new(44100 * 2 * 5); 
                        let (prod, cons) = rb.split();

                        // Inicia o decodificador
                        let decoder = TrackDecoder::new(path, prod);
                        active_decoders.push(decoder);

                        // Adiciona ao Mixer para ser tocado
                        if let Ok(mut m) = mixer.lock() {
                            m.tracks.push(AudioTrack {
                                id: "track_1".into(),
                                consumer: cons,
                                volume: 1.0,
                                active: true,
                            });
                        }
                    }
                    // Implemente os repasses de Pause/Seek para os Decoders aqui
                    _ => {}
                }
            }
            thread::sleep(std::time::Duration::from_millis(50));
        }
    });

    (tx, state)
}
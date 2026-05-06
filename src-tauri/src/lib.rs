use tauri::Manager;
use std::time::Duration;
use std::thread;

// Certifique-se de importar seus comandos corretamente aqui no topo
// use crate::commands::{audio::*, mixer::*};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 1. Inicia o Estado Global com a nova arquitetura do DigitalMixer
    let app_state = crate::state::AppState::new();

    tauri::Builder::default()
        // Registra o estado para ser usado nos Comandos
        .manage(app_state)
        .setup(|app| {
            let app_handle = app.handle().clone();
            
            // Pega uma referência clonada do Mixer para a thread paralela
            let state = app_handle.state::<crate::state::AppState>();
            let mixer_clone = state.mixer.clone();

            // Thread Levíssima de Interface (UI) - 30 FPS
            thread::spawn(move || {
                loop {
                    if let Ok(mixer) = mixer_clone.try_lock() {
                        // Monta o payload EXATAMENTE no formato da interface MixerTickPayload do TypeScript
                        let payload = serde_json::json!({
                            "channels": mixer.routing.channels,
                            "routing": mixer.routing.routing,
                            "master": mixer.routing.master,
                            "monitor": mixer.routing.monitor,
                            "retorno": mixer.routing.retorno,
                            "levels": {
                                "playlist": mixer.playlist_vu,
                                "master": mixer.master_vu,
                                // Envia zerado para Monitor e Retorno por enquanto, para não quebrar a UI
                                "monitor": { "rms_left": 0.0, "rms_right": 0.0, "peak_left": 0.0, "peak_right": 0.0 },
                                "retorno": { "rms_left": 0.0, "rms_right": 0.0, "peak_left": 0.0, "peak_right": 0.0 }
                            }
                        });

                        // No Tauri v2, emit envia o evento para o frontend
                        let _ = app_handle.emit("mixer:tick", payload);
                    }
                    
                    // Dorme 33ms (~30 FPS), desafogando o React e a Placa de Vídeo
                    thread::sleep(Duration::from_millis(33));
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Settings
            commands::settings::read_playlist,
            commands::settings::read_config,
            commands::settings::write_config,
            commands::settings::read_app_settings,
            commands::settings::get_app_setting,
            commands::settings::write_app_settings,
            commands::settings::list_directories,
            // Audio playback
            commands::audio::set_queue,
            commands::audio::play_index,
            commands::audio::pause_audio,
            commands::audio::resume_audio,
            commands::audio::seek_audio,
            commands::audio::skip_with_fade,
            commands::audio::get_playback_state,
            // Schedule
            commands::schedule::get_schedule_selection,
            // Mix detection
            commands::mix::compute_mix_point_cmd,
            commands::mix::get_cached_mix_point_cmd,
            // Mixer
            commands::mixer::get_mixer_state,
            commands::mixer::set_channel_gain,
            commands::mixer::set_channel_muted,
            commands::mixer::toggle_master_route,
            commands::mixer::toggle_monitor_route,
            commands::mixer::toggle_retorno_route,
            commands::mixer::toggle_out_route,
            commands::mixer::set_out_device,
            commands::mixer::set_bus_gain,
            commands::mixer::set_bus_muted,
            commands::mixer::set_bus_device,
            commands::mixer::get_bus_config,
            commands::mixer::list_audio_devices_cmd,
            commands::mixer::reset_mixer_routing,
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao rodar a aplicação Tauri");
}
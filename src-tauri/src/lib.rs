// Declaração explícita dos módulos para o compilador do Rust.
// (Incluí core, models e error assumindo que você os criou na refatoração)
pub mod commands;
pub mod state;
pub mod core;
pub mod models;
pub mod error;

// Importamos Emitter junto com Manager para liberar o uso do método .emit()
use tauri::{Manager, Emitter, PhysicalPosition, PhysicalSize};
use std::time::Duration;
use std::thread;

const WINDOW_STATE_PATH: &str = "C:/SyncPlay/Configs/window_state.json";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 1. Inicia o Estado Global com a nova arquitetura do DigitalMixer
    let app_state = crate::state::AppState::new();

    tauri::Builder::default()
        // Registra o estado para ser usado nos Comandos
        .manage(app_state)
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Restaura posição/tamanho salvos e exibe a janela
            let window = app.get_webview_window("main").expect("Janela principal não encontrada");

            if let Ok(content) = std::fs::read_to_string(WINDOW_STATE_PATH) {
                if let Ok(state) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let (Some(x), Some(y)) = (state["x"].as_i64(), state["y"].as_i64()) {
                        let _ = window.set_position(PhysicalPosition::new(x as i32, y as i32));
                    }
                    if let (Some(w), Some(h)) = (state["width"].as_u64(), state["height"].as_u64()) {
                        let _ = window.set_size(PhysicalSize::new(w as u32, h as u32));
                    }
                    if state["maximized"].as_bool() == Some(true) {
                        let _ = window.maximize();
                    }
                }
            }

            let _ = window.show();

            // Salva posição/tamanho ao fechar a janela
            let window_for_event = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    if let (Ok(pos), Ok(size)) = (
                        window_for_event.outer_position(),
                        window_for_event.inner_size(),
                    ) {
                        let maximized = window_for_event.is_maximized().unwrap_or(false);
                        let json_state = serde_json::json!({
                            "x": pos.x,
                            "y": pos.y,
                            "width": size.width,
                            "height": size.height,
                            "maximized": maximized,
                        });
                        if let Ok(json) = serde_json::to_string_pretty(&json_state) {
                            let _ = std::fs::write(WINDOW_STATE_PATH, json);
                        }
                    }
                }
            });

            // Pega uma referência clonada do Mixer para a thread paralela
            let state = app_handle.state::<crate::state::AppState>();
            let mixer_clone = state.mixer.clone();

            // Thread Levíssima de Interface (UI) - 30 FPS
            thread::spawn(move || {
                let zero_vu = serde_json::json!({
                    "rms_left": 0.0,
                    "rms_right": 0.0,
                    "peak_left": 0.0,
                    "peak_right": 0.0
                });
                loop {
                    if let Ok(mixer) = mixer_clone.try_lock() {
                        // VU por canal vem do HashMap (preenchido durante process_audio_block).
                        let mut levels = serde_json::Map::new();
                        for (channel_id, vu) in mixer.vu.iter() {
                            if let Ok(v) = serde_json::to_value(vu) {
                                levels.insert(channel_id.clone(), v);
                            }
                        }
                        // Master vem do bus master_vu; monitor/retorno ainda não têm streams próprios.
                        if let Ok(v) = serde_json::to_value(&mixer.master_vu) {
                            levels.insert("master".to_string(), v);
                        }
                        levels
                            .entry("monitor".to_string())
                            .or_insert_with(|| zero_vu.clone());
                        levels
                            .entry("retorno".to_string())
                            .or_insert_with(|| zero_vu.clone());

                        let payload = serde_json::json!({
                            "channels": mixer.routing.channels,
                            "routing": mixer.routing.routing,
                            "master": mixer.routing.master,
                            "monitor": mixer.routing.monitor,
                            "retorno": mixer.routing.retorno,
                            "levels": levels,
                        });

                        let _ = app_handle.emit("mixer:tick", payload);
                    }

                    // Dorme 33ms (~30 FPS), desafogando o React e a placa de vídeo.
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
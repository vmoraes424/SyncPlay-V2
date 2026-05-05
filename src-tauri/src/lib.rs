mod commands;
mod core;
mod error;
mod models;
mod state;

use models::window::WindowStateFile;
use std::fs;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

const WINDOW_STATE_PATH: &str = "C:/SyncPlay/Configs/window-state.json";

fn apply_saved_window_state<R: Runtime>(win: &WebviewWindow<R>) {
    let Ok(content) = fs::read_to_string(WINDOW_STATE_PATH) else {
        return;
    };
    let Ok(state) = serde_json::from_str::<WindowStateFile>(&content) else {
        return;
    };

    if state.is_full_screen {
        let _ = win.set_fullscreen(true);
        return;
    }

    let _ = win.set_size(PhysicalSize::new(state.width, state.height));
    let _ = win.set_position(PhysicalPosition::new(state.x, state.y));
    if state.is_maximized {
        let _ = win.maximize();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState::new())
        .setup(|app| {
            if let Some(win) = app.get_webview_window("main") {
                apply_saved_window_state(&win);
                let _ = win.show();
            }

            // Task que emite níveis VU ao frontend a ~30 fps
            let app_handle = app.handle().clone();
            let app_state = app.state::<state::AppState>();
            let vu_snapshot = app_state.vu_snapshot.clone();
            let mixer_routing = app_state.mixer_routing.clone();

            tauri::async_runtime::spawn(async move {
                let mut interval =
                    tokio::time::interval(std::time::Duration::from_millis(33));
                loop {
                    interval.tick().await;

                    let levels = vu_snapshot.lock().unwrap().clone();
                    let routing = mixer_routing.lock().unwrap().clone();

                    let payload = models::mixer::MixerTickPayload {
                        levels,
                        channels: routing.channels,
                        routing: routing.routing,
                        master: routing.master,
                        monitor: routing.monitor,
                        retorno: routing.retorno,
                    };

                    let _ = app_handle.emit("mixer:tick", payload);
                }
            });

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
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
        .expect("error while running tauri application");
}

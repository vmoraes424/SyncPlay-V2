mod commands;
mod core;
mod error;
mod models;
mod state;

use models::window::WindowStateFile;
use std::fs;
use tauri::{Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

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
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::settings::read_playlist,
            commands::settings::read_config,
            commands::settings::write_config,
            commands::settings::read_app_settings,
            commands::settings::get_app_setting,
            commands::settings::write_app_settings,
            commands::audio::set_queue,
            commands::audio::play_index,
            commands::audio::pause_audio,
            commands::audio::resume_audio,
            commands::audio::seek_audio,
            commands::audio::skip_with_fade,
            commands::audio::get_playback_state,
            commands::schedule::get_schedule_selection,
            commands::settings::list_directories,
            commands::mix::compute_mix_point_cmd,
            commands::mix::get_cached_mix_point_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

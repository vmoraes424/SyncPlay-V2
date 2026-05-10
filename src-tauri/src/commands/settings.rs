use crate::core::files::{list_audio_files_in_directories, read_text_file_lossy};
use crate::core::paths::PLAYLISTS_DIR;
use crate::error::AppError;
use std::fs;
use std::io::ErrorKind;
use crate::core::playlist::enrich_playlist_json_with_block_duration_totals;
use crate::core::settings::{load_app_settings_from_disk, write_app_settings_to_disk};
use crate::error::AppResult;
use crate::models::fs::DirFileEntry;
use serde_json::Value;

#[tauri::command]
pub fn read_playlist(date: &str) -> AppResult<String> {
    let path = format!("{}/{}.json", PLAYLISTS_DIR, date);
    let bytes = fs::read(&path).map_err(|e| {
        if e.kind() == ErrorKind::NotFound {
            AppError::PlaylistNotFound {
                date: date.to_string(),
                dir: PLAYLISTS_DIR,
            }
        } else {
            AppError::Io(e.to_string())
        }
    })?;
    let text = if let Ok(utf8_str) = String::from_utf8(bytes.clone()) {
        utf8_str
    } else {
        bytes.into_iter().map(|b| b as char).collect()
    };
    let mut root: Value = serde_json::from_str(&text)?;
    enrich_playlist_json_with_block_duration_totals(&mut root);
    Ok(serde_json::to_string(&root)?)
}

#[tauri::command]
pub fn read_config(filename: &str) -> AppResult<String> {
    read_text_file_lossy(&format!("C:/SyncPlay/{}", filename))
}

#[tauri::command]
pub fn read_app_settings() -> AppResult<Value> {
    load_app_settings_from_disk()
}

/// Retorna o valor de uma chave de topo em `configs.json` (`null` se ausente).
#[tauri::command]
pub fn get_app_setting(key: String) -> AppResult<Value> {
    let root = load_app_settings_from_disk()?;
    Ok(root.get(&key).cloned().unwrap_or(Value::Null))
}

#[tauri::command]
pub fn write_app_settings(settings: Value) -> AppResult<()> {
    write_app_settings_to_disk(&settings)
}

#[tauri::command]
pub fn write_config(filename: &str, content: &str) -> AppResult<()> {
    let path = format!("C:/SyncPlay/{}", filename);
    if let Some(parent) = std::path::Path::new(&path).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, content)?;
    Ok(())
}

#[tauri::command]
pub fn list_directories(dir_paths: Vec<String>) -> AppResult<Vec<DirFileEntry>> {
    Ok(list_audio_files_in_directories(dir_paths))
}

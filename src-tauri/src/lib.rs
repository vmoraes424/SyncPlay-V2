mod audio;
use audio::{AudioCommand, AudioItem, PlaybackState};
use std::fs;
use std::sync::{mpsc, Arc, Mutex};
use tauri::State;
use serde::Serialize;

#[derive(Serialize, Clone)]
struct DirFileEntry {
    name: String,
    path: String,
    size_bytes: u64,
}

struct AudioState {
    tx: Mutex<mpsc::Sender<AudioCommand>>,
    playback: Arc<Mutex<PlaybackState>>,
}

#[tauri::command]
fn read_playlist(date: &str) -> Result<String, String> {
    let path = format!("C:/SyncPlay/Playlists/{}.json", date);
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    if let Ok(utf8_str) = String::from_utf8(bytes.clone()) {
        return Ok(utf8_str);
    }
    Ok(bytes.into_iter().map(|b| b as char).collect())
}

#[tauri::command]
fn read_config(filename: &str) -> Result<String, String> {
    let path = format!("C:/SyncPlay/{}", filename);
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    if let Ok(utf8_str) = String::from_utf8(bytes.clone()) {
        return Ok(utf8_str);
    }
    Ok(bytes.into_iter().map(|b| b as char).collect())
}

#[tauri::command]
fn set_queue(items: Vec<AudioItem>, state: State<'_, AudioState>) -> Result<(), String> {
    state.tx.lock().unwrap().send(AudioCommand::SetQueue(items)).map_err(|e| e.to_string())
}

#[tauri::command]
fn play_index(index: usize, state: State<'_, AudioState>) -> Result<(), String> {
    state.tx.lock().unwrap().send(AudioCommand::PlayIndex(index)).map_err(|e| e.to_string())
}

#[tauri::command]
fn pause_audio(state: State<'_, AudioState>) -> Result<(), String> {
    state.tx.lock().unwrap().send(AudioCommand::Pause).map_err(|e| e.to_string())
}

#[tauri::command]
fn resume_audio(state: State<'_, AudioState>) -> Result<(), String> {
    state.tx.lock().unwrap().send(AudioCommand::Resume).map_err(|e| e.to_string())
}

#[tauri::command]
fn seek_audio(position_ms: u64, state: State<'_, AudioState>) -> Result<(), String> {
    state.tx.lock().unwrap().send(AudioCommand::Seek(position_ms)).map_err(|e| e.to_string())
}

#[tauri::command]
fn skip_with_fade(state: State<'_, AudioState>) -> Result<(), String> {
    state.tx.lock().unwrap().send(AudioCommand::SkipWithFade).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_playback_state(state: State<'_, AudioState>) -> Result<PlaybackState, String> {
    Ok(state.playback.lock().unwrap().clone())
}

#[tauri::command]
fn list_directories(dir_paths: Vec<String>) -> Result<Vec<DirFileEntry>, String> {
    const AUDIO_EXTS: &[&str] = &["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus"];
    let mut files: Vec<DirFileEntry> = Vec::new();
    
    for dir_path in dir_paths {
        if let Ok(entries) = fs::read_dir(&dir_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() { continue; }
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if AUDIO_EXTS.contains(&ext.to_lowercase().as_str()) {
                        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                        let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
                        let full_path = path.to_string_lossy().to_string();
                        files.push(DirFileEntry { name, path: full_path, size_bytes });
                    }
                }
            }
        }
    }
    
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(files)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (tx, playback) = audio::start_audio_engine();
    
    tauri::Builder::default()
        .manage(AudioState {
            tx: Mutex::new(tx),
            playback,
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_playlist,
            read_config,
            set_queue,
            play_index,
            pause_audio,
            resume_audio,
            seek_audio,
            skip_with_fade,
            get_playback_state,
            list_directories
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

mod audio;
mod schedule;
use audio::{AudioCommand, AudioItem, PlaybackState};
use chrono::{Local, Timelike};
use schedule::{
    select_music_from_blocks, BlockScheduleSelection, ScheduleMediaStart, ScheduledBlock,
    ScheduledMedia, SecondsOfDay,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::sync::{mpsc, Arc, Mutex};
use tauri::{Manager, PhysicalPosition, PhysicalSize, Runtime, State, WebviewWindow};

const APP_SETTINGS_DIR: &str = "C:/SyncPlay/Configs";
const APP_SETTINGS_PATH: &str = "C:/SyncPlay/Configs/configs.json";
const WINDOW_STATE_PATH: &str = "C:/SyncPlay/Configs/window-state.json";

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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledMediaDto {
    id: String,
    title: String,
    media_type: String,
    path: String,
    raw_start_sec: Option<SecondsOfDay>,
    duration_sec: Option<f64>,
    mix_out_sec: Option<f64>,
    disabled: bool,
    discarded: bool,
    manual_discard: bool,
    fixed: bool,
    manual_type: bool,
    disable_discard: bool,
}

impl From<ScheduledMediaDto> for ScheduledMedia {
    fn from(item: ScheduledMediaDto) -> Self {
        Self {
            id: item.id,
            title: item.title,
            media_type: item.media_type,
            path: item.path,
            raw_start_sec: item.raw_start_sec,
            duration_sec: item.duration_sec,
            mix_out_sec: item.mix_out_sec,
            disabled: item.disabled,
            discarded: item.discarded,
            manual_discard: item.manual_discard,
            fixed: item.fixed,
            manual_type: item.manual_type,
            disable_discard: item.disable_discard,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledBlockDto {
    id: String,
    start_sec: SecondsOfDay,
    size_sec: f64,
    disable_discard: bool,
    medias: Vec<ScheduledMediaDto>,
}

impl From<ScheduledBlockDto> for ScheduledBlock {
    fn from(block: ScheduledBlockDto) -> Self {
        Self {
            id: block.id,
            start_sec: block.start_sec,
            size_sec: block.size_sec,
            disable_discard: block.disable_discard,
            medias: block.medias.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleMediaStartDto {
    id: String,
    raw_start_sec: Option<SecondsOfDay>,
    start_sec: SecondsOfDay,
    start_label: String,
    active: bool,
}

impl From<ScheduleMediaStart> for ScheduleMediaStartDto {
    fn from(item: ScheduleMediaStart) -> Self {
        Self {
            id: item.id,
            raw_start_sec: item.raw_start_sec,
            start_sec: item.start_sec,
            start_label: item.start_label,
            active: item.active,
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ScheduleSelectionDto {
    #[serde(rename_all = "camelCase")]
    Active {
        music_id: String,
        elapsed_sec: f64,
        active_queue_ids: Vec<String>,
        media_starts: Vec<ScheduleMediaStartDto>,
    },
    #[serde(rename_all = "camelCase")]
    Upcoming {
        music_id: String,
        starts_in_sec: f64,
        active_queue_ids: Vec<String>,
        media_starts: Vec<ScheduleMediaStartDto>,
    },
    #[serde(rename_all = "camelCase")]
    Empty {
        active_queue_ids: Vec<String>,
        media_starts: Vec<ScheduleMediaStartDto>,
    },
}

impl From<BlockScheduleSelection> for ScheduleSelectionDto {
    fn from(selection: BlockScheduleSelection) -> Self {
        match selection {
            BlockScheduleSelection::Active {
                music_id,
                elapsed_sec,
                active_queue_ids,
                media_starts,
            } => Self::Active {
                music_id,
                elapsed_sec,
                active_queue_ids,
                media_starts: media_starts.into_iter().map(Into::into).collect(),
            },
            BlockScheduleSelection::Upcoming {
                music_id,
                starts_in_sec,
                active_queue_ids,
                media_starts,
            } => Self::Upcoming {
                music_id,
                starts_in_sec,
                active_queue_ids,
                media_starts: media_starts.into_iter().map(Into::into).collect(),
            },
            BlockScheduleSelection::Empty {
                active_queue_ids,
                media_starts,
            } => Self::Empty {
                active_queue_ids,
                media_starts: media_starts.into_iter().map(Into::into).collect(),
            },
        }
    }
}

fn local_seconds_of_day() -> SecondsOfDay {
    let now = Local::now();
    now.num_seconds_from_midnight()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowStateFile {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    is_maximized: bool,
    is_full_screen: bool,
}

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

fn load_app_settings_from_disk() -> Result<Value, String> {
    let content = match fs::read_to_string(APP_SETTINGS_PATH) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(serde_json::json!({}));
        }
        Err(error) => return Err(error.to_string()),
    };

    if content.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }

    serde_json::from_str(&content).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_app_settings() -> Result<Value, String> {
    load_app_settings_from_disk()
}

/// Retorna o valor de uma chave de topo em `configs.json` (`null` se ausente).
#[tauri::command]
fn get_app_setting(key: String) -> Result<Value, String> {
    let root = load_app_settings_from_disk()?;
    Ok(root.get(&key).cloned().unwrap_or(Value::Null))
}

#[tauri::command]
fn write_app_settings(settings: Value) -> Result<(), String> {
    fs::create_dir_all(APP_SETTINGS_DIR).map_err(|error| error.to_string())?;
    let content = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(APP_SETTINGS_PATH, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_queue(items: Vec<AudioItem>, state: State<'_, AudioState>) -> Result<(), String> {
    state
        .tx
        .lock()
        .unwrap()
        .send(AudioCommand::SetQueue(items))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn play_index(index: usize, state: State<'_, AudioState>) -> Result<(), String> {
    state
        .tx
        .lock()
        .unwrap()
        .send(AudioCommand::PlayIndex(index))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pause_audio(state: State<'_, AudioState>) -> Result<(), String> {
    state
        .tx
        .lock()
        .unwrap()
        .send(AudioCommand::Pause)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn resume_audio(state: State<'_, AudioState>) -> Result<(), String> {
    state
        .tx
        .lock()
        .unwrap()
        .send(AudioCommand::Resume)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn seek_audio(position_ms: u64, state: State<'_, AudioState>) -> Result<(), String> {
    state
        .tx
        .lock()
        .unwrap()
        .send(AudioCommand::Seek(position_ms))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn skip_with_fade(state: State<'_, AudioState>) -> Result<(), String> {
    state
        .tx
        .lock()
        .unwrap()
        .send(AudioCommand::SkipWithFade)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_playback_state(state: State<'_, AudioState>) -> Result<PlaybackState, String> {
    Ok(state.playback.lock().unwrap().clone())
}

#[tauri::command]
fn get_schedule_selection(blocks: Vec<ScheduledBlockDto>) -> Result<ScheduleSelectionDto, String> {
    let scheduled_blocks: Vec<ScheduledBlock> = blocks.into_iter().map(Into::into).collect();
    let now_sec = local_seconds_of_day();
    let selection = select_music_from_blocks(&scheduled_blocks, now_sec, 120.0, "advanced");

    Ok(selection.into())
}

#[tauri::command]
fn list_directories(dir_paths: Vec<String>) -> Result<Vec<DirFileEntry>, String> {
    const AUDIO_EXTS: &[&str] = &["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus"];
    let mut files: Vec<DirFileEntry> = Vec::new();

    for dir_path in dir_paths {
        if let Ok(entries) = fs::read_dir(&dir_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if AUDIO_EXTS.contains(&ext.to_lowercase().as_str()) {
                        let name = path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();
                        let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
                        let full_path = path.to_string_lossy().to_string();
                        files.push(DirFileEntry {
                            name,
                            path: full_path,
                            size_bytes,
                        });
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
        .setup(|app| {
            if let Some(win) = app.get_webview_window("main") {
                apply_saved_window_state(&win);
                let _ = win.show();
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_playlist,
            read_config,
            read_app_settings,
            get_app_setting,
            write_app_settings,
            set_queue,
            play_index,
            pause_audio,
            resume_audio,
            seek_audio,
            skip_with_fade,
            get_playback_state,
            get_schedule_selection,
            list_directories
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

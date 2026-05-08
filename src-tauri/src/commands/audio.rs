use crate::error::AppResult;
use crate::models::audio::{AudioCommand, AudioItem, PlaybackState};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn set_queue(items: Vec<AudioItem>, state: State<'_, AppState>) -> AppResult<()> {
    state.send_audio_command(AudioCommand::SetQueue(items))
}

#[tauri::command]
pub fn play_index(index: usize, state: State<'_, AppState>) -> AppResult<()> {
    state.send_audio_command(AudioCommand::PlayIndex(index))
}

#[tauri::command]
pub fn pause_audio(state: State<'_, AppState>) -> AppResult<()> {
    state.send_audio_command(AudioCommand::Pause)
}

#[tauri::command]
pub fn resume_audio(state: State<'_, AppState>) -> AppResult<()> {
    state.send_audio_command(AudioCommand::Resume)
}

#[tauri::command]
pub fn seek_audio(position_ms: u64, state: State<'_, AppState>) -> AppResult<()> {
    state.send_audio_command(AudioCommand::Seek(position_ms))
}

#[tauri::command]
pub fn skip_with_fade(state: State<'_, AppState>) -> AppResult<()> {
    state.send_audio_command(AudioCommand::SkipWithFade)
}

#[tauri::command]
pub fn play_independent(item: AudioItem, state: State<'_, AppState>) -> AppResult<()> {
    state.send_audio_command(AudioCommand::PlayIndependent(item))
}

#[tauri::command]
pub fn stop_independent(id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.send_audio_command(AudioCommand::StopIndependent(id))
}

#[tauri::command]
pub fn seek_independent(id: String, position_ms: u64, state: State<'_, AppState>) -> AppResult<()> {
    state.send_audio_command(AudioCommand::SeekIndependent(id, position_ms))
}

#[tauri::command]
pub fn get_playback_state(state: State<'_, AppState>) -> AppResult<PlaybackState> {
    state.playback_state()
}

use crate::core::paths::PLAYLISTS_DIR;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

/// Debounce para esperar o arquivo `.json` ficar estável após escrita.
const DEBOUNCE: Duration = Duration::from_millis(450);

pub struct PlaylistWatchState {
    cancel: Mutex<Option<Arc<AtomicBool>>>,
}

impl PlaylistWatchState {
    pub fn new() -> Self {
        Self {
            cancel: Mutex::new(None),
        }
    }

    fn replace_session(&self, cancel: Arc<AtomicBool>) {
        let mut guard = self.cancel.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(prev) = guard.replace(cancel) {
            prev.store(true, Ordering::SeqCst);
        }
    }

    pub fn cancel_current(&self) {
        let mut guard = self.cancel.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(prev) = guard.take() {
            prev.store(true, Ordering::SeqCst);
        }
    }
}

fn spawn_watch_thread(app: AppHandle, date: String, cancel: Arc<AtomicBool>) {
    thread::spawn(move || {
        let playlists_dir = std::path::PathBuf::from(PLAYLISTS_DIR);
        let _ = std::fs::create_dir_all(&playlists_dir);

        let target_file = format!("{}.json", date);
        let (tx, rx) = std::sync::mpsc::channel();

        let mut watcher = match RecommendedWatcher::new(
            move |res| {
                let _ = tx.send(res);
            },
            Config::default(),
        ) {
            Ok(w) => w,
            Err(_) => return,
        };

        if watcher
            .watch(playlists_dir.as_path(), RecursiveMode::NonRecursive)
            .is_err()
        {
            return;
        }

        let mut debounce_deadline: Option<Instant> = None;

        loop {
            if cancel.load(Ordering::SeqCst) {
                break;
            }

            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(Ok(event)) => {
                    let matches = event.paths.iter().any(|p| {
                        p.file_name()
                            .and_then(|n| n.to_str())
                            .map(|name| name == target_file.as_str())
                            .unwrap_or(false)
                    });
                    if matches {
                        debounce_deadline = Some(Instant::now() + DEBOUNCE);
                    }
                }
                Ok(Err(_)) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if let Some(deadline) = debounce_deadline {
                        if Instant::now() >= deadline && !cancel.load(Ordering::SeqCst) {
                            let _ = app.emit("playlist-file-available", json!({ "date": date }));
                            break;
                        }
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        drop(watcher);
    });
}

/// Observa `Playlists/` até o arquivo `{date}.json` ser criado ou alterado (debounced), depois emite
/// `playlist-file-available` uma vez e encerra. Nova chamada cancela a sessão anterior.
#[tauri::command]
pub fn watch_playlist_file(
    date: String,
    app: AppHandle,
    watch_state: State<'_, PlaylistWatchState>,
) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    watch_state.replace_session(cancel.clone());
    spawn_watch_thread(app, date, cancel);
    Ok(())
}

#[tauri::command]
pub fn stop_playlist_watch(watch_state: State<'_, PlaylistWatchState>) -> Result<(), String> {
    watch_state.cancel_current();
    Ok(())
}

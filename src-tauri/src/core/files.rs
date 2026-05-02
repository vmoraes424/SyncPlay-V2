use crate::error::AppResult;
use crate::models::fs::DirFileEntry;
use std::fs;

pub fn read_text_file_lossy(path: &str) -> AppResult<String> {
    let bytes = fs::read(path)?;
    if let Ok(utf8_str) = String::from_utf8(bytes.clone()) {
        return Ok(utf8_str);
    }
    Ok(bytes.into_iter().map(|b| b as char).collect())
}

pub fn list_audio_files_in_directories(dir_paths: Vec<String>) -> Vec<DirFileEntry> {
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
    files
}

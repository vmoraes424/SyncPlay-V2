use crate::error::AppResult;
use crate::models::fs::DirFileEntry;
use std::fs;
use std::fs::File;
use std::path::Path;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Duração em segundos a partir dos metadados da faixa (Symphonia).
fn probe_audio_duration_sec(path: &Path) -> Option<f64> {
    let file = File::open(path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .ok()?;
    let format = probed.format;
    let track = format.default_track()?;
    let codec = &track.codec_params;
    let sample_rate = codec.sample_rate? as f64;
    let n_frames = codec.n_frames?;
    if sample_rate <= 0.0 || n_frames == 0 {
        return None;
    }
    Some(n_frames as f64 / sample_rate)
}

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
                        let duration_sec = probe_audio_duration_sec(&path);
                        files.push(DirFileEntry {
                            name,
                            path: full_path,
                            size_bytes,
                            duration_sec,
                        });
                    }
                }
            }
        }
    }

    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files
}

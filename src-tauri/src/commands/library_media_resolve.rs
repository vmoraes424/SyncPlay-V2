//! Resolve caminho de arquivo de mídia local a partir de `media_library.json`
//! (`C:/SyncPlay/Library`), usado quando um prompt só informa `track_media_id`.

use serde_json::Value;
use std::path::Path;

const MEDIA_LIBRARY_JSON: &str = "C:/SyncPlay/Library/media_library.json";

fn stringify_val(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(if *b { "true" } else { "false" }.to_string()),
        _ => None,
    }
}

fn row_path_candidates(row: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let Some(obj) = row.as_object() else {
        return out;
    };
    let keys = [
        "audio",
        "path",
        "file_path",
        "filePath",
        "arquivo",
        "nome_arquivo",
    ];
    for k in keys {
        if let Some(s) = obj.get(k).and_then(|v| stringify_val(v).filter(|p| !p.is_empty())) {
            out.push(s);
        }
    }
    out
}

fn ids_match(media_id_trim: &str, row: &Value) -> bool {
    if media_id_trim.is_empty() {
        return false;
    }
    let Some(obj) = row.as_object() else {
        return false;
    };
    obj.get("id")
        .and_then(stringify_val)
        .filter(|id| id == media_id_trim)
        .is_some()
}

/// Retorna primeiro caminho de arquivo encontrado na linha da biblioteca, se existir.
#[tauri::command]
pub fn resolve_media_track_path(media_id: String) -> Result<Option<String>, String> {
    let mid = media_id.trim();
    if mid.is_empty() {
        return Ok(None);
    }

    let path = Path::new(MEDIA_LIBRARY_JSON);
    if !path.exists() {
        return Ok(None);
    }

    let txt = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let root: Value = serde_json::from_str(&txt).map_err(|e| e.to_string())?;

    let map = root
        .as_object()
        .ok_or_else(|| "media_library.json: raíz não é objeto".to_string())?;

    let key_alt = format!("__id_{mid}");

    let try_lookup = |k: &str| -> Option<String> {
        map.get(k).and_then(|row| row_path_candidates(row).into_iter().next())
    };

    if let Some(p) = try_lookup(&key_alt).or_else(|| try_lookup(mid)) {
        return Ok(Some(p));
    }

    for row in map.values() {
        if ids_match(mid, row) {
            if let Some(p) = row_path_candidates(row).into_iter().next() {
                return Ok(Some(p));
            }
        }
    }

    Ok(None)
}

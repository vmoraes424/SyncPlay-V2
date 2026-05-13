//! Lê `%LOCALAPPDATA%\SuperAudio\configAPI` (JSON Superaudio Controla — campo `sn` para `X-SyncPlay-SN`).
//! Fallback: `%USERPROFILE%\AppData\Local\SuperAudio\configAPI` e arquivo com sufixo `.json`.

use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

fn default_api_config_map() -> Map<String, Value> {
    let mut m = Map::new();
    for (k, v) in [
        ("authCode", ""),
        ("nickname", ""),
        ("ClientID", ""),
        ("company", ""),
        ("sn", ""),
        ("syncType", ""),
        ("version", ""),
        ("refreshToken", ""),
        ("token", ""),
    ] {
        m.insert(k.to_string(), Value::String(v.to_string()));
    }
    m.insert("type".to_string(), Value::Null);
    m
}

fn merge_with_defaults(parsed: Value) -> Value {
    match parsed {
        Value::Object(p) => {
            let mut out = default_api_config_map();
            for (k, v) in p {
                out.insert(k, v);
            }
            Value::Object(out)
        }
        _ => Value::Object(default_api_config_map()),
    }
}

fn primary_config_path() -> PathBuf {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(local.trim())
            .join("SuperAudio")
            .join("configAPI");
    }
    PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default().trim())
        .join("AppData")
        .join("Local")
        .join("SuperAudio")
        .join("configAPI")
}

fn read_json_file(path: &Path) -> std::io::Result<String> {
    fs::read_to_string(path)
}

/// Lê o JSON de configuração da API Superaudio mesclando com defaults estáveis (`sn`, tokens, etc.).
/// Se nenhum arquivo existir ou o JSON for inválido, devolve só os defaults — sem erro fatal.
#[tauri::command]
pub fn read_superaudio_api_config() -> Value {
    let primary = primary_config_path();
    let alternatives = [
        primary.clone(),
        primary.with_extension("json"),
    ];

    let mut raw: Option<String> = None;
    for p in &alternatives {
        if let Ok(txt) = read_json_file(p) {
            let t = txt.trim();
            if !t.is_empty() {
                raw = Some(t.to_string());
                break;
            }
        }
    }

    match raw {
        Some(txt) => match serde_json::from_str::<Value>(&txt) {
            Ok(parsed) => merge_with_defaults(parsed),
            Err(_) => Value::Object(default_api_config_map()),
        },
        None => Value::Object(default_api_config_map()),
    }
}

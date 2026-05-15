//! Capa de catálogo via API SyncPlay (equiv. `getMusicCover` / `updateCoverArtAsync` no Electron).

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde_json::Value;
use std::time::Duration;

const COVER_BASE: &str = "https://api.superaudio.com.br/api/syncplay/music-cover";

fn normalize_bucket(raw: &str) -> Result<&'static str, String> {
    match raw.trim() {
        "Covers" => Ok("Covers"),
        "MediaCovers" => Ok("MediaCovers"),
        other => Err(format!(
            "cover_bucket inválido: {other} (use Covers ou MediaCovers)."
        )),
    }
}

fn extract_cover_url(body: &Value) -> Option<String> {
    let d = body.get("data")?;
    match d {
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        Value::Object(o) => o
            .get("url")
            .or_else(|| o.get("cover"))
            .or_else(|| o.get("src"))
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        _ => None,
    }
}

/// GET `music-cover/{media_id}?type=Covers|MediaCovers`. Devolve URL em `json.data` ou `None`.
#[tauri::command]
pub async fn fetch_syncplay_music_cover(
    media_id: u64,
    cover_bucket: String,
    sync_play_sn: String,
    bearer_token: Option<String>,
) -> Result<Option<String>, String> {
    if media_id == 0 {
        return Ok(None);
    }
    let bucket = normalize_bucket(&cover_bucket)?;
    let sn = sync_play_sn.trim();
    if sn.is_empty() {
        return Err("sync_play_sn ausente.".into());
    }

    let url = format!("{COVER_BASE}/{media_id}?type={}", urlencoding::encode(bucket));

    let client = reqwest::Client::builder()
        .user_agent("syncplay-v2/0.1 (Tauri)")
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())?;

    let sn_header = HeaderValue::from_str(sn).map_err(|_| {
        "sync_play_sn contém caracteres inválidos para header HTTP.".to_string()
    })?;

    let mut headers = HeaderMap::new();
    headers.insert("X-SyncPlay-SN", sn_header);

    if let Some(tok) = bearer_token {
        let t = tok.trim();
        if !t.is_empty() {
            let val = format!("Bearer {}", t.trim_start_matches("Bearer ").trim());
            let hv = HeaderValue::from_str(&val)
                .map_err(|_| "bearer_token inválido para header Authorization.".to_string())?;
            headers.insert(AUTHORIZATION, hv);
        }
    }

    let resp = client
        .get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let json: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(extract_cover_url(&json))
}

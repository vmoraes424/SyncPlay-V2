//! Proxy HTTP para `https://api.superaudio.com.br/controla/prompts/*`.
//! Chamadas vindas do WebView (`localhost` em dev ou `asset` em produção) falham por CORS;
//! o backend nativo não tem essa restrição.

use reqwest::header::{HeaderMap, HeaderValue};
use serde::Serialize;
use std::time::Duration;

const PROMPTS_BASE: &str = "https://api.superaudio.com.br/controla/prompts";

#[derive(Serialize)]
pub struct SuperaudioPromptsHttpResponse {
    pub status: u16,
    pub body: String,
}

fn sanitize_path(path: &str) -> Result<String, String> {
    let p = path.trim().trim_start_matches('/');
    if p.is_empty() {
        return Err("path ausente.".into());
    }
    if p.contains("..") || p.contains('\\') {
        return Err("path inválido.".into());
    }
    let ok = p
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if !ok {
        return Err("path com caracteres inválidos.".into());
    }
    Ok(p.to_string())
}

/// `path`: segmento relativo (`api-get`, `get-voices`, `get-token`, `clone`, `add`, …).
#[tauri::command]
pub async fn superaudio_prompts_proxy(
    method: String,
    path: String,
    sync_play_sn: String,
    body: Option<String>,
) -> Result<SuperaudioPromptsHttpResponse, String> {
    let path = sanitize_path(&path)?;
    let sn = sync_play_sn.trim();
    if sn.is_empty() {
        return Err("X-SyncPlay-SN ausente.".into());
    }

    let method_uc = method.trim().to_uppercase();
    if !matches!(method_uc.as_str(), "GET" | "POST") {
        return Err(format!("método HTTP não suportado: {method}"));
    }

    let url = format!("{}/{}", PROMPTS_BASE, path);

    let client = reqwest::Client::builder()
        .user_agent("syncplay-v2/0.1 (Tauri)")
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;

    let sn_header = HeaderValue::from_str(sn)
        .map_err(|_| "serial (X-SyncPlay-SN) contém caracteres inválidos para header HTTP.".to_string())?;

    let mut headers = HeaderMap::new();
    headers.insert("X-SyncPlay-SN", sn_header);

    let req = match method_uc.as_str() {
        "GET" => client.get(&url).headers(headers),
        "POST" => {
            let mut r = client.post(&url).headers(headers);
            if let Some(ref json_body) = body {
                if !json_body.is_empty() {
                    r = r
                        .header("Content-Type", "application/json")
                        .body(json_body.clone());
                }
            }
            r
        }
        _ => unreachable!(),
    };

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();

    Ok(SuperaudioPromptsHttpResponse {
        status,
        body: text,
    })
}

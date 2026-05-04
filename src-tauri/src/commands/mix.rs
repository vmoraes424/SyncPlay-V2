use crate::core::mix_detection::{compute_mix_point, MixPointResult};
use crate::error::AppResult;

/// Calcula (ou recupera do cache) o ponto de mix automático de um arquivo de áudio.
///
/// - `path`          : caminho absoluto do arquivo de áudio.
/// - `media_id`      : ID numérico da mídia na biblioteca (usado como chave no cache mixPoints.json).
/// - `duration_sec`  : duração do arquivo em segundos (vinda dos metadados da playlist).
/// - `sensitivity`   : valor 0–100 de `musicMixSensitivity` / `mediaMixSensitivity`.
/// - `mix_type`      : `"basic"` ou `"advanced"` (mapeado de `mixType` em configs).
///
/// A função roda em thread bloqueante para não travar o executor async do Tauri.
#[tauri::command]
pub async fn compute_mix_point_cmd(
    path: String,
    media_id: String,
    duration_sec: f64,
    sensitivity: f64,
    mix_type: String,
) -> AppResult<MixPointResult> {
    let advanced = mix_type.to_lowercase().contains("adv") || mix_type == "Avançada";
    tokio::task::spawn_blocking(move || compute_mix_point(&path, &media_id, duration_sec, sensitivity, advanced))
        .await
        .map_err(|e| crate::error::AppError::AudioDecode(e.to_string()))?
}

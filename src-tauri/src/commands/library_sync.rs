use crate::core::library_sync;
use crate::error::AppResult;

/// Atualização manual da biblioteca (equiv. `manual=1` no worker legado): baixa música/mídia
/// da API Superaudio e persiste JSON em `C:/SyncPlay/Library/`.
#[tauri::command]
pub async fn update_syncplay_library(auth_code: String) -> AppResult<()> {
    library_sync::run_library_update(&auth_code).await
}

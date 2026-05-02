use crate::error::AppResult;
use serde_json::Value;
use std::fs;

pub const APP_SETTINGS_DIR: &str = "C:/SyncPlay/Configs";
pub const APP_SETTINGS_PATH: &str = "C:/SyncPlay/Configs/configs.json";

pub fn load_app_settings_from_disk() -> AppResult<Value> {
    let content = match fs::read_to_string(APP_SETTINGS_PATH) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(serde_json::json!({}));
        }
        Err(error) => return Err(error.into()),
    };

    if content.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }

    Ok(serde_json::from_str(&content)?)
}

pub fn write_app_settings_to_disk(settings: &Value) -> AppResult<()> {
    fs::create_dir_all(APP_SETTINGS_DIR)?;
    let content = serde_json::to_string_pretty(settings)?;
    fs::write(APP_SETTINGS_PATH, content)?;
    Ok(())
}

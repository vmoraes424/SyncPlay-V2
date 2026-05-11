use crate::core::weather::{fetch_weather_from_settings, WeatherCurrent};
use crate::error::AppResult;

#[tauri::command]
pub async fn fetch_weather_current() -> AppResult<Option<WeatherCurrent>> {
    fetch_weather_from_settings().await
}

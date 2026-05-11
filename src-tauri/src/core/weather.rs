use crate::core::settings::load_app_settings_from_disk;
use crate::error::AppResult;
use serde::Deserialize;
use serde::Serialize;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherCurrent {
    pub city_label: String,
    pub icon: String,
    pub description: String,
    pub temperature_c: i32,
    pub weathercode: i32,
    pub title: String,
}

#[derive(Deserialize)]
struct GeoResponse {
    results: Option<Vec<GeoHit>>,
}

#[derive(Deserialize)]
struct GeoHit {
    latitude: f64,
    longitude: f64,
}

#[derive(Deserialize)]
struct ForecastBody {
    current_weather: CurrentWx,
}

#[derive(Deserialize)]
struct CurrentWx {
    temperature: f64,
    weathercode: i32,
}

struct GeoCacheEntry {
    city_key: String,
    lat: f64,
    lon: f64,
}

fn geo_cache_cell() -> &'static Mutex<Option<GeoCacheEntry>> {
    static CACHE: OnceLock<Mutex<Option<GeoCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn wmo_info(code: i32) -> (&'static str, &'static str) {
    match code {
        0 => ("☀️", "Céu limpo"),
        1 => ("🌤️", "Predominantemente limpo"),
        2 => ("⛅", "Parcialmente nublado"),
        3 => ("☁️", "Nublado"),
        45 => ("🌫️", "Neblina"),
        48 => ("🌫️", "Neblina com gelo"),
        51 => ("🌦️", "Garoa leve"),
        53 => ("🌦️", "Garoa"),
        55 => ("🌧️", "Garoa intensa"),
        61 => ("🌧️", "Chuva leve"),
        63 => ("🌧️", "Chuva"),
        65 => ("🌧️", "Chuva forte"),
        71 => ("🌨️", "Neve leve"),
        73 => ("❄️", "Neve"),
        75 => ("❄️", "Neve forte"),
        77 => ("🌨️", "Grãos de neve"),
        80 => ("🌦️", "Pancadas leves"),
        81 => ("🌦️", "Pancadas de chuva"),
        82 => ("⛈️", "Pancadas intensas"),
        85 => ("🌨️", "Neve em pancadas"),
        86 => ("❄️", "Neve intensa"),
        95 => ("⛈️", "Tempestade"),
        96 | 99 => ("⛈️", "Tempestade c/ granizo"),
        _ => ("🌡️", "Desconhecido"),
    }
}

pub async fn fetch_weather_from_settings() -> AppResult<Option<WeatherCurrent>> {
    let settings = load_app_settings_from_disk()?;
    let personal = settings.get("personalInfo");

    let city = personal
        .and_then(|p| p.get("city"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if city.is_empty() {
        return Ok(None);
    }

    let country = personal
        .and_then(|p| p.get("country"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    let city_label = if country.is_empty() {
        city.clone()
    } else {
        format!("{city} - {country}")
    };

    let client = reqwest::Client::new();

    let cached = {
        let cache = geo_cache_cell()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cache
            .as_ref()
            .filter(|e| e.city_key == city)
            .map(|e| (e.lat, e.lon))
    };

    let (lat, lon) = if let Some(coords) = cached {
        coords
    } else {
        let mut geo_url = reqwest::Url::parse(
            "https://geocoding-api.open-meteo.com/v1/search",
        )
        .expect("hardcoded geo URL");
        geo_url
            .query_pairs_mut()
            .append_pair("name", &city)
            .append_pair("count", "1")
            .append_pair("language", "pt")
            .append_pair("format", "json");

        let geo: GeoResponse = client.get(geo_url).send().await?.json().await?;
        let Some(results) = geo.results.filter(|r| !r.is_empty()) else {
            eprintln!("[Weather] Cidade não encontrada: {city}");
            return Ok(None);
        };
        let first = &results[0];
        let lat = first.latitude;
        let lon = first.longitude;
        let mut cache = geo_cache_cell()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *cache = Some(GeoCacheEntry {
            city_key: city.clone(),
            lat,
            lon,
        });
        (lat, lon)
    };

    let mut wx_url =
        reqwest::Url::parse("https://api.open-meteo.com/v1/forecast").expect("hardcoded wx URL");
    wx_url.query_pairs_mut().append_pair("latitude", &lat.to_string());
    wx_url
        .query_pairs_mut()
        .append_pair("longitude", &lon.to_string());
    wx_url
        .query_pairs_mut()
        .append_pair("current_weather", "true");
    wx_url.query_pairs_mut().append_pair("timezone", "auto");
    wx_url.query_pairs_mut().append_pair("forecast_days", "1");

    let body: ForecastBody = client.get(wx_url).send().await?.json().await?;
    let cw = body.current_weather;
    let code = cw.weathercode;
    let temp = cw.temperature.round() as i32;
    let (icon, desc) = wmo_info(code);

    let title = format!("{city_label} • {desc} • {temp}°C");
    eprintln!("[Weather] {city_label}: {temp}°C — {desc} (WMO {code})");

    Ok(Some(WeatherCurrent {
        city_label,
        icon: icon.to_string(),
        description: desc.to_string(),
        temperature_c: temp,
        weathercode: code,
        title,
    }))
}

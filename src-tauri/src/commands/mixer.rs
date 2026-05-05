use crate::core::mixer::{list_audio_devices, save_mixer_routing};
use crate::models::mixer::{AudioDevice, BusConfig, ChannelGain, ChannelRouting, MixerRouting};
use crate::state::AppState;
use tauri::State;

fn normalize_bus_id(bus: &str) -> &str {
    match bus {
        "fone" => "retorno",
        b => b,
    }
}

// ---------------------------------------------------------------------------
// Estado completo
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_mixer_state(state: State<AppState>) -> MixerRouting {
    let mut r = state.mixer_routing.lock().unwrap();
    r.merge_missing_defaults();
    r.clone()
}

// ---------------------------------------------------------------------------
// Canal – ganho e mute
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn set_channel_gain(channel: String, value: f32, state: State<AppState>) {
    let mut r = state.mixer_routing.lock().unwrap();
    let ch = r.channels.entry(channel).or_insert_with(ChannelGain::default);
    ch.value = value.clamp(0.0, 1.0);
    let snap = r.clone();
    drop(r);
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn set_channel_muted(channel: String, muted: bool, state: State<AppState>) {
    let mut r = state.mixer_routing.lock().unwrap();
    let ch = r.channels.entry(channel).or_insert_with(ChannelGain::default);
    ch.muted = muted;
    let snap = r.clone();
    drop(r);
    save_mixer_routing(&snap);
}

// ---------------------------------------------------------------------------
// Canal – roteamento por bus
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn toggle_master_route(channel: String, state: State<AppState>) -> bool {
    let mut r = state.mixer_routing.lock().unwrap();
    let route = r
        .routing
        .entry(channel)
        .or_insert_with(ChannelRouting::default);
    route.master = !route.master;
    let new_val = route.master;
    let snap = r.clone();
    drop(r);
    save_mixer_routing(&snap);
    new_val
}

#[tauri::command]
pub fn toggle_monitor_route(channel: String, state: State<AppState>) -> bool {
    let mut r = state.mixer_routing.lock().unwrap();
    let route = r
        .routing
        .entry(channel)
        .or_insert_with(ChannelRouting::default);
    route.monitor = !route.monitor;
    let new_val = route.monitor;
    let snap = r.clone();
    drop(r);
    save_mixer_routing(&snap);
    new_val
}

#[tauri::command]
pub fn toggle_retorno_route(channel: String, state: State<AppState>) -> bool {
    let mut r = state.mixer_routing.lock().unwrap();
    let route = r
        .routing
        .entry(channel)
        .or_insert_with(ChannelRouting::default);
    route.retorno = !route.retorno;
    let new_val = route.retorno;
    let snap = r.clone();
    drop(r);
    save_mixer_routing(&snap);
    new_val
}

#[tauri::command]
pub fn toggle_out_route(channel: String, state: State<AppState>) -> bool {
    let mut r = state.mixer_routing.lock().unwrap();
    let route = r
        .routing
        .entry(channel)
        .or_insert_with(ChannelRouting::default);
    route.out = !route.out;
    let new_val = route.out;
    let snap = r.clone();
    drop(r);
    save_mixer_routing(&snap);
    new_val
}

#[tauri::command]
pub fn set_out_device(channel: String, device_id: Option<String>, state: State<AppState>) {
    let mut r = state.mixer_routing.lock().unwrap();
    let route = r
        .routing
        .entry(channel)
        .or_insert_with(ChannelRouting::default);
    route.out_device_id = device_id;
    let snap = r.clone();
    drop(r);
    save_mixer_routing(&snap);
}

// ---------------------------------------------------------------------------
// Bus – ganho, mute e dispositivo de saída
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn set_bus_gain(bus: String, value: f32, state: State<AppState>) {
    let bus = normalize_bus_id(bus.as_str());
    let mut r = state.mixer_routing.lock().unwrap();
    let gain = value.clamp(0.0, 1.0);
    match bus {
        "master" => r.master.gain = gain,
        "monitor" => r.monitor.gain = gain,
        "retorno" => r.retorno.gain = gain,
        _ => return,
    }
    let snap = r.clone();
    drop(r);
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn set_bus_muted(bus: String, muted: bool, state: State<AppState>) {
    let bus = normalize_bus_id(bus.as_str());
    let mut r = state.mixer_routing.lock().unwrap();
    match bus {
        "master" => r.master.muted = muted,
        "monitor" => r.monitor.muted = muted,
        "retorno" => r.retorno.muted = muted,
        _ => return,
    }
    let snap = r.clone();
    drop(r);
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn set_bus_device(bus: String, device_id: Option<String>, state: State<AppState>) {
    let bus = normalize_bus_id(bus.as_str());
    let mut r = state.mixer_routing.lock().unwrap();
    let bus_cfg: &mut BusConfig = match bus {
        "master" => &mut r.master,
        "monitor" => &mut r.monitor,
        "retorno" => &mut r.retorno,
        _ => return,
    };
    bus_cfg.device_id = device_id;
    let snap = r.clone();
    drop(r);
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn get_bus_config(bus: String, state: State<AppState>) -> Option<BusConfig> {
    let bus = normalize_bus_id(bus.as_str());
    let r = state.mixer_routing.lock().unwrap();
    match bus {
        "master" => Some(r.master.clone()),
        "monitor" => Some(r.monitor.clone()),
        "retorno" => Some(r.retorno.clone()),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Dispositivos de áudio disponíveis
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_audio_devices_cmd() -> Vec<AudioDevice> {
    list_audio_devices()
}

// ---------------------------------------------------------------------------
// Reset ao padrão
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn reset_mixer_routing(state: State<AppState>) {
    let mut default = MixerRouting::default();
    default.merge_missing_defaults();
    save_mixer_routing(&default);
    *state.mixer_routing.lock().unwrap() = default;
}

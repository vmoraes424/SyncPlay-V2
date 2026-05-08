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

#[tauri::command]
pub fn get_mixer_state(state: State<AppState>) -> MixerRouting {
    let mixer = state.mixer.lock().unwrap();
    // mixer.routing.merge_missing_defaults(); // Se esse método existir no seu model
    mixer.routing.clone()
}

#[tauri::command]
pub fn set_channel_gain(channel: String, value: f32, state: State<AppState>) {
    let mut mixer = state.mixer.lock().unwrap();
    let ch = mixer.routing.channels.entry(channel).or_insert_with(ChannelGain::default);
    ch.value = value.clamp(0.0, 1.0);
    let snap = mixer.routing.clone();
    drop(mixer);
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn set_channel_muted(channel: String, muted: bool, state: State<AppState>) {
    let mut mixer = state.mixer.lock().unwrap();
    let ch = mixer.routing.channels.entry(channel).or_insert_with(ChannelGain::default);
    ch.muted = muted;
    let snap = mixer.routing.clone();
    drop(mixer);
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn toggle_master_route(channel: String, state: State<AppState>) -> bool {
    let mut mixer = state.mixer.lock().unwrap();
    let route = mixer.routing.routing.entry(channel).or_insert_with(ChannelRouting::default);
    route.master = !route.master;
    let new_val = route.master;
    let snap = mixer.routing.clone();
    drop(mixer);
    save_mixer_routing(&snap);
    new_val
}

#[tauri::command]
pub fn toggle_monitor_route(channel: String, state: State<AppState>) -> bool {
    let mut mixer = state.mixer.lock().unwrap();
    let route = mixer.routing.routing.entry(channel).or_insert_with(ChannelRouting::default);
    route.monitor = !route.monitor;
    let new_val = route.monitor;
    let snap = mixer.routing.clone();
    drop(mixer);
    save_mixer_routing(&snap);
    new_val
}

#[tauri::command]
pub fn toggle_retorno_route(channel: String, state: State<AppState>) -> bool {
    let mut mixer = state.mixer.lock().unwrap();
    let route = mixer.routing.routing.entry(channel).or_insert_with(ChannelRouting::default);
    route.retorno = !route.retorno;
    let new_val = route.retorno;
    let snap = mixer.routing.clone();
    drop(mixer);
    save_mixer_routing(&snap);
    new_val
}

#[tauri::command]
pub fn toggle_out_route(channel: String, state: State<AppState>) -> bool {
    let mut mixer = state.mixer.lock().unwrap();
    let route = mixer.routing.routing.entry(channel).or_insert_with(ChannelRouting::default);
    route.out = !route.out;
    let new_val = route.out;
    let snap = mixer.routing.clone();
    drop(mixer);
    save_mixer_routing(&snap);
    new_val
}

#[tauri::command]
pub fn set_out_device(channel: String, device_id: Option<String>, state: State<AppState>) {
    let mut mixer = state.mixer.lock().unwrap();
    let route = mixer.routing.routing.entry(channel).or_insert_with(ChannelRouting::default);
    route.out_device_id = device_id;
    let snap = mixer.routing.clone();
    drop(mixer);
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn set_bus_gain(bus: String, value: f32, state: State<AppState>) {
    let bus = normalize_bus_id(bus.as_str());
    let mut mixer = state.mixer.lock().unwrap();
    let gain = value.clamp(0.0, 1.0);
    match bus {
        "master" => mixer.routing.master.gain = gain,
        "monitor" => mixer.routing.monitor.gain = gain,
        "retorno" => mixer.routing.retorno.gain = gain,
        _ => return,
    }
    let snap = mixer.routing.clone();
    drop(mixer);
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn set_bus_muted(bus: String, muted: bool, state: State<AppState>) {
    let bus = normalize_bus_id(bus.as_str());
    let mut mixer = state.mixer.lock().unwrap();
    match bus {
        "master" => mixer.routing.master.muted = muted,
        "monitor" => mixer.routing.monitor.muted = muted,
        "retorno" => mixer.routing.retorno.muted = muted,
        _ => return,
    }
    let snap = mixer.routing.clone();
    drop(mixer);
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn set_bus_device(bus: String, device_id: Option<String>, state: State<AppState>) {
    let bus = normalize_bus_id(bus.as_str());
    let mut mixer = state.mixer.lock().unwrap();
    let bus_cfg: &mut BusConfig = match bus {
        "master" => &mut mixer.routing.master,
        "monitor" => &mut mixer.routing.monitor,
        "retorno" => &mut mixer.routing.retorno,
        _ => return,
    };
    bus_cfg.device_id = device_id;
    let snap = mixer.routing.clone();
    drop(mixer);
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn get_bus_config(bus: String, state: State<AppState>) -> Option<BusConfig> {
    let bus = normalize_bus_id(bus.as_str());
    let mixer = state.mixer.lock().unwrap();
    match bus {
        "master" => Some(mixer.routing.master.clone()),
        "monitor" => Some(mixer.routing.monitor.clone()),
        "retorno" => Some(mixer.routing.retorno.clone()),
        _ => None,
    }
}

#[tauri::command]
pub fn list_audio_devices_cmd() -> Vec<AudioDevice> {
    list_audio_devices()
}

#[tauri::command]
pub fn reset_mixer_routing(state: State<AppState>) {
    let default = MixerRouting::default();
    // default.merge_missing_defaults(); // Se existir
    save_mixer_routing(&default);
    state.mixer.lock().unwrap().routing = default;
}
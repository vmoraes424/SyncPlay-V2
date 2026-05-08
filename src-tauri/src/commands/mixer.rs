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
    let routing = state.routing.lock().unwrap();
    // routing.merge_missing_defaults(); // Se esse método existir no seu model
    routing.clone()
}

#[tauri::command]
pub fn set_channel_gain(channel: String, value: f32, state: State<AppState>) {
    let mut routing = state.routing.lock().unwrap();
    let ch = routing.channels.entry(channel).or_insert_with(ChannelGain::default);
    ch.value = value.clamp(0.0, 1.0);
    let snap = routing.clone();
    drop(routing);
    let _ = state.mixer_tx.send(crate::core::mixer::MixerCommand::UpdateRouting(snap.clone()));
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn set_channel_muted(channel: String, muted: bool, state: State<AppState>) {
    let mut routing = state.routing.lock().unwrap();
    let ch = routing.channels.entry(channel).or_insert_with(ChannelGain::default);
    ch.muted = muted;
    let snap = routing.clone();
    drop(routing);
    let _ = state.mixer_tx.send(crate::core::mixer::MixerCommand::UpdateRouting(snap.clone()));
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn toggle_master_route(channel: String, state: State<AppState>) -> bool {
    let mut routing = state.routing.lock().unwrap();
    let route = routing.routing.entry(channel).or_insert_with(ChannelRouting::default);
    route.master = !route.master;
    let new_val = route.master;
    let snap = routing.clone();
    drop(routing);
    let _ = state.mixer_tx.send(crate::core::mixer::MixerCommand::UpdateRouting(snap.clone()));
    save_mixer_routing(&snap);
    new_val
}

#[tauri::command]
pub fn toggle_monitor_route(channel: String, state: State<AppState>) -> bool {
    let mut routing = state.routing.lock().unwrap();
    let route = routing.routing.entry(channel).or_insert_with(ChannelRouting::default);
    route.monitor = !route.monitor;
    let new_val = route.monitor;
    let snap = routing.clone();
    drop(routing);
    let _ = state.mixer_tx.send(crate::core::mixer::MixerCommand::UpdateRouting(snap.clone()));
    save_mixer_routing(&snap);
    new_val
}

#[tauri::command]
pub fn toggle_retorno_route(channel: String, state: State<AppState>) -> bool {
    let mut routing = state.routing.lock().unwrap();
    let route = routing.routing.entry(channel).or_insert_with(ChannelRouting::default);
    route.retorno = !route.retorno;
    let new_val = route.retorno;
    let snap = routing.clone();
    drop(routing);
    let _ = state.mixer_tx.send(crate::core::mixer::MixerCommand::UpdateRouting(snap.clone()));
    save_mixer_routing(&snap);
    new_val
}

#[tauri::command]
pub fn toggle_out_route(channel: String, state: State<AppState>) -> bool {
    let mut routing = state.routing.lock().unwrap();
    let route = routing.routing.entry(channel).or_insert_with(ChannelRouting::default);
    route.out = !route.out;
    let new_val = route.out;
    let snap = routing.clone();
    drop(routing);
    let _ = state.mixer_tx.send(crate::core::mixer::MixerCommand::UpdateRouting(snap.clone()));
    save_mixer_routing(&snap);
    new_val
}

#[tauri::command]
pub fn set_out_device(channel: String, device_id: Option<String>, state: State<AppState>) {
    let mut routing = state.routing.lock().unwrap();
    let route = routing.routing.entry(channel).or_insert_with(ChannelRouting::default);
    route.out_device_id = device_id;
    let snap = routing.clone();
    drop(routing);
    let _ = state.mixer_tx.send(crate::core::mixer::MixerCommand::UpdateRouting(snap.clone()));
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn set_bus_gain(bus: String, value: f32, state: State<AppState>) {
    let bus = normalize_bus_id(bus.as_str());
    let mut routing = state.routing.lock().unwrap();
    let gain = value.clamp(0.0, 1.0);
    match bus {
        "master" => routing.master.gain = gain,
        "monitor" => routing.monitor.gain = gain,
        "retorno" => routing.retorno.gain = gain,
        _ => return,
    }
    let snap = routing.clone();
    drop(routing);
    let _ = state.mixer_tx.send(crate::core::mixer::MixerCommand::UpdateRouting(snap.clone()));
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn set_bus_muted(bus: String, muted: bool, state: State<AppState>) {
    let bus = normalize_bus_id(bus.as_str());
    let mut routing = state.routing.lock().unwrap();
    match bus {
        "master" => routing.master.muted = muted,
        "monitor" => routing.monitor.muted = muted,
        "retorno" => routing.retorno.muted = muted,
        _ => return,
    }
    let snap = routing.clone();
    drop(routing);
    let _ = state.mixer_tx.send(crate::core::mixer::MixerCommand::UpdateRouting(snap.clone()));
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn set_bus_device(bus: String, device_id: Option<String>, state: State<AppState>) {
    let bus = normalize_bus_id(bus.as_str());
    let mut routing = state.routing.lock().unwrap();
    let bus_cfg: &mut BusConfig = match bus {
        "master" => &mut routing.master,
        "monitor" => &mut routing.monitor,
        "retorno" => &mut routing.retorno,
        _ => return,
    };
    bus_cfg.device_id = device_id;
    let snap = routing.clone();
    drop(routing);
    let _ = state.mixer_tx.send(crate::core::mixer::MixerCommand::UpdateRouting(snap.clone()));
    save_mixer_routing(&snap);
}

#[tauri::command]
pub fn get_bus_config(bus: String, state: State<AppState>) -> Option<BusConfig> {
    let bus = normalize_bus_id(bus.as_str());
    let routing = state.routing.lock().unwrap();
    match bus {
        "master" => Some(routing.master.clone()),
        "monitor" => Some(routing.monitor.clone()),
        "retorno" => Some(routing.retorno.clone()),
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
    *state.routing.lock().unwrap() = default.clone();
    let _ = state.mixer_tx.send(crate::core::mixer::MixerCommand::UpdateRouting(default));
}
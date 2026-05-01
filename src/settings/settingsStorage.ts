import { invoke } from '@tauri-apps/api/core';
import { mergeAppSettings } from './defaults';
import type { AppSettings } from './types';

export async function loadAppSettings(): Promise<AppSettings> {
  const raw = await invoke<unknown>('read_app_settings');
  return mergeAppSettings(raw);
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  await invoke('write_app_settings', { settings });
}

/** Valor cru de uma chave de topo em `configs.json` (via Tauri). Ausente → `null`. */
export async function getAppSetting(key: string): Promise<unknown> {
  return invoke<unknown>('get_app_setting', { key });
}

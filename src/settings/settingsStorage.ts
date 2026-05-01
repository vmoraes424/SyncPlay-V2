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

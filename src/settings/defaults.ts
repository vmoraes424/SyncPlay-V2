import type { AppSettings } from './types';

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  ui: {
    settings: {
      activeMenuId: null,
    },
  },
  modules: {},
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeObjects<T extends object>(defaults: T, raw: unknown): T {
  if (!isPlainObject(raw)) return defaults;

  const defaultsRecord = defaults as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...defaultsRecord };
  for (const [key, value] of Object.entries(raw)) {
    const defaultValue = defaultsRecord[key];
    merged[key] = isPlainObject(defaultValue)
      ? mergeObjects(defaultValue, value)
      : value;
  }

  return merged as T;
}

export function mergeAppSettings(raw: unknown): AppSettings {
  return mergeObjects(DEFAULT_SETTINGS, raw);
}

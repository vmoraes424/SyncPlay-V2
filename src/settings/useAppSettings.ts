import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS } from './defaults';
import { loadAppSettings, saveAppSettings } from './settingsStorage';
import type { AppSettings } from './types';

type SettingsUpdater = AppSettings | ((current: AppSettings) => AppSettings);

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    loadAppSettings()
      .then(loadedSettings => {
        if (!active) return;
        setSettings(loadedSettings);
        setError(null);
      })
      .catch(err => {
        if (!active) return;
        setError(String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const updateSettings = useCallback((updater: SettingsUpdater) => {
    setSettings(current => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      saveAppSettings(next).catch(err => setError(String(err)));
      return next;
    });
  }, []);

  return { settings, loading, error, updateSettings };
}

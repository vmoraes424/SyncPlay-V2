/**
 * Configuração da API Superaudio (equivalente moderno ao `loadApiConfig()` do Electron).
 * O campo `sn` vem do arquivo `%LOCALAPPDATA%\\SuperAudio\\configAPI` (JSON),
 * obtido via comando Tauri `read_superaudio_api_config`.
 */

import { invoke } from '@tauri-apps/api/core';

export interface SuperaudioApiConfig {
  authCode: string;
  nickname: string;
  ClientID: string;
  company: string;
  /** Serial SyncPlay — valor do header `X-SyncPlay-SN`. */
  sn: string;
  type: string | number | boolean | null;
  syncType: string;
  version: string;
  refreshToken: string;
  token: string;
}

declare global {
  interface Window {
    /** Paridade com o player Electron: objeto global após `loadApiConfig()`. */
    apiConfig?: SuperaudioApiConfig;
  }
}

const DEFAULTS: SuperaudioApiConfig = {
  authCode: '',
  nickname: '',
  ClientID: '',
  company: '',
  sn: '',
  type: null,
  syncType: '',
  version: '',
  refreshToken: '',
  token: '',
};

function asStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Mescla objeto lido da API/arquivo sobre os defaults (sem mutar defaults). */
export function mergeSuperaudioApiConfig(parsed: Record<string, unknown> | null | undefined): SuperaudioApiConfig {
  const p = parsed ?? {};
  return {
    ...DEFAULTS,
    authCode: asStr(p.authCode ?? DEFAULTS.authCode),
    nickname: asStr(p.nickname ?? DEFAULTS.nickname),
    ClientID: asStr(p.ClientID ?? p.clientId ?? DEFAULTS.ClientID),
    company: asStr(p.company ?? DEFAULTS.company),
    sn: asStr(p.sn ?? DEFAULTS.sn),
    type: coerceTypeField(p.type),
    syncType: asStr(p.syncType ?? DEFAULTS.syncType),
    version: asStr(p.version ?? DEFAULTS.version),
    refreshToken: asStr(p.refreshToken ?? DEFAULTS.refreshToken),
    token: asStr(p.token ?? DEFAULTS.token),
  };
}

function coerceTypeField(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return null;
}

let loadInFlight: Promise<SuperaudioApiConfig> | null = null;

export interface LoadApiConfigOptions {
  /** Ignora cache em memória e relê arquivo. */
  force?: boolean;
}

/**
 * Carrega `{ sn, token, … }` do disco via Tauri, aplica defaults e atualiza `window.apiConfig`.
 * Idempotente: reutiliza o mesmo resultado em paralelo quando várias chamadas ocorrem de uma vez.
 */
export async function loadApiConfig(options: LoadApiConfigOptions = {}): Promise<SuperaudioApiConfig> {
  const force = !!options.force;

  if (
    !force &&
    typeof window !== 'undefined' &&
    window.apiConfig &&
    window.apiConfig.sn?.trim()
  ) {
    return mergeSuperaudioApiConfig(window.apiConfig as unknown as Record<string, unknown>);
  }

  if (!force && loadInFlight) {
    return loadInFlight;
  }

  const promise = (async (): Promise<SuperaudioApiConfig> => {
    let raw: unknown;
    try {
      raw = await invoke<unknown>('read_superaudio_api_config');
    } catch (e) {
      console.warn('[AI API Config] Falha ao ler config via Tauri:', e);
      raw = {};
    }

    const obj =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

    const merged = mergeSuperaudioApiConfig(obj);
    if (typeof window !== 'undefined') {
      window.apiConfig = merged;
    }
    return merged;
  })();

  if (!force) {
    loadInFlight = promise;
    void promise.finally(() => {
      if (loadInFlight === promise) {
        loadInFlight = null;
      }
    });
  }

  return promise;
}

/** Serial normalizado para headers HTTP (vazio se ausente). */
export function getSyncPlaySn(config: SuperaudioApiConfig): string {
  return config.sn.trim();
}

/** Invalida `window.apiConfig` para que a próxima `loadApiConfig()` releia o disco. */
export function invalidateApiConfigCache(): void {
  if (typeof window !== 'undefined') {
    Reflect.deleteProperty(window, 'apiConfig');
  }
}

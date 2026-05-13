/**
 * Cliente para rotas Controla / prompts na Superaudio.
 * Via Tauri, o tráfego sai por `reqwest` no Rust (`superaudio_prompts_proxy`) — sem CORS no WebView.
 */

import { invoke } from '@tauri-apps/api/core';

export type JsonObject = Record<string, unknown>;

interface ProxyResponse {
  status: number;
  body: string;
}

async function superaudioPromptsProxy(
  method: 'GET' | 'POST',
  path: string,
  serial: string,
  body?: string
): Promise<ProxyResponse> {
  const res = await invoke<ProxyResponse>('superaudio_prompts_proxy', {
    method,
    path: path.replace(/^\/+/, ''),
    syncPlaySn: serial.trim(),
    body: body ?? null,
  });
  return res;
}

function parseJsonSafe<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw || 'null') as T;
  } catch {
    throw new Error(`${label}: resposta não é JSON válido`);
  }
}

export interface PromptsApiGetPayload extends JsonObject {
  success?: boolean;
  company_prompts?: JsonObject[];
  global_prompts?: JsonObject[];
  voice_velocity_configs?: unknown;
}

export async function fetchCloudPrompts(serial: string): Promise<PromptsApiGetPayload> {
  const { status, body } = await superaudioPromptsProxy('GET', 'api-get', serial);
  if (status < 200 || status >= 300) {
    throw new Error(`prompts/api-get HTTP ${status}`);
  }
  return parseJsonSafe<PromptsApiGetPayload>(body, 'api-get');
}

export async function fetchAiVoices(serial: string): Promise<unknown> {
  const { status, body } = await superaudioPromptsProxy('GET', 'get-voices', serial);
  if (status < 200 || status >= 300) {
    throw new Error(`prompts/get-voices HTTP ${status}`);
  }
  return parseJsonSafe<unknown>(body, 'get-voices');
}

/** Tokens ficam apenas em memória no front — não persistir em disco. */
export async function fetchAiTokens(serial: string): Promise<unknown> {
  const { status, body } = await superaudioPromptsProxy('GET', 'get-token', serial);
  if (status < 200 || status >= 300) {
    throw new Error(`prompts/get-token HTTP ${status}`);
  }
  return parseJsonSafe<unknown>(body, 'get-token');
}

export async function cloneCloudPrompt(serial: string, body: JsonObject): Promise<unknown> {
  const json = JSON.stringify(body);
  const { status, body: raw } = await superaudioPromptsProxy('POST', 'clone', serial, json);
  if (status < 200 || status >= 300) {
    throw new Error(`clone HTTP ${status}${raw ? `: ${raw.slice(0, 200)}` : ''}`);
  }
  try {
    return JSON.parse(raw || '{}') as unknown;
  } catch {
    return {};
  }
}

export async function addCloudPrompt(serial: string, body: JsonObject): Promise<unknown> {
  const json = JSON.stringify(body);
  const { status, body: raw } = await superaudioPromptsProxy('POST', 'add', serial, json);
  if (status < 200 || status >= 300) {
    throw new Error(`add HTTP ${status}${raw ? `: ${raw.slice(0, 200)}` : ''}`);
  }
  try {
    return JSON.parse(raw || '{}') as unknown;
  } catch {
    return {};
  }
}

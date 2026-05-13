import type { JsonObject } from '../../../api/superaudioAi';

export type PromptCategory = 'company' | 'global';

/** Payload enviado no drag conforme SyncPlay Electron (`resources/js/ai.js`). */
export const AI_PROMPT_DRAG_MIME = 'text/plain';

export interface NormalizedAiPromptCard {
  id: string;
  title: string;
  excerpt: string;
  body: string;
  category: PromptCategory;
  raw: JsonObject;
}

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Identificador estável para chave React / drag — tenta vários nomes vindos da API. */
export function promptStableId(raw: JsonObject): string {
  const keys = [
    'id',
    'prompt_id',
    '_id',
    'uuid',
    'hash',
  ] as const;
  for (const k of keys) {
    const s = str(raw[k]);
    if (s) return s;
  }
  const fallback = `${str(raw.title || raw.name || raw.titulo)}|${str(raw.prompt || raw.texto)}`.slice(
    0,
    200
  );
  return fallback || `anon_${Math.random().toString(36).slice(2)}`;
}

function pickTitle(raw: JsonObject): string {
  const t = str(raw.title || raw.name || raw.titulo || raw.label || raw.nome || raw.prompt_title);
  return t || '(Sem título)';
}

function pickBody(raw: JsonObject): string {
  return str(
    raw.prompt ||
      raw.texto ||
      raw.text ||
      raw.content ||
      raw.body ||
      raw.instructions ||
      raw.message
  );
}

export function truncateForCard(text: string, max = 100): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function normalizeCompanyPrompt(raw: JsonObject): NormalizedAiPromptCard {
  const body = pickBody(raw);
  return {
    id: promptStableId(raw),
    title: pickTitle(raw),
    excerpt: truncateForCard(body),
    body,
    category: 'company',
    raw,
  };
}

/** Globais são normalizadas no cliente como no Electron (merge com defaults fica opcional aqui). */
export function normalizeGlobalPrompt(raw: JsonObject): NormalizedAiPromptCard {
  const merged: JsonObject = { ...raw };
  const body = pickBody(merged);
  return {
    id: promptStableId(merged),
    title: pickTitle(merged),
    excerpt: truncateForCard(body),
    body,
    category: 'global',
    raw: merged,
  };
}

export function buildAiPromptDragPayload(raw: JsonObject): string {
  return JSON.stringify({
    type: 'ai-prompt',
    prompt: raw,
  });
}

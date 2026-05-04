/**
 * Detecção automática de ponto de mix por sensibilidade.
 *
 * Para cada `PlayableItem` elegível (conforme `automaticMix`/`automaticMixMedia`),
 * invoca o comando Rust `compute_mix_point_cmd` que roda o algoritmo de 500 amostras
 * descrito na spec. O resultado é cacheado em `C:/SyncPlay/Configs/mixPoints.json`.
 *
 * Retorna um mapa `itemId → mix_end_ms` com os overrides computados.
 * Se houver resultado válido no cache/algoritmo, aplica o ponto detectado com prioridade.
 *
 * Concorrência limitada a MAX_CONCURRENT.
 * O effect usa uma chave derivada dos PATHS (string, comparada por valor) como dep,
 * em vez da array de items: assim o detection não é cancelado quando metadados
 * (discarded, schedule, etc.) mudam sem alterar o conjunto de arquivos.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AutoMixSettings, PlayableItem } from '../types';

interface RustMixPointResult {
  mix_time_sec: number;
  mixTimeSec?: number;
  detected: boolean;
}

interface RustCachedMixPointResult {
  mix_time_sec: number;
  mixTimeSec?: number;
  detected: boolean;
  cache_hit: boolean;
  cacheHit?: boolean;
}

/** Número máximo de decodificações de áudio simultâneas. */
const MAX_CONCURRENT = 3;

/**
 * Aguarda estabilização antes de iniciar (evita cancelamentos durante o boot
 * enquanto o primeiro ciclo de schedule/descarte termina).
 */
const DETECTION_DEBOUNCE_MS = 1500;
const AUTO_MIX_DEBUG = false;

/** Faz o parse de valores de sensibilidade que podem vir como número ou string "25,00". */
function parseSensitivity(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const cleaned = raw.trim().replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Mapeamento do valor armazenado em configs.json para o enum do Rust. */
function parseMixType(raw: unknown): 'basic' | 'advanced' {
  if (raw === 'advanced' || raw === 'Avançada' || raw === 1 || raw === '1') return 'advanced';
  return 'basic';
}

export function parseAutoMixSettings(raw: Record<string, unknown>): AutoMixSettings {
  return {
    automaticMix: Boolean(raw.automaticMix),
    automaticMixMedia: Boolean(raw.automaticMixMedia),
    musicMixSensitivity: parseSensitivity(raw.musicMixSensitivity, 25),
    mediaMixSensitivity: parseSensitivity(raw.mediaMixSensitivity, 20),
    mixType: parseMixType(raw.mixType),
  };
}

function isAutoMixEligible(item: PlayableItem, settings: AutoMixSettings): boolean {
  const type = item.media_type.toLowerCase();
  if (type === 'command' || type === 'commercial' || type === 'vem') return false;
  if (!item.path) return false;
  const isMusic = type === 'music';
  return isMusic ? settings.automaticMix : settings.automaticMixMedia;
}

function getSensitivity(item: PlayableItem, settings: AutoMixSettings): number {
  return item.media_type.toLowerCase() === 'music'
    ? settings.musicMixSensitivity
    : settings.mediaMixSensitivity;
}

/**
 * Hook que monitora mudanças no CONJUNTO de arquivos (não em metadados) e nas
 * configurações, aguarda estabilização via debounce, lança detecções com
 * concorrência limitada e retorna overrides `itemId → mix_end_ms` (u64 inteiro).
 */
export function useAutoMixDetection(
  playableItems: PlayableItem[],
  settings: AutoMixSettings | null
): Record<string, number> {
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  /**
   * Ref que sempre aponta para a versão mais recente de playableItems.
   * O effect lê daqui quando o timer dispara (não da closure do effect),
   * garantindo valores atuais de mix_end_ms sem precisar recriar o effect.
   */
  const itemsRef = useRef(playableItems);
  itemsRef.current = playableItems;

  /**
   * Chave derivada dos paths elegíveis — string primitiva comparada por valor.
   * Só muda quando o CONJUNTO de arquivos muda; mudanças de metadados (discarded,
   * schedule, durations) não alteram os paths, então o effect não é re-disparado.
   */
  const itemsKey = useMemo(
    () => playableItems
      .filter(i => {
        if (!settings) return false;
        return isAutoMixEligible(i, settings) && !!i.duration_ms && i.duration_ms > 0;
      })
      .map(i => i.path)
      .join('\n'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playableItems, settings]
  );

  useEffect(() => {
    if (!settings) return;
    if (!settings.automaticMix && !settings.automaticMixMedia) return;
    if (!itemsKey) return;

    let cancelled = false;

    const timer = setTimeout(() => {
      if (cancelled) return;
      void (async () => {
        // Lê a versão mais recente dos items (atualizada por itemsRef)
        const items = itemsRef.current
          .filter((item) => isAutoMixEligible(item, settings) && !!item.duration_ms && item.duration_ms > 0);
        if (items.length === 0) return;

        const advanced = settings.mixType === 'advanced';
        const misses: PlayableItem[] = [];

        const runConcurrent = async (
          list: PlayableItem[],
          worker: (item: PlayableItem) => Promise<void>
        ) => {
          if (list.length === 0) return;
          let cursor = 0;
          const workers = Array.from(
            { length: Math.min(MAX_CONCURRENT, list.length) },
            async () => {
              while (!cancelled) {
                const idx = cursor++;
                if (idx >= list.length) break;
                await worker(list[idx]);
              }
            }
          );
          await Promise.all(workers);
        };

        // Fase 1 (prioridade): consulta somente cache mixPoints.json.
        await runConcurrent(items, async (capturedItem) => {
          const sensitivity = getSensitivity(capturedItem, settings);
          const mixType = advanced ? 'advanced' : 'basic';
          try {
            const cacheResult = await invoke<RustCachedMixPointResult>('get_cached_mix_point_cmd', {
              path: capturedItem.path,
              mediaId: capturedItem.media_id ?? capturedItem.path,
              media_id: capturedItem.media_id ?? capturedItem.path,
              sensitivity,
              mixType,
              mix_type: mixType,
            });
            if (cancelled) return;

            const cacheHit = Boolean(cacheResult.cache_hit) || Boolean(cacheResult.cacheHit);
            if (!cacheHit) {
              misses.push(capturedItem);
              return;
            }

            const mixTimeSec =
              typeof cacheResult.mix_time_sec === 'number'
                ? cacheResult.mix_time_sec
                : (typeof cacheResult.mixTimeSec === 'number' ? cacheResult.mixTimeSec : 0);
            if (mixTimeSec <= 0) {
              if (AUTO_MIX_DEBUG) {
                console.debug('[auto-mix] cache hit sem override', {
                  id: capturedItem.id,
                  mediaId: capturedItem.media_id,
                  result: cacheResult,
                });
              }
              return;
            }

            const detectedMixEndMs = Math.round(
              Math.max(0, capturedItem.duration_ms! - mixTimeSec * 1000)
            );
            if (capturedItem.mix_end_ms !== detectedMixEndMs) {
              if (AUTO_MIX_DEBUG) {
                console.debug('[auto-mix] override aplicado via cache', {
                  id: capturedItem.id,
                  mediaId: capturedItem.media_id,
                  mixTimeSec,
                  previousMixEndMs: capturedItem.mix_end_ms,
                  detectedMixEndMs,
                });
              }
              setOverrides((prev) => ({ ...prev, [capturedItem.id]: detectedMixEndMs }));
            }
          } catch (err) {
            if (!cancelled) {
              console.warn('[auto-mix] get_cached_mix_point_cmd falhou', {
                id: capturedItem.id,
                mediaId: capturedItem.media_id,
                path: capturedItem.path,
                error: String(err),
              });
              // Se a leitura de cache falhou, ainda tenta na fase de detecção.
              misses.push(capturedItem);
            }
          }
        });

        if (cancelled || misses.length === 0) return;

        // Fase 2: varredura/decodificação só para quem não estava no cache.
        await runConcurrent(misses, async (capturedItem) => {
          const sensitivity = getSensitivity(capturedItem, settings);
          const durationSec = capturedItem.duration_ms! / 1000;
          const mixType = advanced ? 'advanced' : 'basic';
          try {
            const result = await invoke<RustMixPointResult>('compute_mix_point_cmd', {
              path: capturedItem.path,
              mediaId: capturedItem.media_id ?? capturedItem.path,
              media_id: capturedItem.media_id ?? capturedItem.path,
              durationSec,
              duration_sec: durationSec,
              sensitivity,
              mixType,
              mix_type: mixType,
            });
            if (cancelled) return;

            const mixTimeSec =
              typeof result.mix_time_sec === 'number'
                ? result.mix_time_sec
                : (typeof result.mixTimeSec === 'number' ? result.mixTimeSec : 0);
            const detected = Boolean(result.detected) || mixTimeSec > 0;
            if (!detected || mixTimeSec <= 0) {
              if (AUTO_MIX_DEBUG) {
                console.debug('[auto-mix] sem detecção aplicável', {
                  id: capturedItem.id,
                  mediaId: capturedItem.media_id,
                  result,
                });
              }
              return;
            }

            const detectedMixEndMs = Math.round(
              Math.max(0, capturedItem.duration_ms! - mixTimeSec * 1000)
            );
            if (capturedItem.mix_end_ms !== detectedMixEndMs) {
              if (AUTO_MIX_DEBUG) {
                console.debug('[auto-mix] override aplicado via varredura', {
                  id: capturedItem.id,
                  mediaId: capturedItem.media_id,
                  mixTimeSec,
                  previousMixEndMs: capturedItem.mix_end_ms,
                  detectedMixEndMs,
                });
              }
              setOverrides((prev) => ({ ...prev, [capturedItem.id]: detectedMixEndMs }));
            }
          } catch (err) {
            if (!cancelled) {
              console.warn('[auto-mix] compute_mix_point_cmd falhou', {
                id: capturedItem.id,
                mediaId: capturedItem.media_id,
                path: capturedItem.path,
                error: String(err),
              });
            }
          }
        });
      })();
    }, DETECTION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  // itemsKey é a string dos paths — só muda quando o conjunto de arquivos muda de verdade
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, settings]);

  return overrides;
}

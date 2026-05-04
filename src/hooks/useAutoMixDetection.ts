/**
 * Detecção automática de ponto de mix por sensibilidade.
 *
 * Para cada `PlayableItem` elegível (conforme `automaticMix`/`automaticMixMedia`),
 * invoca o comando Rust `compute_mix_point_cmd` que roda o algoritmo de 500 amostras
 * descrito na spec. O resultado é cacheado em `C:/SyncPlay/Configs/mixPoints.json`.
 *
 * Retorna um mapa `itemId → mix_end_ms` com os overrides computados.
 * O override só é aplicado se `autoMixTimeSec > libraryMixTimeSec + 0.1` (gate da spec §8).
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
  detected: boolean;
}

/** Número máximo de decodificações de áudio simultâneas. */
const MAX_CONCURRENT = 3;

/**
 * Aguarda estabilização antes de iniciar (evita cancelamentos durante o boot
 * enquanto o primeiro ciclo de schedule/descarte termina).
 */
const DETECTION_DEBOUNCE_MS = 1500;

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

  const pendingRef = useRef<Array<() => void>>([]);
  const runningRef = useRef(0);

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

      pendingRef.current = [];

      // Lê a versão mais recente dos items (atualizada por itemsRef)
      const items = itemsRef.current;
      const advanced = settings.mixType === 'advanced';

      function runNext() {
        while (runningRef.current < MAX_CONCURRENT && pendingRef.current.length > 0) {
          const task = pendingRef.current.shift()!;
          runningRef.current++;
          task();
        }
      }

      for (const item of items) {
        if (!isAutoMixEligible(item, settings)) continue;
        if (!item.duration_ms || item.duration_ms <= 0) continue;

        const sensitivity = getSensitivity(item, settings);
        const durationSec = item.duration_ms / 1000;
        const mixType = advanced ? 'advanced' : 'basic';
        const capturedItem = item;

        pendingRef.current.push(() => {
          if (cancelled) {
            runningRef.current--;
            runNext();
            return;
          }

          invoke<RustMixPointResult>('compute_mix_point_cmd', {
            path: capturedItem.path,
            mediaId: capturedItem.media_id ?? capturedItem.path,
            durationSec,
            sensitivity,
            mixType,
          })
            .then((result) => {
              if (cancelled) return;

              if (!result.detected || result.mix_time_sec <= 0) return;

              const libraryMixTimeSec =
                capturedItem.mix_end_ms !== null
                  ? (capturedItem.duration_ms! - capturedItem.mix_end_ms) / 1000
                  : 0;

              if (result.mix_time_sec > libraryMixTimeSec + 0.1) {
                const detectedMixEndMs = Math.round(
                  Math.max(0, capturedItem.duration_ms! - result.mix_time_sec * 1000)
                );
                setOverrides((prev) => ({ ...prev, [capturedItem.id]: detectedMixEndMs }));
              }
            })
            .catch(() => {})
            .finally(() => {
              runningRef.current--;
              runNext();
            });
        });
      }

      runNext();
    }, DETECTION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      pendingRef.current = [];
    };
  // itemsKey é a string dos paths — só muda quando o conjunto de arquivos muda de verdade
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, settings]);

  return overrides;
}

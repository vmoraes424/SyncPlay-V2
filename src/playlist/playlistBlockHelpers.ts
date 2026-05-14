import { arrayMove } from '@dnd-kit/sortable';
import type { Music, SyncPlayData } from '../types';

export function legacyBool(value: unknown) {
  return value === true || value === 1 || value === '1';
}

export function mediaDurationMs(music: Music) {
  if (music.extra?.mix?.duration_real) return music.extra.mix.duration_real;
  if (music.extra?.mix?.duration_total) return music.extra.mix.duration_total;
  return typeof music.duration === 'number' && Number.isFinite(music.duration)
    ? music.duration * 1000
    : null;
}

function blockMediaKind(block: SyncPlayData['playlists'][string]['blocks'][string]): 'musics' | 'commercials' {
  const commercials = block.commercials;
  if (block.type === 'commercial' || (commercials && Object.keys(commercials).length > 0)) {
    return 'commercials';
  }
  return 'musics';
}

/** Músicas ficam em `musics`; comerciais na playlist oficial vêm em `commercials`. */
export function blockMediaRecord(block: SyncPlayData['playlists'][string]['blocks'][string]): Record<string, Music> {
  return blockMediaKind(block) === 'commercials'
    ? block.commercials ?? {}
    : block.musics ?? {};
}

function setBlockMediaRecord(
  block: SyncPlayData['playlists'][string]['blocks'][string],
  mediaKind: 'musics' | 'commercials',
  media: Record<string, Music>
) {
  return mediaKind === 'commercials'
    ? { ...block, commercials: media }
    : { ...block, musics: media };
}

/** Mesma regra que `read_playlist` no Rust: soma durações reais das mídias do mapa ativo (`blockMediaRecord`). */
function sumBlockDurationRealTotalMs(block: SyncPlayData['playlists'][string]['blocks'][string]): number {
  let sum = 0;
  for (const music of Object.values(blockMediaRecord(block))) {
    const ms = mediaDurationMs(music);
    if (typeof ms === 'number' && Number.isFinite(ms)) sum += ms;
  }
  return Math.round(sum);
}

function blockWithSyncedDurationTotal(
  block: SyncPlayData['playlists'][string]['blocks'][string]
): SyncPlayData['playlists'][string]['blocks'][string] {
  return { ...block, duration_real_total_ms: sumBlockDurationRealTotalMs(block) };
}

/**
 * Remove uma mídia do bloco (mesma convenção que `blockMediaRecord`: prioriza `commercials` se não vazio).
 */
export function removeMusicFromBlock(
  data: SyncPlayData,
  plKey: string,
  blockKey: string,
  musicKey: string
): SyncPlayData | null {
  const block = data.playlists[plKey]?.blocks[blockKey];
  if (!block) return null;
  const mediaKind = blockMediaKind(block);
  const record = blockMediaRecord(block);
  if (!(musicKey in record)) return null;
  const { [musicKey]: _removed, ...rest } = record;
  const nextBlock = blockWithSyncedDurationTotal(setBlockMediaRecord(block, mediaKind, rest));

  return {
    ...data,
    playlists: {
      ...data.playlists,
      [plKey]: {
        ...data.playlists[plKey],
        blocks: {
          ...data.playlists[plKey].blocks,
          [blockKey]: nextBlock,
        },
      },
    },
  };
}

/** Remove todas as mídias do bloco (`musics` ou `commercials`, conforme `blockMediaKind`). */
export function clearBlockMedia(
  data: SyncPlayData,
  plKey: string,
  blockKey: string
): SyncPlayData | null {
  const block = data.playlists[plKey]?.blocks[blockKey];
  if (!block) return null;
  const kind = blockMediaKind(block);
  const emptied = blockWithSyncedDurationTotal(setBlockMediaRecord(block, kind, {}));
  return {
    ...data,
    playlists: {
      ...data.playlists,
      [plKey]: {
        ...data.playlists[plKey],
        blocks: {
          ...data.playlists[plKey].blocks,
          [blockKey]: emptied,
        },
      },
    },
  };
}

/**
 * Reordena mídias dentro do mesmo bloco (`musics` ou `commercials`).
 * `activeUniqueId` / `overUniqueId` seguem o formato `${plKey}-${blockKey}-${musicKey}`.
 */
export function reorderMusicWithinBlock(
  data: SyncPlayData,
  plKey: string,
  blockKey: string,
  activeUniqueId: string,
  overUniqueId: string,
): SyncPlayData | null {
  if (activeUniqueId === overUniqueId) return data;

  const prefix = `${plKey}-${blockKey}-`;
  if (!activeUniqueId.startsWith(prefix) || !overUniqueId.startsWith(prefix)) return null;

  const activeMusicKey = activeUniqueId.slice(prefix.length);
  const overMusicKey = overUniqueId.slice(prefix.length);

  const block = data.playlists[plKey]?.blocks[blockKey];
  if (!block) return null;

  const kind = blockMediaKind(block);
  const record = blockMediaRecord(block);
  const entries = Object.entries(record);
  const oldIndex = entries.findIndex(([k]) => k === activeMusicKey);
  const newIndex = entries.findIndex(([k]) => k === overMusicKey);
  if (oldIndex === -1 || newIndex === -1) return null;

  const nextEntries = arrayMove(entries, oldIndex, newIndex);
  const nextRecord = Object.fromEntries(nextEntries);
  const nextBlock = blockWithSyncedDurationTotal(setBlockMediaRecord(block, kind, nextRecord));

  return {
    ...data,
    playlists: {
      ...data.playlists,
      [plKey]: {
        ...data.playlists[plKey],
        blocks: {
          ...data.playlists[plKey].blocks,
          [blockKey]: nextBlock,
        },
      },
    },
  };
}

/**
 * Insere uma mídia na posição `insertIndex` (0 = início). `musicKey` deve ser único (ex.: UUID).
 */
export function insertMusicIntoBlock(
  data: SyncPlayData,
  plKey: string,
  blockKey: string,
  insertIndex: number,
  musicKey: string,
  music: Music,
): SyncPlayData | null {
  const block = data.playlists[plKey]?.blocks[blockKey];
  if (!block) return null;

  const kind = blockMediaKind(block);
  const record = blockMediaRecord(block);
  if (musicKey in record) return null;

  const entries = Object.entries(record);
  const idx = Math.max(0, Math.min(insertIndex, entries.length));
  entries.splice(idx, 0, [musicKey, music]);
  const nextRecord = Object.fromEntries(entries);
  const nextBlock = blockWithSyncedDurationTotal(setBlockMediaRecord(block, kind, nextRecord));

  return {
    ...data,
    playlists: {
      ...data.playlists,
      [plKey]: {
        ...data.playlists[plKey],
        blocks: {
          ...data.playlists[plKey].blocks,
          [blockKey]: nextBlock,
        },
      },
    },
  };
}

/** Data do arquivo agregado (prefixo `AAAA-MM-DD-` quando vem de dia extra carregado). */
export function isoDateHintFromPlaylistKey(plKey: string, fallbackIso: string) {
  return /^(\d{4}-\d{2}-\d{2})-/.exec(plKey)?.[1] ?? fallbackIso;
}

export function formatBrazilianPlaylistDate(iso: string) {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const [yStr, moStr, dStr] = parts;
  const y = Number(yStr);
  const m = Number(moStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export function getBlockDisplayStart(blockStart: number | undefined, musicEntries: Array<[string, Music]>) {
  if (typeof blockStart === 'number' && Number.isFinite(blockStart)) return blockStart;

  return musicEntries.find(([, music]) =>
    typeof music.start === 'number' && Number.isFinite(music.start)
  )?.[1].start;
}

import { arrayMove } from '@dnd-kit/sortable';
import type { Music, SyncPlayData } from '../types';

type PlaylistBlock = SyncPlayData['playlists'][string]['blocks'][string];

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

function blockMediaKind(block: PlaylistBlock): 'musics' | 'commercials' {
  const commercials = block.commercials;
  if (block.type === 'commercial' || (commercials && Object.keys(commercials).length > 0)) {
    return 'commercials';
  }
  return 'musics';
}

/** Músicas ficam em `musics`; comerciais na playlist oficial vêm em `commercials`. */
export function blockMediaRecord(block: PlaylistBlock): Record<string, Music> {
  return blockMediaKind(block) === 'commercials'
    ? block.commercials ?? {}
    : block.musics ?? {};
}

function blockOrderKey(kind: 'musics' | 'commercials'): '_localMusicOrder' | '_localCommercialOrder' {
  return kind === 'commercials' ? '_localCommercialOrder' : '_localMusicOrder';
}

/**
 * Retorna as entradas do bloco na ordem correta de exibição.
 *
 * Problema: quando as chaves dos itens são strings numéricas ("0","1","2"),
 * `Object.entries` as ordena numericamente. Depois de inserir uma nova chave UUID
 * no meio da lista, o JavaScript a joga para o final (chaves não-inteiras ficam após
 * as inteiras). `_localMusicOrder` / `_localCommercialOrder` guardam a ordem real
 * após qualquer operação de inserção ou reordenação em memória.
 */
export function getOrderedBlockMediaEntries(block: PlaylistBlock): [string, Music][] {
  const kind = blockMediaKind(block);
  const record = blockMediaRecord(block);
  const order = block[blockOrderKey(kind)];

  if (order && order.length > 0) {
    const tracked = order.filter((k) => k in record);
    const extra = Object.keys(record).filter((k) => !tracked.includes(k));
    return [...tracked, ...extra].map((k) => [k, record[k]]);
  }
  return Object.entries(record);
}

function setBlockMediaRecord(
  block: PlaylistBlock,
  mediaKind: 'musics' | 'commercials',
  media: Record<string, Music>
) {
  return mediaKind === 'commercials'
    ? { ...block, commercials: media }
    : { ...block, musics: media };
}

/** Mesma regra que `read_playlist` no Rust: soma durações reais das mídias do mapa ativo (`blockMediaRecord`). */
function sumBlockDurationRealTotalMs(block: PlaylistBlock): number {
  let sum = 0;
  for (const music of Object.values(blockMediaRecord(block))) {
    const ms = mediaDurationMs(music);
    if (typeof ms === 'number' && Number.isFinite(ms)) sum += ms;
  }
  return Math.round(sum);
}

function blockWithSyncedDurationTotal(block: PlaylistBlock): PlaylistBlock {
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
  const ok = blockOrderKey(mediaKind);
  const prevOrder = block[ok];
  const nextOrder = prevOrder ? prevOrder.filter((k) => k !== musicKey) : undefined;
  const base = setBlockMediaRecord(block, mediaKind, rest);
  const nextBlock = blockWithSyncedDurationTotal(
    nextOrder !== undefined ? { ...base, [ok]: nextOrder } : base,
  );

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
  const ok = blockOrderKey(kind);
  const emptied = blockWithSyncedDurationTotal({ ...setBlockMediaRecord(block, kind, {}), [ok]: [] });
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
  // Usa a ordem local se disponível, caso contrário Object.entries (que ordena
  // numericamente strings inteiras — adequado para dados puros do servidor).
  const entries = getOrderedBlockMediaEntries(block);
  const oldIndex = entries.findIndex(([k]) => k === activeMusicKey);
  const newIndex = entries.findIndex(([k]) => k === overMusicKey);
  if (oldIndex === -1 || newIndex === -1) return null;

  const nextEntries = arrayMove(entries, oldIndex, newIndex);
  const nextRecord = Object.fromEntries(nextEntries);
  const ok = blockOrderKey(kind);
  const nextOrder = nextEntries.map(([k]) => k);
  const nextBlock = blockWithSyncedDurationTotal({
    ...setBlockMediaRecord(block, kind, nextRecord),
    [ok]: nextOrder,
  });

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
  if (musicKey in blockMediaRecord(block)) return null;

  // getOrderedBlockMediaEntries respeita a ordem local (_localMusicOrder) se existir,
  // evitando que chaves numéricas do servidor reordenem o array após Object.fromEntries.
  const entries = getOrderedBlockMediaEntries(block);
  const idx = Math.max(0, Math.min(insertIndex, entries.length));
  entries.splice(idx, 0, [musicKey, music]);
  const nextRecord = Object.fromEntries(entries);
  const ok = blockOrderKey(kind);
  const nextOrder = entries.map(([k]) => k);
  const nextBlock = blockWithSyncedDurationTotal({
    ...setBlockMediaRecord(block, kind, nextRecord),
    [ok]: nextOrder,
  });

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

/** Atualiza só `music.cover` (ex.: capa assíncrona da API catálogo). */
export function patchMusicCoverInBlock(
  data: SyncPlayData,
  plKey: string,
  blockKey: string,
  musicKey: string,
  coverUrl: string | null,
): SyncPlayData | null {
  const block = data.playlists[plKey]?.blocks[blockKey];
  if (!block) return null;

  const kind = blockMediaKind(block);
  const record = blockMediaRecord(block);
  const music = record[musicKey];
  if (!music) return null;

  const nextMusic: Music = { ...music };
  const trimmed = coverUrl?.trim();
  if (trimmed) nextMusic.cover = trimmed;
  else delete nextMusic.cover;

  const nextRecord = { ...record, [musicKey]: nextMusic };
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

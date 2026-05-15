import type { SyncplayLibraryMaps } from '../library/SyncplayLibraryContext';
import {
  buildMediaExtraFromLibraryRow,
  buildMusicExtraFromLibraryRow,
  extractLibraryRowDurationSeconds,
  findLibraryRowForFile,
  libraryRowCover,
  libraryRowDisplayTitle,
  libraryRowNumericId,
  libraryRowPathStorage,
  mapPlaylistTypeToMusicItemType,
  normalizeMixDataFromUnknown,
} from '../library/syncplayLibrary';
import type { DragItemData } from '../types/dnd';
import type { DirectoryOptionKind, ExtraData, MediaCategory, MixData, Music } from '../types';

/** Equivalente ao contexto do drop legado: JSON da biblioteca + pasta/categoria atual. */
export interface BuildMusicFromDragContext {
  mediaCategory: MediaCategory;
  libraryMaps: SyncplayLibraryMaps;
  directoryLabel?: string;
  directoryKind?: DirectoryOptionKind;
}

function fileStemFromPath(pathStr: string, fallbackTitle: string): string {
  const base = pathStr.split(/[/\\]/).pop()?.trim();
  if (base) return base.replace(/\.[^/.]+$/, '');
  return fallbackTitle;
}

function pickLibraryRows(fileRef: { path: string; name: string }, maps: SyncplayLibraryMaps) {
  const rowMusic = findLibraryRowForFile(maps.musicLibrary, fileRef);
  const rowMedia = findLibraryRowForFile(maps.mediaLibrary, fileRef);
  return { rowMusic, rowMedia };
}

function resolveActiveLibraryRow(
  mediaCategory: MediaCategory,
  rowMusic: Record<string, unknown> | null,
  rowMedia: Record<string, unknown> | null,
): { row: Record<string, unknown>; kind: 'music' | 'media' } | null {
  if (mediaCategory === 'musics') {
    if (rowMusic) return { row: rowMusic, kind: 'music' };
    if (rowMedia) return { row: rowMedia, kind: 'media' };
    return null;
  }
  if (mediaCategory === 'medias') {
    if (rowMedia) return { row: rowMedia, kind: 'media' };
    if (rowMusic) return { row: rowMusic, kind: 'music' };
    return null;
  }
  if (rowMedia) return { row: rowMedia, kind: 'media' };
  if (rowMusic) return { row: rowMusic, kind: 'music' };
  return null;
}

function mergeMixLayers(base: MixData | undefined, fromLibrary: MixData | undefined): MixData | undefined {
  const merged = { ...(base ?? {}), ...(fromLibrary ?? {}) };
  return Object.keys(merged).length ? merged : undefined;
}

function applyLibraryRowToMusic(
  music: Music,
  ctx: BuildMusicFromDragContext,
  fileRef: { path: string; name: string },
): Music {
  if (ctx.directoryKind === 'manual') {
    music.manual_type = 1;
  }

  const { rowMusic, rowMedia } = pickLibraryRows(fileRef, ctx.libraryMaps);
  const resolved = resolveActiveLibraryRow(ctx.mediaCategory, rowMusic, rowMedia);

  if (!resolved) return music;

  const { row, kind } = resolved;
  const stem = fileStemFromPath(music.path ?? '', music.text ?? '');

  music.text = libraryRowDisplayTitle(row, stem, ctx.libraryMaps.musicFilters);

  const nid = libraryRowNumericId(row);
  if (nid !== undefined) music.id = nid;

  const cover = libraryRowCover(row);
  if (cover) music.cover = cover;

  const remote = libraryRowPathStorage(row);
  if (remote) music.path_storage = remote;

  const baseExtra: ExtraData =
    kind === 'music'
      ? buildMusicExtraFromLibraryRow(row, ctx.libraryMaps.musicFilters)
      : buildMediaExtraFromLibraryRow(row);

  const mixFromRow = normalizeMixDataFromUnknown(row.mix);
  const mergedMix = mergeMixLayers(baseExtra.mix, mixFromRow);

  const extra: ExtraData = { ...baseExtra };
  if (mergedMix && Object.keys(mergedMix).length) extra.mix = mergedMix;
  else delete extra.mix;

  music.extra = Object.keys(extra).length ? extra : undefined;

  const durSec = extractLibraryRowDurationSeconds(row);
  if (durSec != null && durSec > 0) {
    music.duration = durSec;
    const curMix = music.extra?.mix;
    if (curMix?.duration_real == null && curMix?.duration_total == null) {
      music.extra = {
        ...(music.extra ?? {}),
        mix: { ...(curMix ?? {}), duration_real: durSec * 1000 },
      };
    }
  }

  const ptRaw = row.playlist_type ?? row.playlistType;
  if (kind === 'music') {
    music.type =
      ptRaw != null && String(ptRaw).trim() !== ''
        ? mapPlaylistTypeToMusicItemType(ptRaw, row.vem)
        : 'music';
  } else {
    music.type = mapPlaylistTypeToMusicItemType(ptRaw, row.vem);
  }

  return music;
}

/**
 * Monta um item de playlist a partir do drag (acervo/comando).
 * Para `MEDIA`, mescla `music_library.json` / `media_library.json` como no player Electron.
 */
export function buildMusicFromDrag(d: DragItemData, ctx: BuildMusicFromDragContext): Music {
  if (d.type === 'COMMAND') {
    return {
      text: String(d.metadata?.title ?? d.sourceId),
      type: 'command',
      path: typeof d.metadata?.path === 'string' ? d.metadata.path : '',
    };
  }

  const path = String(d.metadata?.path ?? d.sourceId);
  const titleFromDrag = String(d.metadata?.title ?? path);
  const fromMeta =
    typeof d.metadata?.mediaType === 'string' ? d.metadata.mediaType.trim() : '';
  const fallbackType =
    fromMeta ||
    (ctx.mediaCategory === 'musics' ? 'music' :
      ctx.mediaCategory === 'medias' ? 'media' :
        'media');

  const baseName = path.split(/[/\\]/).pop() ?? titleFromDrag;
  const metaName =
    typeof d.metadata?.fileName === 'string' && d.metadata.fileName.trim().length > 0
      ? d.metadata.fileName.trim()
      : baseName;
  const fileRef = { path, name: metaName };

  const music: Music = {
    text: titleFromDrag,
    path,
    type: fallbackType,
  };

  return applyLibraryRowToMusic(music, ctx, fileRef);
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MixConfig, Music, SyncPlayData } from "../types";
import { getAppSetting } from "../settings/settingsStorage";

interface PlaylistBlockWindow {
  before: number;
  after: number;
}

interface PlaylistTailExpansion {
  extraAfterBlocks: number;
  showAllUntilEnd: boolean;
}

interface VisiblePlaylistGroup {
  plKey: string;
  pl: SyncPlayData['playlists'][string];
  blocks: Array<[string, SyncPlayData['playlists'][string]['blocks'][string]]>;
}

interface VisiblePlaylistSlice {
  groups: VisiblePlaylistGroup[];
  hasMoreTail: boolean;
}

interface UsePlaylistDataOptions {
  anchorMusicId: string | null;
}

const DEFAULT_PLAYLIST_BLOCK_WINDOW: PlaylistBlockWindow = { before: 2, after: 2 };
export const SECONDS_PER_DAY = 24 * 60 * 60;

async function fetchConfigSafe<T>(filename: string): Promise<T | null> {
  try {
    const data: string = await invoke("read_config", { filename });
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function formatPlaylistDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayPlaylistDate() {
  return formatPlaylistDate(new Date());
}

function addDaysToPlaylistDate(dateString: string, days: number) {
  const [year, month, day] = dateString.split('-').map(Number);
  return formatPlaylistDate(new Date(year, month - 1, day + days));
}

function parsePositiveIntSetting(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === 'string') {
    const n = parseInt(value.trim(), 10);
    if (!Number.isNaN(n)) return Math.max(0, n);
  }
  return fallback;
}

function numericStart(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function orderedPlaylistEntries(data: SyncPlayData) {
  return Object.entries(data.playlists).sort(([, a], [, b]) => numericStart(a.start) - numericStart(b.start));
}

function orderedBlockEntries(blocks: SyncPlayData['playlists'][string]['blocks']) {
  return Object.entries(blocks).sort(([, a], [, b]) => numericStart(a.start) - numericStart(b.start));
}

function offsetPlaylistSecond(value: number | undefined, offset: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value + offset : value;
}

function offsetPlaylistMusicStarts(record: Record<string, Music> | undefined, offset: number) {
  if (!record) return record;

  return Object.fromEntries(
    Object.entries(record).map(([musicKey, music]) => [
      musicKey,
      { ...music, start: offsetPlaylistSecond(music.start, offset) },
    ])
  );
}

function offsetPlaylistDay(data: SyncPlayData, offset: number): SyncPlayData {
  return {
    playlists: Object.fromEntries(
      Object.entries(data.playlists).map(([plKey, playlist]) => [
        plKey,
        {
          ...playlist,
          start: offsetPlaylistSecond(playlist.start, offset),
          blocks: Object.fromEntries(
            Object.entries(playlist.blocks).map(([blockKey, block]) => [
              blockKey,
              {
                ...block,
                start: offsetPlaylistSecond(block.start, offset),
                musics: offsetPlaylistMusicStarts(block.musics, offset),
                commercials: offsetPlaylistMusicStarts(block.commercials, offset),
              },
            ])
          ),
        },
      ])
    ),
  };
}

function nextPlaylistDayOffset(data: SyncPlayData) {
  const starts = orderedPlaylistEntries(data).flatMap(([, playlist]) => [
    playlist.start,
    ...orderedBlockEntries(playlist.blocks).map(([, block]) => block.start),
  ]);
  const maxStart = starts.reduce<number>(
    (max, start) => typeof start === 'number' && Number.isFinite(start) ? Math.max(max, start) : max,
    0
  );

  return Math.ceil((maxStart + 1) / SECONDS_PER_DAY) * SECONDS_PER_DAY;
}

function uniquePlaylistKey(existing: SyncPlayData['playlists'], baseKey: string) {
  if (!(baseKey in existing)) return baseKey;

  let suffix = 2;
  let candidate = `${baseKey}-${suffix}`;
  while (candidate in existing) {
    suffix += 1;
    candidate = `${baseKey}-${suffix}`;
  }

  return candidate;
}

function appendPlaylistDay(current: SyncPlayData, incoming: SyncPlayData, date: string): SyncPlayData {
  const offsetIncoming = offsetPlaylistDay(incoming, nextPlaylistDayOffset(current));
  const playlists = { ...current.playlists };

  for (const [plKey, playlist] of Object.entries(offsetIncoming.playlists)) {
    playlists[uniquePlaylistKey(playlists, `${date}-${plKey}`)] = playlist;
  }

  return { ...current, playlists };
}

function buildVisiblePlaylistSlice(
  data: SyncPlayData,
  anchorMusicId: string | null,
  windowSize: PlaylistBlockWindow,
  tailExpansion: PlaylistTailExpansion
): VisiblePlaylistSlice {
  const orderedBlocks = orderedPlaylistEntries(data).flatMap(([plKey, pl]) =>
    orderedBlockEntries(pl.blocks).map(([blockKey, block]) => ({
      plKey,
      pl,
      blockKey,
      block,
    }))
  );

  if (orderedBlocks.length === 0) return { groups: [], hasMoreTail: false };

  const anchorIndex = anchorMusicId
    ? orderedBlocks.findIndex(({ plKey, blockKey }) => anchorMusicId.startsWith(`${plKey}-${blockKey}-`))
    : -1;
  const baseIndex = anchorIndex >= 0 ? anchorIndex : 0;
  const firstVisibleIndex = Math.max(0, baseIndex - windowSize.before);
  const defaultLastExclusive = Math.min(
    orderedBlocks.length,
    baseIndex + windowSize.after + 1
  );
  const lastVisibleIndex = tailExpansion.showAllUntilEnd
    ? orderedBlocks.length
    : Math.min(
      orderedBlocks.length,
      defaultLastExclusive + tailExpansion.extraAfterBlocks
    );

  const hasMoreTail = lastVisibleIndex < orderedBlocks.length;
  const visibleGroups: VisiblePlaylistGroup[] = [];

  for (const { plKey, pl, blockKey, block } of orderedBlocks.slice(firstVisibleIndex, lastVisibleIndex)) {
    const currentGroup = visibleGroups[visibleGroups.length - 1];
    if (currentGroup?.plKey === plKey) {
      currentGroup.blocks.push([blockKey, block]);
    } else {
      visibleGroups.push({ plKey, pl, blocks: [[blockKey, block]] });
    }
  }

  return { groups: visibleGroups, hasMoreTail };
}

export function usePlaylistData({ anchorMusicId }: UsePlaylistDataOptions) {
  const [data, setData] = useState<SyncPlayData | null>(null);
  const [mixConfig, setMixConfig] = useState<MixConfig | null>(null);
  const [playlistDate, setPlaylistDate] = useState(() => todayPlaylistDate());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [playlistBlockWindow, setPlaylistBlockWindow] = useState<PlaylistBlockWindow>(
    DEFAULT_PLAYLIST_BLOCK_WINDOW
  );
  const [playlistExtraAfterBlocks, setPlaylistExtraAfterBlocks] = useState(0);
  const [playlistShowAllTail, setPlaylistShowAllTail] = useState(false);
  const [playlistAppendingDay, setPlaylistAppendingDay] = useState(false);
  const [playlistAppendError, setPlaylistAppendError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [loadRaw, keepRaw] = await Promise.all([
          getAppSetting('loadBlocks'),
          getAppSetting('keepBlocks'),
        ]);
        if (cancelled) return;
        setPlaylistBlockWindow({
          before: parsePositiveIntSetting(keepRaw, DEFAULT_PLAYLIST_BLOCK_WINDOW.before),
          after: parsePositiveIntSetting(loadRaw, DEFAULT_PLAYLIST_BLOCK_WINDOW.after),
        });
      } catch {
        /* mantém DEFAULT_PLAYLIST_BLOCK_WINDOW */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const playlistTailExpansion = useMemo<PlaylistTailExpansion>(
    () => ({
      extraAfterBlocks: playlistExtraAfterBlocks,
      showAllUntilEnd: playlistShowAllTail,
    }),
    [playlistExtraAfterBlocks, playlistShowAllTail]
  );

  const { groups: visiblePlaylistGroups, hasMoreTail: playlistHasMoreTail } = useMemo(
    () =>
      data
        ? buildVisiblePlaylistSlice(
          data,
          anchorMusicId,
          playlistBlockWindow,
          playlistTailExpansion
        )
        : { groups: [] as VisiblePlaylistGroup[], hasMoreTail: false },
    [data, anchorMusicId, playlistBlockWindow, playlistTailExpansion]
  );

  const fetchPlaylist = useCallback(async (date: string, showAllTail = false) => {
    setLoading(true);
    setError("");
    setPlaylistAppendError("");
    try {
      const [jsonStr, cfg] = await Promise.all([
        invoke<string>("read_playlist", { date }),
        fetchConfigSafe<MixConfig>('Configs/mix.json'),
      ]);
      setMixConfig(cfg);
      setPlaylistDate(date);
      setPlaylistExtraAfterBlocks(0);
      setPlaylistShowAllTail(showAllTail);
      setData(JSON.parse(jsonStr));
    } catch (err) {
      setPlaylistExtraAfterBlocks(0);
      setPlaylistShowAllTail(false);
      setError(`Erro ao carregar a playlist: ${err}`);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const appendNextPlaylistDay = useCallback(async (showAllTail = false) => {
    if (playlistAppendingDay) return;

    const nextDate = addDaysToPlaylistDate(playlistDate, 1);
    setPlaylistAppendingDay(true);
    setPlaylistAppendError("");
    try {
      const [jsonStr, cfg] = await Promise.all([
        invoke<string>("read_playlist", { date: nextDate }),
        fetchConfigSafe<MixConfig>('Configs/mix.json'),
      ]);
      const nextData = JSON.parse(jsonStr) as SyncPlayData;
      setMixConfig(cfg);
      setPlaylistDate(nextDate);
      setData((prev) => prev ? appendPlaylistDay(prev, nextData, nextDate) : nextData);
      if (showAllTail) {
        setPlaylistShowAllTail(true);
      } else {
        setPlaylistExtraAfterBlocks((n) => n + 1);
      }
    } catch (err) {
      setPlaylistAppendError(`Erro ao carregar a playlist: ${err}`);
    } finally {
      setPlaylistAppendingDay(false);
    }
  }, [playlistAppendingDay, playlistDate]);

  const loadNextPlaylistBlock = useCallback(() => {
    if (playlistHasMoreTail) {
      setPlaylistExtraAfterBlocks((n) => n + 1);
      return;
    }

    void appendNextPlaylistDay(false);
  }, [appendNextPlaylistDay, playlistHasMoreTail]);

  const loadAllPlaylistBlocksUntilEnd = useCallback(() => {
    if (playlistHasMoreTail) {
      setPlaylistShowAllTail(true);
      return;
    }

    void appendNextPlaylistDay(true);
  }, [appendNextPlaylistDay, playlistHasMoreTail]);

  useEffect(() => {
    void fetchPlaylist(todayPlaylistDate());
  }, [fetchPlaylist]);

  return {
    data,
    setData,
    mixConfig,
    error,
    loading,
    visiblePlaylistGroups,
    playlistHasMoreTail,
    playlistAppendingDay,
    playlistAppendError,
    loadNextPlaylistBlock,
    loadAllPlaylistBlocksUntilEnd,
  };
}

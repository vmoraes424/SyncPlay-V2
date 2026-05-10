import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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

/** Extrai texto útil do erro devolvido pelo invoke do Tauri. */
function formatInvokeError(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return String(err);
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

function comparePlaylistDates(a: string, b: string) {
  return a.localeCompare(b);
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

function countBlocksAfterAnchor(data: SyncPlayData, anchorMusicId: string | null) {
  if (!anchorMusicId) return null;

  const orderedBlocks = orderedPlaylistEntries(data).flatMap(([plKey, pl]) =>
    orderedBlockEntries(pl.blocks).map(([blockKey]) => ({ plKey, blockKey }))
  );
  const anchorIndex = orderedBlocks.findIndex(({ plKey, blockKey }) =>
    anchorMusicId.startsWith(`${plKey}-${blockKey}-`)
  );

  return anchorIndex >= 0 ? orderedBlocks.length - anchorIndex - 1 : null;
}

export function usePlaylistData({ anchorMusicId }: UsePlaylistDataOptions) {
  const [data, setData] = useState<SyncPlayData | null>(null);
  const [mixConfig, setMixConfig] = useState<MixConfig | null>(null);
  const [playlistBaseDate, setPlaylistBaseDate] = useState(() => todayPlaylistDate());
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
  const appendInFlightRef = useRef(false);
  const lastAutoAppendDateRef = useRef<string | null>(null);

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
      setPlaylistBaseDate(date);
      setPlaylistDate(date);
      setPlaylistExtraAfterBlocks(0);
      setPlaylistShowAllTail(showAllTail);
      setData(JSON.parse(jsonStr));
    } catch (err) {
      setPlaylistExtraAfterBlocks(0);
      setPlaylistShowAllTail(false);
      setError(formatInvokeError(err));
      setData(null);
      void invoke("watch_playlist_file", { date }).catch(() => {});
    } finally {
      setLoading(false);
    }
  }, []);

  const appendNextPlaylistDay = useCallback(async (
    showAllTail = false,
    expandTail = true,
    source: 'manual-next' | 'manual-all' | 'auto-tail' = 'manual-next'
  ) => {
    if (appendInFlightRef.current) return false;

    const nextDate = addDaysToPlaylistDate(playlistDate, 1);
    const maxAutoAppendDate = addDaysToPlaylistDate(todayPlaylistDate(), 1);
    if (source === 'auto-tail' && comparePlaylistDates(nextDate, maxAutoAppendDate) > 0) {
      return false;
    }

    appendInFlightRef.current = true;
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
      } else if (expandTail) {
        setPlaylistExtraAfterBlocks((n) => n + 1);
      }
      return true;
    } catch (err) {
      setPlaylistAppendError(formatInvokeError(err));
      void invoke("watch_playlist_file", { date: nextDate }).catch(() => {});
      return false;
    } finally {
      appendInFlightRef.current = false;
      setPlaylistAppendingDay(false);
    }
  }, [playlistDate]);

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

    void appendNextPlaylistDay(true, true, 'manual-all');
  }, [appendNextPlaylistDay, playlistHasMoreTail]);

  useEffect(() => {
    if (!data || loading || playlistAppendingDay || playlistHasMoreTail) return;

    const remainingAfterAnchor = countBlocksAfterAnchor(data, anchorMusicId);
    if (
      remainingAfterAnchor === null ||
      remainingAfterAnchor >= playlistBlockWindow.after ||
      lastAutoAppendDateRef.current === playlistDate
    ) {
      return;
    }

    lastAutoAppendDateRef.current = playlistDate;
    void appendNextPlaylistDay(false, false, 'auto-tail');
  }, [
    anchorMusicId,
    appendNextPlaylistDay,
    data,
    loading,
    playlistAppendingDay,
    playlistBlockWindow.after,
    playlistDate,
    playlistHasMoreTail,
  ]);

  useEffect(() => {
    void fetchPlaylist(todayPlaylistDate());
  }, [fetchPlaylist]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen<{ date: string }>("playlist-file-available", (event) => {
      const d = event.payload.date;
      if (typeof d === "string" && d.length > 0) {
        void fetchPlaylist(d);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      void invoke("stop_playlist_watch").catch(() => {});
      unlisten?.();
    };
  }, [fetchPlaylist]);

  return {
    data,
    setData,
    mixConfig,
    playlistBaseDate,
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

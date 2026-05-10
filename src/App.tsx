import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import "./App.css";
import type {
  MediaCategory, DirectoryOptionKind, DirectoryOption,
  DirFile, Music, SyncPlayData,
  PlayableItem, ScheduledBlockDto, ScheduleMediaDiscardDto, ScheduleMediaStartDto, ScheduleSelectionDto,
  MixConfig, AutoMixSettings,
} from './types';
import { BlockHeader } from './components/BlockHeader';
import { PlaylistMusicItem } from './components/PlaylistMusicItem';
import { MusicInfo } from './components/playlist/MusicInfo';
import { PlaylistCurrentBlock } from './components/playlist/PlaylistCurrentBlock';
import { PlaylistLoadMoreControls } from './components/playlist/PlaylistLoadMoreControls';
import { PlaylistPlaybackBar } from './components/playlist/PlaylistPlaybackBar';
import { SettingsDock } from './components/settings/SettingsDock';
import { MixerPanel } from './components/Mixer';
import { SECONDS_PER_DAY, usePlaylistData } from './hooks/usePlaylistData';
import { useSyncplayLibrary } from './hooks/useSyncplayLibrary';
import { formatSecondsOfDay, formatTime } from './time';
import { SyncplayLibraryProvider } from './library/SyncplayLibraryContext';
import { useAutoMixDetection, parseAutoMixSettings } from './hooks/useAutoMixDetection';
import { useColumnResize } from './hooks/useColumnResize';

async function fetchConfigSafe<T>(filename: string): Promise<T | null> {
  try {
    const data: string = await invoke("read_config", { filename });
    return JSON.parse(data);
  } catch {
    return null;
  }
}


/**
 * Remove uma mídia do bloco (mesma convenção que `blockMediaRecord`: prioriza `commercials` se não vazio).
 */
function removeMusicFromBlock(
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

function numericStart(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function orderedPlaylistEntries(data: SyncPlayData) {
  return Object.entries(data.playlists).sort(([, a], [, b]) => numericStart(a.start) - numericStart(b.start));
}

function orderedBlockEntries(blocks: SyncPlayData['playlists'][string]['blocks']) {
  return Object.entries(blocks).sort(([, a], [, b]) => numericStart(a.start) - numericStart(b.start));
}

function blockMediaKind(block: SyncPlayData['playlists'][string]['blocks'][string]): 'musics' | 'commercials' {
  const commercials = block.commercials;
  if (block.type === 'commercial' || (commercials && Object.keys(commercials).length > 0)) {
    return 'commercials';
  }
  return 'musics';
}

/** Músicas ficam em `musics`; comerciais na playlist oficial vêm em `commercials`. */
function blockMediaRecord(block: SyncPlayData['playlists'][string]['blocks'][string]): Record<string, Music> {
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

/** Remove todas as mídias do bloco (`musics` ou `commercials`, conforme `blockMediaKind`). */
function clearBlockMedia(
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

/** Data do arquivo agregado (prefixo `AAAA-MM-DD-` quando vem de dia extra carregado). */
function isoDateHintFromPlaylistKey(plKey: string, fallbackIso: string) {
  return /^(\d{4}-\d{2}-\d{2})-/.exec(plKey)?.[1] ?? fallbackIso;
}

function formatBrazilianPlaylistDate(iso: string) {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const [yStr, moStr, dStr] = parts;
  const y = Number(yStr);
  const m = Number(moStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

function musicForPlaylistItemId(data: SyncPlayData | null, uniqueId: string | null): Music | null {
  if (!data || !uniqueId) return null;
  for (const [plKey, pl] of orderedPlaylistEntries(data)) {
    for (const [blockKey, block] of orderedBlockEntries(pl.blocks)) {
      const mediaMap = blockMediaRecord(block);
      for (const [musicKey, music] of Object.entries(mediaMap)) {
        if (`${plKey}-${blockKey}-${musicKey}` === uniqueId) return music;
      }
    }
  }
  return null;
}

function blockAndProgramForPlaylistItemId(
  data: SyncPlayData | null,
  uniqueId: string | null
): {
  block: SyncPlayData['playlists'][string]['blocks'][string];
  programName: string;
} | null {
  if (!data || !uniqueId) return null;
  for (const [plKey, pl] of orderedPlaylistEntries(data)) {
    for (const [blockKey, block] of orderedBlockEntries(pl.blocks)) {
      const mediaMap = blockMediaRecord(block);
      for (const [musicKey] of Object.entries(mediaMap)) {
        if (`${plKey}-${blockKey}-${musicKey}` === uniqueId) {
          const programName = (pl.program ?? '').trim() || plKey;
          return { block, programName };
        }
      }
    }
  }
  return null;
}

function legacyBool(value: unknown) {
  return value === true || value === 1 || value === '1';
}

function mediaDurationMs(music: Music) {
  if (music.extra?.mix?.duration_real) return music.extra.mix.duration_real;
  if (music.extra?.mix?.duration_total) return music.extra.mix.duration_total;
  return typeof music.duration === 'number' && Number.isFinite(music.duration)
    ? music.duration * 1000
    : null;
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

function mediaMixOutMs(music: Music) {
  return music.extra?.mix?.mix_total_milesecond ?? null;
}

function rawStartSec(music: Music) {
  return typeof music.start === 'number' && Number.isFinite(music.start)
    ? Math.floor(music.start)
    : null;
}

function buildPlaylistRuntimeItems(data: SyncPlayData, mixConfig: MixConfig | null) {
  const playableItems: PlayableItem[] = [];
  const scheduledBlocks: ScheduledBlockDto[] = [];

  orderedPlaylistEntries(data).forEach(([plKey, pl]) =>
    orderedBlockEntries(pl.blocks).forEach(([blockKey, block]) => {
      const mediaMap = blockMediaRecord(block);
      if (Object.keys(mediaMap).length === 0) return;

      const medias = Object.entries(mediaMap).map(([musicKey, music]) => {
        const uniqueId = `${plKey}-${blockKey}-${musicKey}`;
        const duration_ms = mediaDurationMs(music);
        const fade_duration_ms = mediaMixOutMs(music);
        const playPath = music.path?.trim() || music.path_storage?.trim() || '';

        const mediaType = (music.type ?? '').toLowerCase().trim();
        const fade_out_time_ms =
          mediaType === 'music' ? (mixConfig?.music_fade_out_time ?? 0) :
            mediaType === 'vem' ? 0 :
              (mixConfig?.media_fade_out_time ?? 0);

        // Manual: música=3 s, mídia=1,5 s, VEM=0 (sem fadeout)
        const manual_fade_out_ms =
          mediaType === 'music' ? 3000 :
            mediaType === 'vem' ? 0 :
              1500;

        if (playPath) {
          playableItems.push({
            id: uniqueId,
            media_id: music.id != null ? String(music.id) : null,
            path: playPath,
            mix_end_ms: music.extra?.mix?.mix_end ?? null,
            duration_ms,
            fade_duration_ms,
            fade_out_time_ms,
            manual_fade_out_ms,
            media_type: mediaType,
          });
        }

        const durationFallbackSec =
          typeof music.duration === 'number' && Number.isFinite(music.duration)
            ? music.duration
            : null;

        return {
          id: uniqueId,
          title: music.text || `Mídia: ${music.type ?? musicKey}`,
          mediaType: music.type ?? '',
          path: playPath,
          rawStartSec: rawStartSec(music),
          durationSec: duration_ms !== null ? duration_ms / 1000 : durationFallbackSec,
          mixOutSec: fade_duration_ms !== null ? fade_duration_ms / 1000 : null,
          disabled: legacyBool(music.disabled),
          discarded: legacyBool(music.discarded),
          manualDiscard: legacyBool(music.manualDiscard ?? music.manual_discard),
          fixed: legacyBool(music.extra?.fixed),
          manualType: legacyBool(music.manualType ?? music.manual_type),
          disableDiscard: legacyBool(music.disableDiscard ?? music.disable_discard),
        };
      });

      if (
        typeof block.start === 'number' && Number.isFinite(block.start) &&
        typeof block.duration === 'number' && Number.isFinite(block.duration)
      ) {
        scheduledBlocks.push({
          id: `${plKey}-${blockKey}`,
          startSec: Math.floor(block.start),
          sizeSec: Math.floor(block.size ?? block.duration),
          disableDiscard: legacyBool(block.disableDiscard ?? block.disable_discard),
          medias,
        });
      }
    })
  );

  return { playableItems, scheduledBlocks };
}

function getBlockDisplayStart(blockStart: number | undefined, musicEntries: Array<[string, Music]>) {
  if (typeof blockStart === 'number' && Number.isFinite(blockStart)) return blockStart;

  return musicEntries.find(([, music]) =>
    typeof music.start === 'number' && Number.isFinite(music.start)
  )?.[1].start;
}

function playlistDateMidnightMs(dateString: string) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

function currentPlaylistDayIndex(baseDate: string) {
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.floor((todayMidnight - playlistDateMidnightMs(baseDate)) / (SECONDS_PER_DAY * 1000));
  return Math.max(0, days);
}

function scheduledBlocksForPlaybackWindow(blocks: ScheduledBlockDto[], baseDate: string) {
  const dayIndex = currentPlaylistDayIndex(baseDate);
  const dayStart = dayIndex * SECONDS_PER_DAY;
  const dayEnd = dayStart + (SECONDS_PER_DAY * 2);

  return blocks.filter((block) => block.startSec >= dayStart && block.startSec < dayEnd);
}

function applyScheduleMediaDiscards(
  data: SyncPlayData,
  discards: ScheduleMediaDiscardDto[]
): SyncPlayData {
  if (discards.length === 0) return data;

  const discardById = new Map(discards.map((item) => [item.id, item.discarded]));
  let changed = false;

  const playlists = Object.fromEntries(
    Object.entries(data.playlists).map(([plKey, playlist]) => [
      plKey,
      {
        ...playlist,
        blocks: Object.fromEntries(
          Object.entries(playlist.blocks).map(([blockKey, block]) => {
            const updateRecord = (record: Record<string, Music> | undefined) => {
              if (!record) return record;

              let recordChanged = false;
              const nextRecord = Object.fromEntries(
                Object.entries(record).map(([musicKey, music]) => {
                  const uniqueId = `${plKey}-${blockKey}-${musicKey}`;
                  const nextDiscarded = discardById.get(uniqueId);
                  if (nextDiscarded === undefined || legacyBool(music.discarded) === nextDiscarded) {
                    return [musicKey, music];
                  }

                  recordChanged = true;
                  changed = true;
                  return [musicKey, { ...music, discarded: nextDiscarded }];
                })
              );

              return recordChanged ? nextRecord : record;
            };

            const musics = updateRecord(block.musics);
            const commercials = updateRecord(block.commercials);

            if (musics === block.musics && commercials === block.commercials) {
              return [blockKey, block];
            }

            return [blockKey, { ...block, musics, commercials }];
          })
        ),
      },
    ])
  );

  return changed ? { ...data, playlists } : data;
}

interface LibraryMediaListItemProps {
  file: DirFile;
  idx: number;
  isSelected: boolean;
  isCueing: boolean;
  isCuePlaying: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  onCue: (e: React.MouseEvent) => void;
}

function LibraryMediaListItem({
  file,
  idx,
  isSelected,
  isCueing,
  isCuePlaying,
  onSelect,
  onDoubleClick,
  onCue,
}: LibraryMediaListItemProps) {
  return (
    <div
      id={`midia-item-${idx}`}
      className={[
        "flex items-center gap-2.5 px-3 h-9 cursor-pointer border-b border-[#353535]/50 select-none transition-colors duration-150",
        isSelected ? "bg-white/8 border-l-2 border-l-[#525252]" : "hover:bg-white/5",
        isCueing ? "bg-violet-500/12 border-l-2 border-l-violet-400" : "",
      ].join(" ")}
      title={file.path}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
    >
      <button
        type="button"
        className={[
          "w-[26px] h-[26px] rounded-full flex items-center justify-center text-xs text-white/90 shrink-0 transition-all duration-200",
          isCuePlaying ? "bg-violet-700 animate-pulse-cue" : "bg-white/10 hover:bg-violet-400 hover:scale-110",
        ].join(" ")}
        title={isCuePlaying ? "Parar CUE" : "Preview CUE"}
        onClick={onCue}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {isCuePlaying ? "⏸" : "▶"}
      </button>
      <span className="flex-1 text-[0.82rem] text-white/90 whitespace-nowrap overflow-hidden text-ellipsis">{file.name.replace(/\.[^/.]+$/, "")}</span>
      <span className="text-[0.62rem] bg-white/10 text-slate-400 px-1.5 py-0.5 rounded font-semibold shrink-0">{file.name.split(".").pop()?.toUpperCase()}</span>
    </div>
  );
}

// --- App ---

function App() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [backgroundIds, setBackgroundIds] = useState<string[]>([]);
  const [backgroundPositions, setBackgroundPositions] = useState<Record<string, number>>({});
  const [backgroundDurations, setBackgroundDurations] = useState<Record<string, number>>({});
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scheduledMusicId, setScheduledMusicId] = useState<string | null>(null);
  const [trashHighlightPlaylistId, setTrashHighlightPlaylistId] = useState<string | null>(null);
  const [scheduleStarts, setScheduleStarts] = useState<Record<string, ScheduleMediaStartDto>>({});
  const [playlistBlockHideDisabled, setPlaylistBlockHideDisabled] = useState<Record<string, boolean>>({});
  const [playlistBlockExpanded, setPlaylistBlockExpanded] = useState<Record<string, boolean>>({});

  const {
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
  } = usePlaylistData({ anchorMusicId: playingId ?? scheduledMusicId });

  // Configurações de detecção automática de mix (lidas de configs.json).
  // Armazenadas como campos primitivos separados para estabilidade de referência
  // (evitar que o objeto parseado novo a cada fetch dispare re-renders extras).
  const [autoMixEnabled, setAutoMixEnabled] = useState(false);
  const [autoMixMediaEnabled, setAutoMixMediaEnabled] = useState(false);
  const [musicMixSensitivity, setMusicMixSensitivity] = useState(25);
  const [mediaMixSensitivity, setMediaMixSensitivity] = useState(20);
  const [mixTypeAdvanced, setMixTypeAdvanced] = useState(false);

  useEffect(() => {
    fetchConfigSafe<Record<string, unknown>>('Configs/configs.json').then((cfg) => {
      if (cfg) {
        const parsed = parseAutoMixSettings(cfg);
        setAutoMixEnabled(parsed.automaticMix);
        setAutoMixMediaEnabled(parsed.automaticMixMedia);
        setMusicMixSensitivity(parsed.musicMixSensitivity);
        setMediaMixSensitivity(parsed.mediaMixSensitivity);
        setMixTypeAdvanced(parsed.mixType === 'advanced');
      }
    });
  }, []);

  // Objeto estável: só recria quando os valores primitivos mudam de fato
  const autoMixSettings = useMemo<AutoMixSettings | null>(
    () => (autoMixEnabled || autoMixMediaEnabled ? {
      automaticMix: autoMixEnabled,
      automaticMixMedia: autoMixMediaEnabled,
      musicMixSensitivity,
      mediaMixSensitivity,
      mixType: mixTypeAdvanced ? 'advanced' : 'basic',
    } : null),
    [autoMixEnabled, autoMixMediaEnabled, musicMixSensitivity, mediaMixSensitivity, mixTypeAdvanced]
  );

  useEffect(() => {
    if (playingId == null) return;
    setTrashHighlightPlaylistId((prev) => (prev === playingId ? null : prev));
  }, [playingId]);

  const playableItemsRef = useRef<PlayableItem[]>([]);
  const scheduleTimerRef = useRef<number | null>(null);
  const scheduleScrollKeyRef = useRef<string | null>(null);
  const discardAnchorRef = useRef<string | null>(null);
  const lastPlaybackDiscardAnchorRef = useRef<string | null>(null);
  const playlistItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const autoMixScannedIdsRef = useRef<Set<string>>(new Set());
  const [autoMixScanItems, setAutoMixScanItems] = useState<PlayableItem[]>([]);

  // Catálogo completo de itens tocáveis (base para mapear a janela visível).
  const allPlayableItems = useMemo(
    () => (data ? buildPlaylistRuntimeItems(data, mixConfig).playableItems : []),
    [data, mixConfig]
  );

  // IDs realmente visíveis na playlist cortada da UI.
  const visiblePlayableItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const { plKey, blocks } of visiblePlaylistGroups) {
      for (const [blockKey, block] of blocks) {
        const mediaMap = blockMediaRecord(block);
        for (const musicKey of Object.keys(mediaMap)) {
          ids.add(`${plKey}-${blockKey}-${musicKey}`);
        }
      }
    }
    return ids;
  }, [visiblePlaylistGroups]);

  // Itens visíveis no momento (somente bloco(s) carregados na UI).
  const visiblePlayableItems = useMemo(
    () => allPlayableItems.filter((item) => visiblePlayableItemIds.has(item.id)),
    [allPlayableItems, visiblePlayableItemIds]
  );

  // Modo incremental: detecta apenas os itens recém-visíveis (ex.: ao clicar
  // em "Carregar o próximo bloco"), evitando revarredura pesada contínua.
  useEffect(() => {
    if (!autoMixSettings) {
      autoMixScannedIdsRef.current.clear();
      setAutoMixScanItems([]);
      return;
    }

    const visibleIds = new Set(visiblePlayableItems.map((item) => item.id));
    for (const scannedId of autoMixScannedIdsRef.current) {
      if (!visibleIds.has(scannedId)) autoMixScannedIdsRef.current.delete(scannedId);
    }

    const newVisibleItems = visiblePlayableItems.filter(
      (item) => !autoMixScannedIdsRef.current.has(item.id)
    );
    if (newVisibleItems.length === 0) {
      setAutoMixScanItems([]);
      return;
    }

    newVisibleItems.forEach((item) => autoMixScannedIdsRef.current.add(item.id));
    setAutoMixScanItems(newVisibleItems);
  }, [autoMixSettings, visiblePlayableItems]);

  // Detecção automática de ponto de mix por sensibilidade (somente itens novos/visíveis).
  const autoMixOverrides = useAutoMixDetection(autoMixScanItems, autoMixSettings);

  // Aplica overrides de mix_end_ms calculados automaticamente sobre uma fila de itens
  const applyMixOverrides = useCallback(
    (items: PlayableItem[]): PlayableItem[] => {
      if (Object.keys(autoMixOverrides).length === 0) return items;
      return items.map((item) =>
        item.id in autoMixOverrides
          ? { ...item, mix_end_ms: autoMixOverrides[item.id] }
          : item
      );
    },
    [autoMixOverrides]
  );

  // Quando novos overrides chegam, atualiza a fila no motor de áudio.
  // Usa ref para applyMixOverrides para evitar que a mudança do callback
  // (que co-varia com autoMixOverrides) dispare o effect duas vezes.
  const applyMixOverridesRef = useRef(applyMixOverrides);
  applyMixOverridesRef.current = applyMixOverrides;

  useEffect(() => {
    if (Object.keys(autoMixOverrides).length === 0) return;
    const current = playableItemsRef.current;
    if (current.length === 0) return;
    const updated = applyMixOverridesRef.current(current);
    void invoke('set_queue', { items: updated });
  }, [autoMixOverrides]);

  // Colunas redimensionáveis
  const {
    headerRef,
    col1Style,
    col2Style,
    handleW,
    isRetrieveMode,
    onHandleMouseDown,
  } = useColumnResize();

  // Coluna Direita (Selects & Files)
  const [mediaCategory, setMediaCategory] = useState<MediaCategory>('unset');
  const [directoryOptions, setDirectoryOptions] = useState<DirectoryOption[]>([]);
  const [directoryValue, setDirectoryValue] = useState<string>('');
  const [directoryKind, setDirectoryKind] = useState<DirectoryOptionKind>('sync');

  const [dirFiles, setDirFiles] = useState<DirFile[]>([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirError, setDirError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const {
    libraryMaps,
    filteredFiles,
    libMusicFilterIds,
    setLibMusicFilterIds,
    resetLibMusicFilters,
    playlistFilterVis,
    libraryYearDecade,
    showNameMusicFiles,
    showNameCommercialFiles,
    showNameMediaFiles,
    applyPlaylistFilterClick,
    musicCategoryMap,
    musicStyleMap,
    musicRhythmMap,
    musicNationalityMap,
  } = useSyncplayLibrary({
    dirFiles,
    searchQuery,
    mediaCategory,
    directoryValue,
    directoryKind,
    setMediaCategory,
    setDirectoryValue,
    setSearchQuery,
  });

  // CUE Player
  const [cueFile, setCueFile] = useState<string | null>(null);
  const [cuePlaying, setCuePlaying] = useState(false);
  const [cueTime, setCueTime] = useState(0);
  const [cueDuration, setCueDuration] = useState(0);

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: filteredFiles.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  const playlistCurrentBlockLine = useMemo(() => {
    const anchor = playingId ?? scheduledMusicId;
    const resolved = blockAndProgramForPlaylistItemId(data, anchor);
    if (!resolved)
      return {
        predictedTimeLabel: null as string | null,
        programName: null as string | null,
        blockType: null as string | null,
      };
    const { block, programName } = resolved;
    const musicEntries = Object.entries(blockMediaRecord(block));
    const displayStart = getBlockDisplayStart(block.start, musicEntries);
    const predictedTimeLabel =
      typeof displayStart === 'number' && Number.isFinite(displayStart)
        ? formatSecondsOfDay(displayStart, true)
        : null;
    return { predictedTimeLabel, programName, blockType: block.type ?? null };
  }, [data, playingId, scheduledMusicId]);

  const nowPlayingMusic = useMemo(
    () => musicForPlaylistItemId(data, playingId),
    [data, playingId]
  );

  const loadDirectories = useCallback(async (paths: string[]) => {
    setDirLoading(true);
    setDirError("");
    setDirFiles([]);
    try {
      const validPaths = paths.map(p => p.trim()).filter(Boolean);
      if (validPaths.length === 0) {
        setDirLoading(false);
        return;
      }
      const files: DirFile[] = await invoke("list_directories", { dirPaths: validPaths });
      setDirFiles(files);
    } catch (e: any) {
      setDirError(String(e));
    } finally {
      setDirLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const loadOptions = async () => {
      if (mediaCategory === 'unset') {
        setDirectoryOptions([]);
        setDirectoryValue('');
        setDirectoryKind('sync');
        return;
      }

      const options: DirectoryOption[] = [];

      try {
        const dirConfig = await fetchConfigSafe<Record<string, boolean>>('Configs/directoriesConfig.json') || {};
        const dirs = await fetchConfigSafe<Record<string, string>>('Configs/directories.json') || {};
        const manualRaw = await fetchConfigSafe<any>('Configs/directoriesManualConfig.json') || [];
        const manualDirs = Array.isArray(manualRaw) ? manualRaw : Object.values(manualRaw);

        let collections: Record<string, string> = {};
        if (mediaCategory === 'musics') {
          const filters = await fetchConfigSafe<any>('Library/music_filters.json') || {};
          collections = filters?.collections || {};
        } else if (mediaCategory === 'medias') {
          const filters = await fetchConfigSafe<any>('Library/media_filters.json') || {};
          collections = filters?.collections || {};
        }

        for (const [key, path] of Object.entries(dirs)) {
          let label = key.replace(/\/$/, '').replace('/', ' - ');
          if (dirConfig[label] === false) continue;
          const isMusic = label.startsWith("Músicas");
          const isMedia = label.startsWith("Mídias");
          if (mediaCategory === 'musics' && isMusic) options.push({ value: path, label, kind: 'sync' });
          else if (mediaCategory === 'medias' && isMedia) options.push({ value: path, label, kind: 'sync' });
          else if (mediaCategory === 'others' && !isMusic && !isMedia) options.push({ value: path, label, kind: 'sync' });
        }

        for (const item of manualDirs) {
          if (!item.enabled) continue;
          let labelPrefix = '';
          if (mediaCategory === 'musics' && item.type === 'music') labelPrefix = 'Músicas - ';
          else if (mediaCategory === 'medias' && item.type === 'media') labelPrefix = 'Mídias - ';
          else if (mediaCategory === 'others' && item.type === 'commercial') labelPrefix = 'Comerciais - ';
          else continue;
          options.push({ value: item.path, label: labelPrefix + item.name, kind: 'manual' });
        }

        if (mediaCategory === 'musics' || mediaCategory === 'medias') {
          for (const [id, name] of Object.entries(collections)) {
            options.push({ value: id, label: `Coleção - ${name}`, kind: 'collection' });
          }
        }

        if (mediaCategory === 'others') {
          options.push({ value: '#st', label: 'Comandos - STREAMING IN', kind: 'streaming' });
        }

        options.sort((a, b) => {
          const getGroupPriority = (label: string) => {
            if (label.startsWith("Músicas")) return 1;
            if (label.startsWith("Mídias")) return 2;
            if (label.startsWith("Playlist")) return 3;
            if (label.startsWith("Comando") || label.startsWith("Comerciais")) return 4;
            return 5;
          };
          const pA = getGroupPriority(a.label);
          const pB = getGroupPriority(b.label);
          if (pA !== pB) return pA - pB;
          return a.label.localeCompare(b.label);
        });
      } catch (e) {
        console.error(e);
      }

      if (!active) return;

      const finalOptions: DirectoryOption[] = [];
      let sentinelValue = "0";

      if (mediaCategory === 'musics' || mediaCategory === 'medias') {
        finalOptions.push({ value: sentinelValue, label: 'Acervo', kind: 'sync' });
      } else if (mediaCategory === 'others') {
        sentinelValue = "-1";
        finalOptions.push({ value: sentinelValue, label: 'Selecione', kind: 'sync' });
      }

      finalOptions.push(...options);
      setDirectoryOptions(finalOptions);

      setDirectoryValue(prev => {
        const exists = finalOptions.find(o => o.value === prev);
        if (exists) {
          setDirectoryKind(exists.kind);
          return prev;
        }
        setDirectoryKind(finalOptions[0].kind);
        return sentinelValue;
      });
    };

    loadOptions();

    return () => { active = false; };
  }, [mediaCategory]);

  useEffect(() => {
    if (mediaCategory === 'unset' || directoryValue === "-1" || !directoryValue) {
      setDirFiles([]);
      return;
    }

    if (directoryValue === "#st") {
      setDirFiles([]);
      return;
    }

    if (directoryValue === "0" || directoryKind === 'collection') {
      const paths = directoryOptions
        .filter(o => o.kind === 'sync' || o.kind === 'manual')
        .map(o => o.value)
        .filter(v => v !== "0" && v !== "-1" && v !== "#st");

      loadDirectories(paths);
      return;
    }

    if (directoryKind === 'sync' || directoryKind === 'manual') {
      loadDirectories([directoryValue]);
    } else {
      setDirFiles([]);
    }
  }, [directoryValue, directoryKind, mediaCategory, loadDirectories, directoryOptions]);

  const toggleCue = useCallback(async (file: DirFile) => {
    const cueId = `cue-player`;

    if (cueFile === file.path && cuePlaying) {
      await invoke("stop_independent", { id: cueId });
      setCuePlaying(false);
    } else {
      if (cuePlaying) {
        await invoke("stop_independent", { id: cueId });
      }

      const item: PlayableItem = {
        id: cueId,
        media_id: file.path,
        path: file.path,
        media_type: "music",
        mixer_bus: "cue",
        mix_end_ms: null,
        duration_ms: null,
        fade_duration_ms: null,
        fade_out_time_ms: null,
        manual_fade_out_ms: 100, // fadeout rápido
      };

      setCueFile(file.path);
      setCueTime(0);
      try {
        await invoke("play_independent", { item });
        setCuePlaying(true);
      } catch (err) {
        console.error("Erro ao tocar cue:", err);
        setCuePlaying(false);
      }
    }
  }, [cueFile, cuePlaying]);

  const handleCueSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    setCueTime(t);
    invoke("seek_independent", { id: "cue-player", positionMs: Math.floor(t * 1000) }).catch(console.error);
  };

  const handleSeek = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const time_sec = Number(e.target.value);
    setCurrentTime(time_sec);
    try { await invoke("seek_audio", { positionMs: Math.floor(time_sec * 1000) }); }
    catch (err) { console.error(err); }
  };

  const scrollToPlaylistMusic = useCallback((musicId: string) => {
    window.requestAnimationFrame(() => {
      const element = playlistItemRefs.current[musicId];
      if (!element) return;

      element.scrollIntoView({ behavior: "smooth", block: "start" });
      element.classList.add("playlist-scroll-highlight");
      window.setTimeout(() => {
        element.classList.remove("playlist-scroll-highlight");
      }, 1800);
    });
  }, []);

  const clearScheduleTimer = useCallback(() => {
    if (scheduleTimerRef.current !== null) {
      window.clearTimeout(scheduleTimerRef.current);
      scheduleTimerRef.current = null;
    }
  }, []);

  const recalculatePlaylistDiscards = useCallback(async (
    reason: string,
    anchorMusicId: string | null = discardAnchorRef.current,
    options: {
      isCancelled?: () => boolean;
      syncPlayback?: boolean;
    } = {}
  ) => {
    if (!data) return null;

    clearScheduleTimer();

    const { playableItems, scheduledBlocks } = buildPlaylistRuntimeItems(data, mixConfig);
    const currentDayScheduledBlocks = scheduledBlocksForPlaybackWindow(
      scheduledBlocks,
      playlistBaseDate
    );

    if (currentDayScheduledBlocks.length === 0) {
      const queueItems = applyMixOverrides(playableItems);
      playableItemsRef.current = queueItems;
      await invoke("set_queue", { items: queueItems });
      if (!options.isCancelled?.()) {
        scheduleScrollKeyRef.current = null;
        setScheduledMusicId(null);
        setScheduleStarts({});
      }
      return { effectiveQueue: queueItems, selection: null };
    }

    try {
      const selection = await invoke<ScheduleSelectionDto>("get_schedule_selection", {
        blocks: currentDayScheduledBlocks,
        anchorMediaId: anchorMusicId,
      });
      if (options.isCancelled?.()) return null;

      setData((prev) => prev ? applyScheduleMediaDiscards(prev, selection.mediaDiscards) : prev);
      setScheduleStarts(Object.fromEntries(selection.mediaStarts.map(item => [item.id, item])));

      const activeIds = new Set(selection.activeQueueIds);
      const filteredItems = selection.activeQueueIds.length > 0
        ? playableItems.filter(item => activeIds.has(item.id))
        : playableItems;
      const effectiveQueue = applyMixOverrides(filteredItems);
      playableItemsRef.current = effectiveQueue;
      await invoke("set_queue", { items: effectiveQueue });

      const scrollIfScheduleTargetChanged = (kind: string, musicId: string) => {
        const key = `${kind}:${musicId}`;
        if (scheduleScrollKeyRef.current === key) return;
        scheduleScrollKeyRef.current = key;
        scrollToPlaylistMusic(musicId);
      };

      if (selection.type === "active") {
        setScheduledMusicId(selection.musicId);
        if (options.syncPlayback !== false) {
          scrollIfScheduleTargetChanged(`${reason}:active`, selection.musicId);
        }

        if (options.syncPlayback !== false) {
          const index = effectiveQueue.findIndex(item => item.id === selection.musicId);
          if (index !== -1) {
            const playback = await invoke<{ current_id?: string | null }>("get_playback_state");
            const alreadyThisTrack = playback.current_id === selection.musicId;
            if (!alreadyThisTrack) {
              await invoke("play_index", { index });
            }
          }
        }
      } else if (selection.type === "upcoming") {
        setScheduledMusicId(selection.musicId);
        if (options.syncPlayback !== false) {
          scrollIfScheduleTargetChanged(`${reason}:upcoming`, selection.musicId);
        }
        scheduleTimerRef.current = window.setTimeout(() => {
          void recalculatePlaylistDiscards("timer", discardAnchorRef.current, {
            syncPlayback: options.syncPlayback,
          });
        }, Math.max(0, selection.startsInSec * 1000));
      } else {
        scheduleScrollKeyRef.current = null;
        setScheduledMusicId(null);
      }

      return { effectiveQueue, selection };
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [
    applyMixOverrides,
    clearScheduleTimer,
    data,
    mixConfig,
    playlistBaseDate,
    scrollToPlaylistMusic,
    setData,
  ]);

  const togglePlay = async (uniqueId: string) => {
    try {
      if (playingId === uniqueId || backgroundIds.includes(uniqueId)) {
        if (isPlaying) await invoke("pause_audio");
        else await invoke("resume_audio");
      } else {
        discardAnchorRef.current = uniqueId;
        const recalculated = await recalculatePlaylistDiscards("manual-play", uniqueId, {
          syncPlayback: false,
        });
        const effectiveQueue = recalculated?.effectiveQueue ?? playableItemsRef.current;
        const idx = effectiveQueue.findIndex(i => i.id === uniqueId);
        if (idx !== -1) {
          await invoke("play_index", { index: idx });
          lastPlaybackDiscardAnchorRef.current = uniqueId;
          setPlayingId(uniqueId);
          setIsPlaying(true);
        }
      }
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const state: any = await invoke("get_playback_state");
        if (state.current_id) {
          setPlayingId(state.current_id);
          setCurrentTime(state.position_ms / 1000);
          setDuration(state.duration_ms / 1000);
          setIsPlaying(state.is_playing);
          setBackgroundIds(state.background_ids || []);
          setBackgroundPositions(state.background_positions || {});
          setBackgroundDurations(state.background_durations || {});
        } else {
          setPlayingId(null); setIsPlaying(false);
          setBackgroundIds(state.background_ids || []);
          setBackgroundPositions(state.background_positions || {});
          setBackgroundDurations(state.background_durations || {});
        }

        // Atualiza estado do CUE
        const cuePos = state.independent_positions?.["cue-player"];
        const cueDur = state.independent_durations?.["cue-player"];
        if (cuePos !== undefined) {
          setCueTime(cuePos / 1000);
          if (cueDur) setCueDuration(cueDur / 1000);
          
          // Se chegou muito perto do fim (menos de 100ms), consideramos que terminou
          if (cueDur && cuePos >= cueDur - 100) {
            setCuePlaying(false);
            setCueTime(0);
          }
        } else if (cuePlaying) {
          // Se estava tocando mas não veio no state, é porque terminou
          setCuePlaying(false);
          setCueTime(0);
        }
      } catch (e) { console.error(e); }
    }, 33);
    return () => clearInterval(interval);
  }, [cuePlaying]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isTyping = e.target instanceof HTMLElement && e.target.tagName === "INPUT";
      if (isTyping) return;

      if (e.code === "Space") {
        e.preventDefault();
        invoke("skip_with_fade").catch(console.error);
      }

      if (e.code === "KeyT") {
        const targetId = playingId ?? scheduledMusicId;
        if (targetId) {
          e.preventDefault();
          scrollToPlaylistMusic(targetId);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playingId, scheduledMusicId, scrollToPlaylistMusic]);

  useEffect(() => {
    if (!data) return;

    let cancelled = false;
    void recalculatePlaylistDiscards("playlist-change", discardAnchorRef.current, {
      isCancelled: () => cancelled,
      syncPlayback: playingId == null,
    });

    return () => {
      cancelled = true;
      clearScheduleTimer();
    };
  }, [clearScheduleTimer, data, playingId, recalculatePlaylistDiscards]);

  useEffect(() => {
    if (!playingId) {
      lastPlaybackDiscardAnchorRef.current = null;
      discardAnchorRef.current = null;
      return;
    }

    if (
      playingId === scheduledMusicId ||
      playingId === lastPlaybackDiscardAnchorRef.current
    ) {
      return;
    }

    lastPlaybackDiscardAnchorRef.current = playingId;
    discardAnchorRef.current = playingId;
    void recalculatePlaylistDiscards("playback-change", playingId, {
      syncPlayback: false,
    });
  }, [playingId, recalculatePlaylistDiscards, scheduledMusicId]);

  return (
    <SyncplayLibraryProvider value={libraryMaps}>
      {/* Wrapper das 3 colunas */}
      <div
        ref={headerRef}
        className="flex h-[calc(100vh-50px)] bg-[#262626]"
        style={{ overflow: 'hidden' }}
      >

        {/* COLUNA 1 (playlist + cabeçalho fixo) */}
        <div
          className="relative flex min-h-0 flex-col overflow-hidden bg-[#262626] border-r border-[#353535]"
          style={col1Style}
        >
          {/* Faixa atual: capa + artista / música */}
          <MusicInfo nowPlayingMusic={nowPlayingMusic} />
          {/* Reserva: waveform */}
          <div
            className="h-14 shrink-0 border-b border-[#353535]"
            aria-hidden
          />
          <PlaylistPlaybackBar
            currentTime={currentTime}
            duration={duration}
            hasCurrentTrack={playingId != null}
            isPlaying={isPlaying}
            onStop={() => invoke("pause_audio").catch(console.error)}
            onTogglePlayPause={async () => {
              if (!playingId) return;
              try {
                if (isPlaying) await invoke("pause_audio");
                else await invoke("resume_audio");
              } catch (e) {
                console.error(e);
              }
            }}
            onNext={() => invoke("skip_with_fade").catch(console.error)}
          />
          <div className="flex h-full min-h-0 w-full min-w-0">
            <div
              className="h-full min-w-3 shrink basis-12"
              aria-hidden
            />
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              <PlaylistCurrentBlock
                predictedTimeLabel={playlistCurrentBlockLine.predictedTimeLabel}
                programName={playlistCurrentBlockLine.programName}
                blockType={playlistCurrentBlockLine.blockType}
              />
              <div className="scrollable-y relative flex min-h-0 flex-1 flex-col overflow-y-auto">
                {loading && <p className="text-center p-8 text-slate-400">Carregando lista...</p>}
                {error && <div className="text-center p-8 text-red-300">{error}</div>}

                {!loading && !error && data && (
                  <div className="w-full">
                    {visiblePlaylistGroups.map(({ plKey, pl, blocks }) => (
                      <div key={plKey}>
                        {blocks.map(([blockKey, block]) => {
                          const musicEntries = Object.entries(blockMediaRecord(block));
                          const blockDisplayStart = getBlockDisplayStart(block.start, musicEntries);
                          const blockUiKey = `${plKey}::${blockKey}`;
                          const anchor = playingId ?? scheduledMusicId;
                          const isCurrentBlock = Boolean(
                            anchor && anchor.startsWith(`${plKey}-${blockKey}-`)
                          );
                          const programKey = (pl.program || '').trim() || plKey;
                          const dateIso = isoDateHintFromPlaylistKey(plKey, playlistBaseDate);
                          const dateTextBr = formatBrazilianPlaylistDate(dateIso);
                          const scheduleBlockSec =
                            typeof block.duration === 'number' && Number.isFinite(block.duration)
                              ? block.duration
                              : typeof block.size === 'number' && Number.isFinite(block.size)
                                ? block.size
                                : null;
                          const durMs = block.duration_real_total_ms;
                          const fromRealTotalSec =
                            typeof durMs === 'number' && Number.isFinite(durMs) && durMs > 0
                              ? durMs / 1000
                              : null;
                          const headerDurationSeconds =
                            fromRealTotalSec ??
                            (scheduleBlockSec !== null && scheduleBlockSec > 0 ? scheduleBlockSec : null);
                          const hasFixedTime =
                            block.start_alias != null && String(block.start_alias).trim() !== '';
                          const dataHideDisabled = playlistBlockHideDisabled[blockUiKey] === true;
                          const blockExpanded = playlistBlockExpanded[blockUiKey] !== false;
                          return (
                            <section
                              key={`${plKey}-${blockKey}`}
                              data-playlist={plKey}
                              data-pkey={programKey}
                              data-bkey={blockKey}
                              data-hide-disabled={dataHideDisabled ? 'true' : 'false'}
                              className={[
                                'playlist-block',
                                block.type === 'musical'
                                  ? 'playlist-block--musical'
                                  : 'playlist-block--commercial',
                                hasFixedTime ? 'playlist-block--fixed' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              <BlockHeader
                                playlistKey={plKey}
                                programKey={programKey}
                                blockKey={blockKey}
                                dateText={dateTextBr}
                                isCommercialBlock={block.type !== 'musical'}
                                startTimeSeconds={blockDisplayStart}
                                durationSeconds={headerDurationSeconds}
                                hasFixedTime={hasFixedTime}
                                isCurrentBlock={isCurrentBlock}
                                dataHideDisabled={dataHideDisabled}
                                onToggleHideDisabled={() => {
                                  setPlaylistBlockHideDisabled((prev) => ({
                                    ...prev,
                                    [blockUiKey]: !prev[blockUiKey],
                                  }));
                                }}
                                onClearBlock={() => {
                                  setData((prev) => {
                                    if (!prev) return prev;
                                    return clearBlockMedia(prev, plKey, blockKey) ?? prev;
                                  });
                                }}
                                expanded={blockExpanded}
                                onToggleExpanded={() => {
                                  setPlaylistBlockExpanded((prev) => {
                                    const isExp = prev[blockUiKey] !== false;
                                    return { ...prev, [blockUiKey]: !isExp };
                                  });
                                }}
                              />
                              {blockExpanded ? (
                              <div className="playlist-block-body">
                                {musicEntries.length === 0 ? (
                                  <div className="px-2 py-1">
                                    <div className="rounded-xl border border-dashed border-[#353535] mx-1 px-3 py-6 text-center">
                                      <p className="m-0 text-[0.78rem] text-slate-500 italic">
                                        Nenhuma mídia neste bloco
                                      </p>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {musicEntries.map(([musicKey, music]) => {
                                      const uniqueId = `${plKey}-${blockKey}-${musicKey}`;
                                      const isCurrentlyPlaying = playingId === uniqueId;
                                      const isBackgroundPlaying = backgroundIds.includes(uniqueId);
                                      const scheduleStart = scheduleStarts[uniqueId];
                                      const isDisabled = legacyBool(music.disabled) ||
                                        legacyBool(music.discarded) ||
                                        legacyBool(music.manualDiscard ?? music.manual_discard) ||
                                        scheduleStart?.active === false;
                                      return (
                                        <div
                                          key={musicKey}
                                          ref={(node) => {
                                            if (node) playlistItemRefs.current[uniqueId] = node;
                                            else delete playlistItemRefs.current[uniqueId];
                                          }}
                                          data-playlist-music-id={uniqueId}
                                        >
                                            <PlaylistMusicItem
                                              music={music}
                                              itemUniqueId={uniqueId}
                                              overrideMixEndMs={autoMixOverrides[uniqueId]}
                                              filterVisibility={playlistFilterVis}
                                              libraryYearDecade={libraryYearDecade}
                                              showMusicFileName={showNameMusicFiles}
                                              showCommercialFileName={showNameCommercialFiles}
                                              showMediaFileName={showNameMediaFiles}
                                              libMusicFilterIds={libMusicFilterIds}
                                              playlistSidebarFilterHighlight={{
                                                searchQuery,
                                                mediaCategory,
                                                directoryValue,
                                              }}
                                              onPlaylistFilterClick={applyPlaylistFilterClick}
                                              startLabel={scheduleStart?.startLabel}
                                              isCurrentlyPlaying={isCurrentlyPlaying}
                                              isBackgroundPlaying={isBackgroundPlaying}
                                              isScheduledUpcoming={scheduledMusicId === uniqueId && !isCurrentlyPlaying && !isBackgroundPlaying}
                                              isDisabled={isDisabled}
                                              isPlaying={isPlaying}
                                              currentTime={currentTime}
                                              duration={isBackgroundPlaying && backgroundDurations[uniqueId] ? backgroundDurations[uniqueId] / 1000 : duration}
                                              backgroundPosition={backgroundPositions[uniqueId] ?? 0}
                                              onPlay={() => togglePlay(uniqueId)}
                                              onSeek={handleSeek}
                                              showTrashSkipIcon={trashHighlightPlaylistId === uniqueId}
                                              onPlaylistItemSelect={() =>
                                                setTrashHighlightPlaylistId((prev) =>
                                                  prev === uniqueId ? null : uniqueId
                                                )
                                              }
                                              onTrashRemove={
                                                trashHighlightPlaylistId === uniqueId
                                                  ? () => {
                                                    setTrashHighlightPlaylistId(null);
                                                    setData((prev) => {
                                                      if (!prev) return prev;
                                                      return (
                                                        removeMusicFromBlock(prev, plKey, blockKey, musicKey) ??
                                                        prev
                                                      );
                                                    });
                                                  }
                                                  : undefined
                                              }
                                              onSkipNextFromRow={() => {
                                                const q = playableItemsRef.current;
                                                const idx = q.findIndex((i) => i.id === uniqueId);
                                                if (idx === -1) return;
                                                invoke("play_index", { index: idx + 1 }).catch(console.error);
                                              }}
                                            />
                                        </div>
                                      );
                                    })}
                                  </>
                                )}
                              </div>
                              ) : null}
                              <div className="playlist-block-footer" />
                            </section>
                          );
                        })}
                      </div>
                    ))}
                    <PlaylistLoadMoreControls
                      hasMoreTail={playlistHasMoreTail}
                      isLoading={playlistAppendingDay}
                      onLoadNext={loadNextPlaylistBlock}
                      onLoadAll={loadAllPlaylistBlocksUntilEnd}
                    />
                    {playlistAppendError && (
                      <div className="px-3 pb-3 text-[0.78rem] text-red-300">
                        {playlistAppendError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Drag-handle entre col-1 e col-2 */}
        <div
          className="shrink-0 cursor-col-resize bg-[#353535] hover:bg-neutral-500 transition-colors duration-150 z-10"
          style={{ width: handleW, touchAction: 'none' }}
          onMouseDown={onHandleMouseDown('h1')}
        />

        {/* COLUNA 2 (#midias — biblioteca + CUE) */}
        <div
          id="midias"
          className="flex flex-col overflow-hidden p-0 bg-[#262626]"
          style={col2Style}
        >
          <div className="px-5 pt-5 pb-3 border-b border-[#353535] flex flex-col gap-2.5 shrink-0">
            <h2 className="text-[1rem] font-semibold text-slate-400 tracking-[0.04em] uppercase">📂 Biblioteca de Mídias</h2>
            <div className="flex gap-2">
              <select
                className="flex-1 bg-white/5 border border-[#353535] rounded-lg px-3 py-1.5 text-white/90 text-[0.8rem] outline-none transition-colors focus:border-neutral-500 [&>option]:bg-[#262626] [&>option]:text-white"
                value={mediaCategory}
                onChange={(e) => setMediaCategory(e.target.value as MediaCategory)}
              >
                <option value="unset">Selecione o tipo</option>
                <option value="musics">Músicas</option>
                <option value="medias">Mídias</option>
                <option value="others">Comerciais / Outros</option>
              </select>

              <select
                className="flex-1 bg-white/5 border border-[#353535] rounded-lg px-3 py-1.5 text-white/90 text-[0.8rem] outline-none transition-colors focus:border-neutral-500 disabled:opacity-50 [&>option]:bg-[#262626] [&>option]:text-white"
                value={directoryValue}
                onChange={(e) => {
                  setDirectoryValue(e.target.value);
                  const opt = directoryOptions.find(o => o.value === e.target.value);
                  if (opt) setDirectoryKind(opt.kind);
                }}
                disabled={mediaCategory === 'unset'}
              >
                {mediaCategory === 'unset' ? (
                  <option value="" disabled>Selecione o tipo primeiro</option>
                ) : (
                  directoryOptions.map((opt) => (
                    <option key={`${opt.kind}-${opt.value}`} value={opt.value}>
                      {opt.label}
                    </option>
                  ))
                )}
              </select>
            </div>

            {mediaCategory === 'musics' && (
              <div className="flex flex-col gap-2 border border-[#353535]/80 rounded-lg px-3 py-2 bg-black/15">
                <div className="flex flex-wrap gap-2 items-center">
                  <select
                    className="min-w-[120px] flex-1 bg-white/5 border border-[#353535] rounded-lg px-2 py-1 text-white/90 text-[0.72rem] outline-none focus:border-neutral-500 [&>option]:bg-[#262626]"
                    value={libMusicFilterIds.categoryId}
                    onChange={(e) =>
                      setLibMusicFilterIds((prev) => ({ ...prev, categoryId: e.target.value }))
                    }
                  >
                    <option value="">Categoria</option>
                    {Object.entries(musicCategoryMap).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="min-w-[120px] flex-1 bg-white/5 border border-[#353535] rounded-lg px-2 py-1 text-white/90 text-[0.72rem] outline-none focus:border-neutral-500 [&>option]:bg-[#262626]"
                    value={libMusicFilterIds.styleId}
                    onChange={(e) =>
                      setLibMusicFilterIds((prev) => ({ ...prev, styleId: e.target.value }))
                    }
                  >
                    <option value="">Estilo</option>
                    {Object.entries(musicStyleMap).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="min-w-[120px] flex-1 bg-white/5 border border-[#353535] rounded-lg px-2 py-1 text-white/90 text-[0.72rem] outline-none focus:border-neutral-500 [&>option]:bg-[#262626]"
                    value={libMusicFilterIds.rhythmId}
                    onChange={(e) =>
                      setLibMusicFilterIds((prev) => ({ ...prev, rhythmId: e.target.value }))
                    }
                  >
                    <option value="">Ritmo</option>
                    {Object.entries(musicRhythmMap).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="min-w-[120px] flex-1 bg-white/5 border border-[#353535] rounded-lg px-2 py-1 text-white/90 text-[0.72rem] outline-none focus:border-neutral-500 [&>option]:bg-[#262626]"
                    value={libMusicFilterIds.nationalityId}
                    onChange={(e) =>
                      setLibMusicFilterIds((prev) => ({ ...prev, nationalityId: e.target.value }))
                    }
                  >
                    <option value="">Nacionalidade</option>
                    {Object.entries(musicNationalityMap).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder={libraryYearDecade ? 'Ano min (década)' : 'Ano min'}
                    className="w-24 bg-white/5 border border-[#353535] rounded-lg px-2 py-1 text-white/90 text-[0.72rem] outline-none focus:border-neutral-500"
                    value={libMusicFilterIds.yearMin}
                    onChange={(e) =>
                      setLibMusicFilterIds((prev) => ({ ...prev, yearMin: e.target.value }))
                    }
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder={libraryYearDecade ? 'Ano máx' : 'Ano máx'}
                    className="w-24 bg-white/5 border border-[#353535] rounded-lg px-2 py-1 text-white/90 text-[0.72rem] outline-none focus:border-neutral-500"
                    value={libMusicFilterIds.yearMax}
                    onChange={(e) =>
                      setLibMusicFilterIds((prev) => ({ ...prev, yearMax: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="ml-auto text-[0.72rem] px-2 py-1 rounded-lg bg-white/10 text-slate-200 hover:bg-white/15 border border-[#353535]"
                    onClick={() => resetLibMusicFilters()}
                  >
                    Limpar filtros
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 bg-white/3 border border-[#353535] rounded-lg px-3 py-1.5">
              <span className="text-[0.85rem] opacity-70" aria-hidden>🔍</span>
              <input id="buscaMidia" className="flex-1 bg-transparent border-none outline-none text-white/90 text-[0.85rem] placeholder:text-slate-500"
                placeholder="Buscar mídia..." value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)} />
              {searchQuery && (
                <span className="text-[0.72rem] text-neutral-400 font-semibold whitespace-nowrap">
                  {filteredFiles.length} resultado{filteredFiles.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col relative">
            {dirError && <div className="m-3 px-3 py-2 bg-red-500/12 border border-red-500/30 rounded-lg text-red-300 text-[0.82rem]">⚠️ {dirError}</div>}
            {!dirLoading && dirFiles.length === 0 && !dirError && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 text-[0.88rem] text-center p-8">
                <span className="text-[2.5rem] opacity-50" aria-hidden>🎵</span>
                <p>Selecione uma pasta e carregue os arquivos (🔍 acima).</p>
              </div>
            )}
            {dirLoading && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 text-[0.88rem]">
                <div className="w-8 h-8 border-3 border-[#353535] border-t-neutral-400 rounded-full animate-spin-custom" />
                <p>Lendo diretório...</p>
              </div>
            )}
            {!dirLoading && filteredFiles.length > 0 && (
              <div className="list flex-1 overflow-y-auto relative" ref={parentRef}>
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const file = filteredFiles[virtualRow.index];
                    const isSelected = selectedFile === file.path;
                    const isCueing = cueFile === file.path;
                    const isCuePlaying = isCueing && cuePlaying;

                    return (
                      <div
                        key={virtualRow.key}
                        data-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <LibraryMediaListItem
                          file={file}
                          idx={virtualRow.index}
                          isSelected={isSelected}
                          isCueing={isCueing}
                          isCuePlaying={isCuePlaying}
                          onSelect={() => {
                            setSelectedFile(file.path);
                            if (!isCueing && cuePlaying) {
                              invoke("stop_independent", { id: "cue-player" }).catch(console.error);
                              setCuePlaying(false);
                            }
                          }}
                          onDoubleClick={() => console.log("[Playlist] Double-click:", file.path)}
                          onCue={e => {
                            e.stopPropagation();
                            toggleCue(file);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {cueFile && (
            <div className="shrink-0 px-4 py-2.5 border-t border-[#353535] bg-[#1f1f1f] flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[0.6rem] font-bold tracking-[0.08em] bg-violet-700 text-white px-1.5 py-0.5 rounded shrink-0">CUE</span>
                <span className="text-[0.8rem] text-violet-300 whitespace-nowrap overflow-hidden text-ellipsis">
                  {cueFile.split(/[\\\/]/).pop()?.replace(/\.[^/.]+$/, "")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[0.72rem] text-slate-400 tabular-nums min-w-[35px]">{formatTime(cueTime)}</span>
                <input type="range" className="cue-progress-bar"
                  min={0} max={isNaN(cueDuration) ? 0 : cueDuration}
                  step={0.01} value={isNaN(cueTime) ? 0 : cueTime} onChange={handleCueSeek} />
                <span className="text-[0.72rem] text-slate-400 tabular-nums min-w-[35px]">{formatTime(cueDuration)}</span>
                <button
                  className={`shrink-0 bg-white/10 border-none rounded-md px-2 py-1 text-[0.9rem] cursor-pointer transition-colors ${cuePlaying ? "text-red-300" : "text-slate-400"} hover:bg-red-500/30 hover:text-red-300`}
                  onClick={() => {
                    invoke("stop_independent", { id: "cue-player" }).catch(console.error);
                    setCuePlaying(false); setCueTime(0); setCueFile(null);
                  }} title="Parar CUE">⏹</button>
              </div>
            </div>
          )}
        </div>

        {/* Drag-handle entre col-2 e col-3 */}
        {!isRetrieveMode && (
          <div
            className="shrink-0 cursor-col-resize bg-[#353535] hover:bg-neutral-500 transition-colors duration-150 z-10"
            style={{ width: handleW, touchAction: 'none' }}
            onMouseDown={onHandleMouseDown('h2')}
          />
        )}

        {/* COLUNA 3 — Mixer */}
        {!isRetrieveMode && (
          <div className="flex flex-col min-h-0 flex-1 overflow-hidden bg-[#161616]">
            <MixerPanel />
          </div>
        )}

      </div>

      <SettingsDock />
    </SyncplayLibraryProvider>
  );
}

export default App;

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
import { SettingsDock } from './components/settings/SettingsDock';
import { LibraryColumn } from './components/layout/LibraryColumn';
import { MixerColumn } from './components/layout/MixerColumn';
import { PlaylistColumn } from './components/layout/PlaylistColumn';
import { SECONDS_PER_DAY, usePlaylistData } from './hooks/usePlaylistData';
import { useSyncplayLibrary } from './hooks/useSyncplayLibrary';
import { formatSecondsOfDay } from './time';
import { SyncplayLibraryProvider } from './library/SyncplayLibraryContext';
import { useAutoMixDetection, parseAutoMixSettings } from './hooks/useAutoMixDetection';
import { useColumnResize } from './hooks/useColumnResize';
import {
  blockMediaRecord,
  getBlockDisplayStart,
  legacyBool,
  mediaDurationMs,
} from './playlist/playlistBlockHelpers';

async function fetchConfigSafe<T>(filename: string): Promise<T | null> {
  try {
    const data: string = await invoke("read_config", { filename });
    return JSON.parse(data);
  } catch {
    return null;
  }
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

        <PlaylistColumn
          col1Style={col1Style}
          nowPlayingMusic={nowPlayingMusic}
          currentTime={currentTime}
          duration={duration}
          playingId={playingId}
          scheduledMusicId={scheduledMusicId}
          isPlaying={isPlaying}
          playlistCurrentBlockLine={playlistCurrentBlockLine}
          loading={loading}
          error={error}
          data={data}
          visiblePlaylistGroups={visiblePlaylistGroups}
          playlistBaseDate={playlistBaseDate}
          playlistBlockHideDisabled={playlistBlockHideDisabled}
          setPlaylistBlockHideDisabled={setPlaylistBlockHideDisabled}
          playlistBlockExpanded={playlistBlockExpanded}
          setPlaylistBlockExpanded={setPlaylistBlockExpanded}
          setData={setData}
          autoMixOverrides={autoMixOverrides}
          playlistFilterVis={playlistFilterVis}
          libraryYearDecade={libraryYearDecade}
          showNameMusicFiles={showNameMusicFiles}
          showNameCommercialFiles={showNameCommercialFiles}
          showNameMediaFiles={showNameMediaFiles}
          libMusicFilterIds={libMusicFilterIds}
          applyPlaylistFilterClick={applyPlaylistFilterClick}
          searchQuery={searchQuery}
          mediaCategory={mediaCategory}
          directoryValue={directoryValue}
          scheduleStarts={scheduleStarts}
          trashHighlightPlaylistId={trashHighlightPlaylistId}
          setTrashHighlightPlaylistId={setTrashHighlightPlaylistId}
          backgroundIds={backgroundIds}
          backgroundDurations={backgroundDurations}
          backgroundPositions={backgroundPositions}
          togglePlay={togglePlay}
          handleSeek={handleSeek}
          playableItemsRef={playableItemsRef}
          playlistItemRefs={playlistItemRefs}
          playlistHasMoreTail={playlistHasMoreTail}
          playlistAppendingDay={playlistAppendingDay}
          playlistAppendError={playlistAppendError}
          loadNextPlaylistBlock={loadNextPlaylistBlock}
          loadAllPlaylistBlocksUntilEnd={loadAllPlaylistBlocksUntilEnd}
        />

        <div
          className="shrink-0 cursor-col-resize bg-[#353535] hover:bg-neutral-500 transition-colors duration-150 z-10"
          style={{ width: handleW, touchAction: 'none' }}
          onMouseDown={onHandleMouseDown('h1')}
        />

        <LibraryColumn
          col2Style={col2Style}
          libraryYearDecade={libraryYearDecade}
          mediaCategory={mediaCategory}
          setMediaCategory={setMediaCategory}
          directoryOptions={directoryOptions}
          directoryValue={directoryValue}
          setDirectoryValue={setDirectoryValue}
          setDirectoryKind={setDirectoryKind}
          libMusicFilterIds={libMusicFilterIds}
          setLibMusicFilterIds={setLibMusicFilterIds}
          resetLibMusicFilters={resetLibMusicFilters}
          musicCategoryMap={musicCategoryMap}
          musicStyleMap={musicStyleMap}
          musicRhythmMap={musicRhythmMap}
          musicNationalityMap={musicNationalityMap}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          filteredFiles={filteredFiles}
          dirError={dirError}
          dirLoading={dirLoading}
          dirFiles={dirFiles}
          parentRef={parentRef}
          rowVirtualizer={rowVirtualizer}
          selectedFile={selectedFile}
          setSelectedFile={setSelectedFile}
          cueFile={cueFile}
          setCueFile={setCueFile}
          cuePlaying={cuePlaying}
          setCuePlaying={setCuePlaying}
          cueTime={cueTime}
          setCueTime={setCueTime}
          cueDuration={cueDuration}
          toggleCue={toggleCue}
          handleCueSeek={handleCueSeek}
        />

        {!isRetrieveMode && (
          <div
            className="shrink-0 cursor-col-resize bg-[#353535] hover:bg-neutral-500 transition-colors duration-150 z-10"
            style={{ width: handleW, touchAction: 'none' }}
            onMouseDown={onHandleMouseDown('h2')}
          />
        )}

        {!isRetrieveMode && <MixerColumn />}

      </div>

      <SettingsDock />
    </SyncplayLibraryProvider>
  );
}

export default App;

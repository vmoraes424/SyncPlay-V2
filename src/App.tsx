import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";
import "./App.css";
import type {
  MediaCategory, DirectoryOptionKind, DirectoryOption,
  DirFile, Music, SyncPlayData,
  PlayableItem, ScheduledBlockDto, ScheduleSelectionDto,
} from './types';
import { BlockHeader } from './components/BlockHeader';
import { PlaylistMusicItem } from './components/PlaylistMusicItem';
import { formatSecondsOfDay } from './time';

async function fetchConfigSafe<T>(filename: string): Promise<T | null> {
  try {
    const data: string = await invoke("read_config", { filename });
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function formatTime(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/**
 * Insere uma nova Music no bloco indicado.
 * Se beforeKey === null → append ao final do bloco.
 * Se beforeKey === string → insere ANTES dessa chave.
 */
function insertMusic(
  data: SyncPlayData,
  file: DirFile,
  plKey: string,
  blockKey: string,
  beforeKey: string | null
): SyncPlayData {
  const block = data.playlists[plKey].blocks[blockKey];
  const entries = Object.entries(block.musics ?? {});
  const newKey = `dropped-${Date.now()}`;
  const newMusic: Music = {
    text: file.name.replace(/\.[^/.]+$/, ""),
    path: file.path,
    type: "music",
  };

  const insertIdx =
    beforeKey === null
      ? entries.length
      : Math.max(0, entries.findIndex(([k]) => k === beforeKey));

  entries.splice(insertIdx, 0, [newKey, newMusic]);

  return {
    ...data,
    playlists: {
      ...data.playlists,
      [plKey]: {
        ...data.playlists[plKey],
        blocks: {
          ...data.playlists[plKey].blocks,
          [blockKey]: { ...block, musics: Object.fromEntries(entries) },
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

function mediaMixOutMs(music: Music) {
  return music.extra?.mix?.mix_total_milesecond ?? null;
}

function buildPlaylistRuntimeItems(data: SyncPlayData) {
  const playableItems: PlayableItem[] = [];
  const scheduledBlocks: ScheduledBlockDto[] = [];

  orderedPlaylistEntries(data).forEach(([plKey, pl]) =>
    orderedBlockEntries(pl.blocks).forEach(([blockKey, block]) => {
      if (!block.musics) return;

      const medias = Object.entries(block.musics).map(([musicKey, music]) => {
        const uniqueId = `${plKey}-${blockKey}-${musicKey}`;
        const duration_ms = mediaDurationMs(music);
        const fade_duration_ms = mediaMixOutMs(music);

        if (music.path) {
          playableItems.push({
            id: uniqueId,
            path: music.path,
            mix_end_ms: music.extra?.mix?.mix_end ?? null,
            duration_ms,
            fade_duration_ms,
          });
        }

        return {
          id: uniqueId,
          title: music.text || `Mídia: ${music.type ?? musicKey}`,
          mediaType: music.type ?? '',
          path: music.path ?? '',
          durationSec: duration_ms !== null ? duration_ms / 1000 : music.duration ?? null,
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

// --- DroppableSlot ---
// Linha fina entre os itens da playlist — torna-se o target do drop.

function DroppableSlot({ id }: { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`drop-slot${isOver ? " drop-slot-active" : ""}`} />;
}

// --- DraggableMidiaItem ---

interface DraggableMidiaProps {
  file: DirFile;
  idx: number;
  isSelected: boolean;
  isCueing: boolean;
  isCuePlaying: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  onCue: (e: React.MouseEvent) => void;
}

function DraggableMidiaItem({
  file,
  idx,
  isSelected,
  isCueing,
  isCuePlaying,
  onSelect,
  onDoubleClick,
  onCue,
}: DraggableMidiaProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: file.path,
    data: { file },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragging ? "grabbing" : "grab",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      id={`midia-item-${idx}`}
      className={[
        "flex items-center gap-2.5 px-3 h-9 cursor-pointer border-b border-white/5 select-none transition-colors duration-150",
        isSelected ? "bg-blue-500/15 border-l-2 border-l-blue-500" : "hover:bg-white/5",
        isCueing ? "bg-violet-500/12 border-l-2 border-l-violet-400" : "",
      ].join(" ")}
      title={file.path}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      {...listeners}
      {...attributes}
    >
      <button
        className={[
          "w-[26px] h-[26px] rounded-full flex items-center justify-center text-xs text-white/90 shrink-0 transition-all duration-200",
          isCuePlaying ? "bg-violet-700 animate-pulse-cue" : "bg-white/10 hover:bg-violet-400 hover:scale-110",
        ].join(" ")}
        title={isCuePlaying ? "Parar CUE" : "Preview CUE"}
        onClick={onCue}
        onPointerDown={e => e.stopPropagation()}
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
  const [data, setData] = useState<SyncPlayData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [backgroundIds, setBackgroundIds] = useState<string[]>([]);
  const [backgroundPositions, setBackgroundPositions] = useState<Record<string, number>>({});
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scheduledMusicId, setScheduledMusicId] = useState<string | null>(null);
  const playableItemsRef = useRef<PlayableItem[]>([]);
  const scheduleTimerRef = useRef<number | null>(null);
  const playlistItemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // DnD
  const [activeFile, setActiveFile] = useState<DirFile | null>(null);
  const [isOverPlaylist, setIsOverPlaylist] = useState(false);

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

  // CUE Player
  const cueRef = useRef<HTMLAudioElement | null>(null);
  const [cueFile, setCueFile] = useState<string | null>(null);
  const [cuePlaying, setCuePlaying] = useState(false);
  const [cueTime, setCueTime] = useState(0);
  const [cueDuration, setCueDuration] = useState(0);

  const filteredFiles = dirFiles.filter(f =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: filteredFiles.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

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

  const toggleCue = useCallback((file: DirFile) => {
    if (!cueRef.current) {
      cueRef.current = new Audio();
      cueRef.current.ontimeupdate = () => setCueTime(cueRef.current!.currentTime);
      cueRef.current.ondurationchange = () => setCueDuration(cueRef.current!.duration);
      cueRef.current.onended = () => { setCuePlaying(false); setCueTime(0); };
    }
    const audio = cueRef.current;
    if (cueFile === file.path && cuePlaying) {
      audio.pause(); setCuePlaying(false);
    } else if (cueFile === file.path && !cuePlaying) {
      audio.play().then(() => setCuePlaying(true));
    } else {
      audio.pause();
      audio.src = convertFileSrc(file.path);
      setCueFile(file.path); setCueTime(0);
      audio.load();
      audio.play().then(() => setCuePlaying(true)).catch(() => setCuePlaying(false));
    }
  }, [cueFile, cuePlaying]);

  const handleCueSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    if (cueRef.current) cueRef.current.currentTime = t;
    setCueTime(t);
  };

  const togglePlay = async (uniqueId: string) => {
    try {
      if (playingId === uniqueId) {
        if (isPlaying) await invoke("pause_audio");
        else await invoke("resume_audio");
      } else {
        const idx = playableItemsRef.current.findIndex(i => i.id === uniqueId);
        if (idx !== -1) await invoke("play_index", { index: idx });
      }
    } catch (e) { console.error(e); }
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

      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("playlist-scroll-highlight");
      window.setTimeout(() => {
        element.classList.remove("playlist-scroll-highlight");
      }, 1800);
    });
  }, []);

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
        } else {
          setPlayingId(null); setIsPlaying(false);
          setBackgroundIds(state.background_ids || []);
          setBackgroundPositions(state.background_positions || {});
        }
      } catch (e) { console.error(e); }
    }, 33);
    return () => clearInterval(interval);
  }, []);

  const fetchPlaylist = async () => {
    try {
      const jsonStr: string = await invoke("read_playlist", { date: new Date().toISOString().split('T')[0] });
      setData(JSON.parse(jsonStr));
    } catch (err) {
      setError(`Erro ao carregar a playlist: ${err}`); setData(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchPlaylist(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isTyping = e.target instanceof HTMLElement && e.target.tagName === "INPUT";
      if (isTyping) return;

      if (e.code === "Space") {
        e.preventDefault();
        invoke("skip_with_fade").catch(console.error);
      }

      if (e.code === "KeyT") {
        const targetId = scheduledMusicId ?? playingId;
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

    const { playableItems, scheduledBlocks } = buildPlaylistRuntimeItems(data);
    let cancelled = false;

    const clearScheduleTimer = () => {
      if (scheduleTimerRef.current !== null) {
        window.clearTimeout(scheduleTimerRef.current);
        scheduleTimerRef.current = null;
      }
    };

    async function applyScheduleSelection() {
      clearScheduleTimer();

      try {
        if (scheduledBlocks.length === 0) {
          playableItemsRef.current = playableItems;
          await invoke("set_queue", { items: playableItems });
          if (!cancelled) setScheduledMusicId(null);
          return;
        }

        const selection = await invoke<ScheduleSelectionDto>("get_schedule_selection", {
          blocks: scheduledBlocks,
        });
        if (cancelled) return;

        const activeIds = new Set(selection.activeQueueIds);
        const effectiveQueue = selection.activeQueueIds.length > 0
          ? playableItems.filter(item => activeIds.has(item.id))
          : playableItems;
        playableItemsRef.current = effectiveQueue;
        await invoke("set_queue", { items: effectiveQueue });

        if (selection.type === "active") {
          setScheduledMusicId(selection.musicId);
          scrollToPlaylistMusic(selection.musicId);
          const index = effectiveQueue.findIndex(item => item.id === selection.musicId);
          if (index !== -1) {
            await invoke("play_index", { index });
          }
        } else if (selection.type === "upcoming") {
          setScheduledMusicId(selection.musicId);
          scrollToPlaylistMusic(selection.musicId);
          scheduleTimerRef.current = window.setTimeout(() => {
            void applyScheduleSelection();
          }, Math.max(0, selection.startsInSec * 1000));
        } else {
          setScheduledMusicId(null);
        }
      } catch (e) {
        console.error(e);
      }
    }

    void applyScheduleSelection();

    return () => {
      cancelled = true;
      clearScheduleTimer();
    };
  }, [data, scrollToPlaylistMusic]);

  // --- DnD ---

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const file = event.active.data.current?.file as DirFile | undefined;
    if (file) setActiveFile(file);
  };

  const handleDragOver = (event: any) => {
    const id = event.over?.id as string ?? null;
    setIsOverPlaylist(!!id && id.startsWith("slot-"));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveFile(null);
    setIsOverPlaylist(false);
    if (!over || !data) return;

    const file = active.data.current?.file as DirFile;
    if (!file) return;

    const overId = over.id as string;

    // slot-before-{plKey}|{blockKey}|{musicKey}  → insere ANTES
    if (overId.startsWith("slot-before-")) {
      const [plKey, blockKey, musicKey] = overId.replace("slot-before-", "").split("|");
      setData(prev => insertMusic(prev!, file, plKey, blockKey, musicKey));
    }
    // slot-end-{plKey}|{blockKey}  → append ao final
    else if (overId.startsWith("slot-end-")) {
      const [plKey, blockKey] = overId.replace("slot-end-", "").split("|");
      setData(prev => insertMusic(prev!, file, plKey, blockKey, null));
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-2 gap-8 p-8 h-screen max-w-[1600px] mx-auto">

        {/* COLUNA ESQUERDA (playlist) */}
        <div
          className={[
            "scrollable-y relative flex flex-col bg-(--glass-bg) backdrop-blur-xl border rounded-2xl p-6 shadow-[0_4px_30px_rgba(0,0,0,0.1)] overflow-y-auto",
            isOverPlaylist
              ? "border-emerald-400/60 shadow-[0_0_0_2px_rgba(52,211,153,0.3),0_4px_30px_rgba(0,0,0,0.1)] bg-slate-800/85"
              : "border-white/10",
          ].join(" ")}
        >
          {loading && <p className="text-center p-8 text-slate-400">Carregando lista...</p>}
          {error && <div className="text-center p-8 text-red-300">{error}</div>}

          {!loading && !error && data && (
            <div className="w-full">
              {orderedPlaylistEntries(data).map(([plKey, pl]) => (
                <div key={plKey}>
                  <h2 className="playlist-title">{pl.program}</h2>
                  {orderedBlockEntries(pl.blocks).map(([blockKey, block]) => {
                    const musicEntries = Object.entries(block.musics ?? {});
                    const blockDisplayStart = getBlockDisplayStart(block.start, musicEntries);
                    return (
                      <section
                        key={`${plKey}-${blockKey}`}
                        className={[
                          "playlist-block",
                          block.type === "musical" ? "playlist-block--musical" : "playlist-block--commercial",
                        ].join(" ")}
                      >
                        <BlockHeader
                          blockKey={blockKey}
                          blockType={block.type}
                          startLabel={typeof blockDisplayStart === 'number' ? formatSecondsOfDay(blockDisplayStart, true) : undefined}
                        />
                        <div className="playlist-block-body">
                          {musicEntries.length === 0 ? (
                            <div className="px-2 py-1">
                              <div className="block-empty-drop relative rounded-xl border border-dashed border-white/10 mx-1">
                                <DroppableSlot id={`slot-end-${plKey}|${blockKey}`} />
                                <p className="absolute inset-0 flex items-center justify-center pointer-events-none m-0 text-[0.78rem] text-slate-500 italic">
                                  Arraste mídias aqui
                                </p>
                              </div>
                            </div>
                          ) : (
                            <>
                              {musicEntries.map(([musicKey, music]) => {
                                const uniqueId = `${plKey}-${blockKey}-${musicKey}`;
                                const isCurrentlyPlaying = playingId === uniqueId;
                                const isBackgroundPlaying = backgroundIds.includes(uniqueId);
                                return (
                                  <div
                                    key={musicKey}
                                    ref={(node) => {
                                      if (node) playlistItemRefs.current[uniqueId] = node;
                                      else delete playlistItemRefs.current[uniqueId];
                                    }}
                                    data-playlist-music-id={uniqueId}
                                  >
                                    <DroppableSlot id={`slot-before-${plKey}|${blockKey}|${musicKey}`} />
                                    <PlaylistMusicItem
                                      music={music}
                                      isCurrentlyPlaying={isCurrentlyPlaying}
                                      isBackgroundPlaying={isBackgroundPlaying}
                                      isScheduledUpcoming={scheduledMusicId === uniqueId && !isCurrentlyPlaying && !isBackgroundPlaying}
                                      isPlaying={isPlaying}
                                      currentTime={currentTime}
                                      duration={duration}
                                      backgroundPosition={backgroundPositions[uniqueId] ?? 0}
                                      onPlay={() => togglePlay(uniqueId)}
                                      onSeek={handleSeek}
                                    />
                                  </div>
                                );
                              })}
                              <DroppableSlot id={`slot-end-${plKey}|${blockKey}`} />
                            </>
                          )}
                        </div>
                        <div className="playlist-block-footer" />
                      </section>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* COLUNA DIREITA (#midias)*/}
        <div id="midias" className="flex flex-col bg-(--glass-bg) backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_4px_30px_rgba(0,0,0,0.1)] overflow-hidden p-0">
          <div className="px-5 pt-5 pb-3 border-b border-white/10 flex flex-col gap-2.5 shrink-0">
            <h2 className="text-[1rem] font-semibold text-slate-400 tracking-[0.04em] uppercase">📂 Biblioteca de Mídias</h2>
            <div className="flex gap-2">
              <select
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white/90 text-[0.8rem] outline-none transition-colors focus:border-blue-500 [&>option]:bg-slate-900 [&>option]:text-white"
                value={mediaCategory}
                onChange={(e) => setMediaCategory(e.target.value as MediaCategory)}
              >
                <option value="unset">Selecione o tipo</option>
                <option value="musics">Músicas</option>
                <option value="medias">Mídias</option>
                <option value="others">Comerciais / Outros</option>
              </select>

              <select
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white/90 text-[0.8rem] outline-none transition-colors focus:border-blue-500 disabled:opacity-50 [&>option]:bg-slate-900 [&>option]:text-white"
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

            <div className="flex items-center gap-2 bg-white/4 border border-white/10 rounded-lg px-3 py-1.5">
              <span className="text-[0.85rem] opacity-70" aria-hidden>🔍</span>
              <input id="buscaMidia" className="flex-1 bg-transparent border-none outline-none text-white/90 text-[0.85rem] placeholder:text-slate-500"
                placeholder="Buscar mídia..." value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)} />
              {searchQuery && (
                <span className="text-[0.72rem] text-blue-400 font-semibold whitespace-nowrap">
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
                <div className="w-8 h-8 border-3 border-white/10 border-t-blue-500 rounded-full animate-spin-custom" />
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
                        <DraggableMidiaItem
                          file={file}
                          idx={virtualRow.index}
                          isSelected={isSelected}
                          isCueing={isCueing}
                          isCuePlaying={isCuePlaying}
                          onSelect={() => {
                            setSelectedFile(file.path);
                            if (cueRef.current && !isCueing && cuePlaying) {
                              cueRef.current.pause();
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
            <div className="shrink-0 px-4 py-2.5 border-t border-white/10 bg-violet-500/15 flex flex-col gap-1.5">
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
                    if (cueRef.current) { cueRef.current.pause(); cueRef.current.currentTime = 0; }
                    setCuePlaying(false); setCueTime(0); setCueFile(null);
                  }} title="Parar CUE">⏹</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Ghost do drag */}
      <DragOverlay>
        {activeFile && (
          <div className={[
            "flex items-center gap-2.5 px-3 h-12 max-w-[360px] backdrop-blur-md bg-slate-900/90 border rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.4)] cursor-grabbing opacity-95 pointer-events-none",
            isOverPlaylist ? "border-emerald-500/70 bg-[rgba(16,50,35,0.95)] shadow-[0_8px_32px_rgba(52,211,153,0.25)]" : "border-white/20",
          ].join(" ")}>
            <span className="text-base shrink-0" aria-hidden>🎵</span>
            <span className="flex-1 text-[0.82rem] text-white/90 whitespace-nowrap overflow-hidden text-ellipsis">{activeFile.name.replace(/\.[^/.]+$/, "")}</span>
            <span className="text-[0.62rem] bg-white/10 text-slate-400 px-1.5 py-0.5 rounded font-semibold shrink-0">{activeFile.name.split(".").pop()?.toUpperCase()}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

export default App;

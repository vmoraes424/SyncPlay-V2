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

// ─── Tipos ───────────────────────────────────────────────────────────────────

type MediaCategory = 'unset' | 'musics' | 'medias' | 'others';
type DirectoryOptionKind = 'sync' | 'manual' | 'collection' | 'streaming';

type DirectoryOption = {
  value: string;
  label: string;
  kind: DirectoryOptionKind;
};

interface DirFile {
  name: string;
  path: string;
  size_bytes: number;
}

interface MixData {
  mix_init?: number;
  mix_end?: number;
  duration_real?: number;
  duration_total?: number;
  mix_total_milesecond?: number;
}

interface ExtraData {
  mix?: MixData;
}

interface Music {
  text?: string;
  type?: string;
  id?: number;
  start?: number;
  duration?: number;
  path?: string;
  extra?: ExtraData;
}

interface Block {
  type: string;
  musics?: Record<string, Music>;
}

interface Playlist {
  program: string;
  blocks: Record<string, Block>;
}

interface SyncPlayData {
  playlists: Record<string, Playlist>;
}

interface PlayableItem {
  id: string;
  path: string;
  mix_end_ms: number | null;
  duration_ms: number | null;
  fade_duration_ms: number | null;
}

// ─── Tipos de linha achatada (playlist virtualizer) ───────────────────────────

type FlatRowKind =
  | { kind: 'pl-header'; plKey: string; label: string }
  | { kind: 'block-header'; plKey: string; blockKey: string; blockType: string }
  | { kind: 'slot-before'; plKey: string; blockKey: string; musicKey: string }
  | { kind: 'music'; plKey: string; blockKey: string; musicKey: string; music: Music }
  | { kind: 'slot-end'; plKey: string; blockKey: string }
  | { kind: 'block-empty'; plKey: string; blockKey: string };

// ─── Utilitários ─────────────────────────────────────────────────────────────

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

// ─── DroppableSlot ────────────────────────────────────────────────────────────
// Linha fina entre os itens da playlist — torna-se o target do drop.

function DroppableSlot({ id }: { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`drop-slot${isOver ? " drop-slot-active" : ""}`} />;
}

// ─── DraggableMidiaItem ───────────────────────────────────────────────────────

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

// ─── App ─────────────────────────────────────────────────────────────────────

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
  const playableItemsRef = useRef<PlayableItem[]>([]);

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
      const jsonStr: string = await invoke("read_playlist", { date: "2026-04-29" });
      setData(JSON.parse(jsonStr));
    } catch (err) {
      setError(`Erro ao carregar a playlist: ${err}`); setData(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchPlaylist(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target instanceof HTMLElement && e.target.tagName !== "INPUT") {
        e.preventDefault();
        invoke("skip_with_fade").catch(console.error);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!data) return;
    const items: PlayableItem[] = [];
    Object.entries(data.playlists).forEach(([plKey, pl]) =>
      Object.entries(pl.blocks).forEach(([blockKey, block]) => {
        if (block.musics)
          Object.entries(block.musics).forEach(([musicKey, music]) => {
            if (!music.path) return;
            let mix_end_ms = null, duration_ms = null, fade_duration_ms = null;
            if (music.extra?.mix) {
              if (music.extra.mix.mix_end) mix_end_ms = music.extra.mix.mix_end;
              if (music.extra.mix.duration_real) duration_ms = music.extra.mix.duration_real;
              else if (music.extra.mix.duration_total) duration_ms = music.extra.mix.duration_total;
              if (music.extra.mix.mix_total_milesecond) fade_duration_ms = music.extra.mix.mix_total_milesecond;
            }
            items.push({ id: `${plKey}-${blockKey}-${musicKey}`, path: music.path, mix_end_ms, duration_ms, fade_duration_ms });
          });
      })
    );
    playableItemsRef.current = items;
    invoke("set_queue", { items }).catch(console.error);
  }, [data]);

  // ─── DnD ─────────────────────────────────────────────────────────────────────

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

  // ─── Playlist virtualizer ────────────────────────────────────────────────────

  const playlistParentRef = useRef<HTMLDivElement>(null);

  // Achatar a estrutura aninhada em um array flat de linhas
  const flatRows = (() => {
    if (!data) return [] as FlatRowKind[];
    const rows: FlatRowKind[] = [];
    for (const [plKey, pl] of Object.entries(data.playlists)) {
      rows.push({ kind: 'pl-header', plKey, label: pl.program });
      for (const [blockKey, block] of Object.entries(pl.blocks)) {
        rows.push({ kind: 'block-header', plKey, blockKey, blockType: block.type });
        const musicEntries = Object.entries(block.musics ?? {});
        if (musicEntries.length === 0) {
          rows.push({ kind: 'block-empty', plKey, blockKey });
        } else {
          for (const [musicKey, music] of musicEntries) {
            rows.push({ kind: 'slot-before', plKey, blockKey, musicKey });
            rows.push({ kind: 'music', plKey, blockKey, musicKey, music });
          }
          rows.push({ kind: 'slot-end', plKey, blockKey });
        }
      }
    }
    return rows;
  })();

  const ROW_HEIGHTS: Record<FlatRowKind['kind'], number> = {
    'pl-header': 52,
    'block-header': 44,
    'slot-before': 6,
    'music': 90,
    'slot-end': 6,
    'block-empty': 56,
  };

  const playlistVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => playlistParentRef.current,
    estimateSize: (i) => ROW_HEIGHTS[flatRows[i]?.kind] ?? 90,
    overscan: 5,
  });

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-2 gap-8 p-8 h-screen max-w-[1600px] mx-auto">

        {/* ══ COLUNA ESQUERDA (playlist) ══ */}
        <div
          ref={playlistParentRef}
          className={[
            "scrollable-y relative flex flex-col bg-[var(--glass-bg)] backdrop-blur-xl border rounded-2xl p-6 shadow-[0_4px_30px_rgba(0,0,0,0.1)] overflow-y-auto",
            isOverPlaylist
              ? "border-emerald-400/60 shadow-[0_0_0_2px_rgba(52,211,153,0.3),0_4px_30px_rgba(0,0,0,0.1)] bg-slate-800/85"
              : "border-white/10",
          ].join(" ")}
        >
          {loading && <p className="text-center p-8 text-slate-400">Carregando lista...</p>}
          {error && <div className="text-center p-8 text-red-300">{error}</div>}

          {!loading && !error && data && (
            <div
              style={{
                height: `${playlistVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {playlistVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = flatRows[virtualRow.index];
                const style: React.CSSProperties = {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                };

                if (row.kind === 'pl-header') {
                  return (
                    <div key={virtualRow.key} style={style}>
                      <h2 className="playlist-title">{row.label}</h2>
                    </div>
                  );
                }

                if (row.kind === 'block-header') {
                  return (
                    <div key={virtualRow.key} style={style} className="px-1">
                      <div className="flex justify-between items-center mb-3 border-b border-white/5 pb-2">
                        <h3 className="text-base text-slate-400">Bloco {row.blockKey}</h3>
                        <span className={`text-[0.7rem] uppercase tracking-[0.05em] px-2 py-1 rounded font-semibold block-type type-${row.blockType}`}>{row.blockType}</span>
                      </div>
                    </div>
                  );
                }

                if (row.kind === 'slot-before') {
                  return (
                    <div key={virtualRow.key} style={style}>
                      <DroppableSlot id={`slot-before-${row.plKey}|${row.blockKey}|${row.musicKey}`} />
                    </div>
                  );
                }

                if (row.kind === 'slot-end') {
                  return (
                    <div key={virtualRow.key} style={style}>
                      <DroppableSlot id={`slot-end-${row.plKey}|${row.blockKey}`} />
                    </div>
                  );
                }

                if (row.kind === 'block-empty') {
                  return (
                    <div key={virtualRow.key} style={style}>
                      <div className="block-empty-drop relative">
                        <DroppableSlot id={`slot-end-${row.plKey}|${row.blockKey}`} />
                        <p className="absolute inset-0 flex items-center justify-center pointer-events-none m-0 text-[0.8rem] text-slate-400 italic">*(Sem mídias — arraste aqui)*</p>
                      </div>
                    </div>
                  );
                }

                if (row.kind === 'music') {
                  const { plKey, blockKey, musicKey, music } = row;
                  const uniqueId = `${plKey}-${blockKey}-${musicKey}`;
                  const title = music.text || `Mídia: ${music.type}`;
                  const isCurrentlyPlaying = playingId === uniqueId;
                  const isBackgroundPlaying = backgroundIds.includes(uniqueId);

                  const itemClass = [
                    "flex flex-col px-3 py-2 bg-white/[0.02] rounded-md transition-all duration-200 border",
                    isCurrentlyPlaying ? "bg-blue-500/10 border-blue-500/30" :
                      isBackgroundPlaying ? "bg-violet-500/10 border-violet-500/30" :
                        "border-transparent hover:bg-white/5",
                  ].join(" ");

                  let displayDuration = 0;
                  if (music.extra?.mix?.duration_total) displayDuration = music.extra.mix.duration_total / 1000;
                  else if (music.extra?.mix?.duration_real) displayDuration = music.extra.mix.duration_real / 1000;
                  else if (music.duration) displayDuration = music.duration;
                  else if (isCurrentlyPlaying) displayDuration = duration;

                  let itemCurrentTime = 0;
                  if (isCurrentlyPlaying) itemCurrentTime = currentTime;
                  else if (isBackgroundPlaying) itemCurrentTime = (backgroundPositions[uniqueId] || 0) / 1000;

                  const prog = displayDuration ? (itemCurrentTime / displayDuration) * 100 : 0;
                  let mixEnd: number | null = null;
                  if (music.extra?.mix?.mix_end && displayDuration)
                    mixEnd = (music.extra.mix.mix_end / 1000 / displayDuration) * 100;

                  let bgStyle = `linear-gradient(to right, var(--accent-color) ${prog}%, rgba(255,255,255,0.1) ${prog}%)`;
                  if (mixEnd !== null) {
                    bgStyle = prog < mixEnd
                      ? `linear-gradient(to right, var(--accent-color) ${prog}%, rgba(255,255,255,0.1) ${prog}%, rgba(255,255,255,0.1) ${mixEnd}%, rgba(255,100,50,0.4) ${mixEnd}%)`
                      : `linear-gradient(to right, var(--accent-color) ${prog}%, rgba(255,100,50,0.4) ${prog}%)`;
                  }

                  return (
                    <div key={virtualRow.key} style={style}>
                      <div className={itemClass}>
                        <div className="flex justify-between items-center w-full">
                          <div className="flex items-center gap-3 flex-1 overflow-hidden">
                            {music.path && (
                              <button
                                className={[
                                  "w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0 p-0 text-[0.8rem] transition-all duration-200",
                                  isCurrentlyPlaying && isPlaying
                                    ? "bg-red-500 animate-pulse-btn"
                                    : "bg-white/10 hover:bg-blue-500 hover:scale-110",
                                ].join(" ")}
                                onClick={() => togglePlay(uniqueId)}
                                title={isCurrentlyPlaying && isPlaying ? "Pausar" : "Tocar"}
                              >
                                {isCurrentlyPlaying && isPlaying ? "⏸" : "▶"}
                              </button>
                            )}
                            <span className="text-[0.9rem] text-white/90 whitespace-nowrap overflow-hidden text-ellipsis pr-4">{title}</span>
                          </div>
                          {music.type && <span className="text-[0.65rem] bg-white/10 px-1.5 py-0.5 rounded text-slate-400 whitespace-nowrap">{music.type}</span>}
                        </div>
                        <div className="flex items-center gap-3 w-full mt-3 px-2">
                          <span className="text-[0.75rem] text-slate-400 tabular-nums min-w-[35px]">{formatTime(itemCurrentTime)}</span>
                          <input
                            type="range" className="progress-bar"
                            min="0" max={displayDuration || 0} step="0.001"
                            value={itemCurrentTime} onChange={handleSeek}
                            disabled={!isCurrentlyPlaying} style={{ background: bgStyle }}
                          />
                          <span className="text-[0.75rem] text-slate-400 tabular-nums min-w-[35px]">{formatTime(displayDuration)}</span>
                        </div>
                      </div>
                    </div>
                  );
                }

                return null;
              })}
            </div>
          )}
        </div>

        {/* ══ COLUNA DIREITA (#midias) ══ */}
        <div id="midias" className="flex flex-col bg-[var(--glass-bg)] backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_4px_30px_rgba(0,0,0,0.1)] overflow-hidden p-0">
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

            <div className="flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-1.5">
              <span className="text-[0.85rem] opacity-70">🔎</span>
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
                <span className="text-[2.5rem] opacity-50">🎵</span>
                <p>Selecione uma pasta e clique em 🔍 para carregar os arquivos.</p>
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
            <span className="text-base shrink-0">🎵</span>
            <span className="flex-1 text-[0.82rem] text-white/90 whitespace-nowrap overflow-hidden text-ellipsis">{activeFile.name.replace(/\.[^/.]+$/, "")}</span>
            <span className="text-[0.62rem] bg-white/10 text-slate-400 px-1.5 py-0.5 rounded font-semibold shrink-0">{activeFile.name.split(".").pop()?.toUpperCase()}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

export default App;

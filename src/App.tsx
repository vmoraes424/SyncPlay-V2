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
      className={`midia${isSelected ? " selected" : ""}${isCueing ? " cueing" : ""}`}
      title={file.path}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      {...listeners}
      {...attributes}
    >
      <button
        className={`cue-play-btn${isCuePlaying ? " cue-playing" : ""}`}
        title={isCuePlaying ? "Parar CUE" : "Preview CUE"}
        onClick={onCue}
        onPointerDown={e => e.stopPropagation()}
      >
        {isCuePlaying ? "⏸" : "▶"}
      </button>
      <span className="midia-name">{file.name.replace(/\.[^/.]+$/, "")}</span>
      <span className="midia-ext">{file.name.split(".").pop()?.toUpperCase()}</span>
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

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="app-container">

        {/* ══ COLUNA ESQUERDA (playlist) ══ */}
        <div className={`left-column glass-panel scrollable-y${isOverPlaylist ? " drop-over" : ""}`}>
          {loading && <p className="loading-state">Carregando lista...</p>}
          {error && <div className="error-message">{error}</div>}

          {!loading && !error && data && (
            <div className="playlist-list">
              {Object.entries(data.playlists).map(([plKey, pl]) => (
                <div key={plKey} className="playlist-section">
                  <h2 className="playlist-title">{pl.program}</h2>
                  <div className="blocks-list">
                    {Object.entries(pl.blocks).map(([blockKey, block]) => {
                      const musicEntries = Object.entries(block.musics ?? {});
                      return (
                        <div key={blockKey} className="block-item">
                          <div className="block-header">
                            <h3>Bloco {blockKey}</h3>
                            <span className={`block-type type-${block.type}`}>{block.type}</span>
                          </div>

                          {musicEntries.length > 0 ? (
                            <ul className="music-list">
                              {musicEntries.map(([musicKey, music]) => {
                                const uniqueId = `${plKey}-${blockKey}-${musicKey}`;
                                const title = music.text || `Mídia: ${music.type}`;
                                const isCurrentlyPlaying = playingId === uniqueId;
                                const isBackgroundPlaying = backgroundIds.includes(uniqueId);

                                let itemClasses = "music-item";
                                if (isCurrentlyPlaying) itemClasses += " is-playing";
                                if (isBackgroundPlaying) itemClasses += " is-background";

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
                                  <li key={musicKey}>
                                    {/* Slot de drop ANTES deste item */}
                                    <DroppableSlot id={`slot-before-${plKey}|${blockKey}|${musicKey}`} />

                                    <div className={itemClasses}>
                                      <div className="music-item-content">
                                        <div className="music-left-info">
                                          {music.path && (
                                            <button
                                              className={`play-btn${isCurrentlyPlaying && isPlaying ? " playing" : ""}`}
                                              onClick={() => togglePlay(uniqueId)}
                                              title={isCurrentlyPlaying && isPlaying ? "Pausar" : "Tocar"}
                                            >
                                              {isCurrentlyPlaying && isPlaying ? "⏸" : "▶"}
                                            </button>
                                          )}
                                          <span className="music-title">{title}</span>
                                        </div>
                                        {music.type && <span className="music-type-badge">{music.type}</span>}
                                      </div>
                                      <div className="progress-container">
                                        <span className="time-text">{formatTime(itemCurrentTime)}</span>
                                        <input
                                          type="range" className="progress-bar"
                                          min="0" max={displayDuration || 0} step="0.001"
                                          value={itemCurrentTime} onChange={handleSeek}
                                          disabled={!isCurrentlyPlaying} style={{ background: bgStyle }}
                                        />
                                        <span className="time-text">{formatTime(displayDuration)}</span>
                                      </div>
                                    </div>
                                  </li>
                                );
                              })}

                              {/* Slot de drop no FINAL do bloco */}
                              <li><DroppableSlot id={`slot-end-${plKey}|${blockKey}`} /></li>
                            </ul>
                          ) : (
                            <div className="block-empty-drop">
                              <DroppableSlot id={`slot-end-${plKey}|${blockKey}`} />
                              <p className="no-music">*(Sem mídias — arraste aqui)*</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ══ COLUNA DIREITA (#midias) ══ */}
        <div id="midias" className="right-column glass-panel">
          <div className="midias-header">
            <h2 className="midias-title">📂 Biblioteca de Mídias</h2>
            <div className="midias-dir-row selects-row">
              <select 
                className="midias-select" 
                value={mediaCategory} 
                onChange={(e) => setMediaCategory(e.target.value as MediaCategory)}
              >
                <option value="unset">Selecione o tipo</option>
                <option value="musics">Músicas</option>
                <option value="medias">Mídias</option>
                <option value="others">Comerciais / Outros</option>
              </select>

              <select 
                className="midias-select" 
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

            {/* Painéis de filtro baseados nas regras do MD */}
            {mediaCategory !== 'unset' && mediaCategory !== 'others' && (directoryKind === 'sync' || directoryKind === 'collection') && (
              <div className="filters-panel" style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <em>(Painel de filtros: Nacionalidade, Estilo, Ano, etc. visível para {mediaCategory} / {directoryKind})</em>
              </div>
            )}

            <div className="midias-search-row">
              <span className="midias-search-icon">🔎</span>
              <input id="buscaMidia" className="midias-search-input"
                placeholder="Buscar mídia..." value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)} />
              {searchQuery && (
                <span className="midias-result-count">
                  {filteredFiles.length} resultado{filteredFiles.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          <div className="files">
            {dirError && <div className="midias-error">⚠️ {dirError}</div>}
            {!dirLoading && dirFiles.length === 0 && !dirError && (
              <div className="midias-empty">
                <span className="midias-empty-icon">🎵</span>
                <p>Selecione uma pasta e clique em 🔍 para carregar os arquivos.</p>
              </div>
            )}
            {dirLoading && (
              <div className="midias-loading">
                <div className="midias-spinner" />
                <p>Lendo diretório via Rust...</p>
              </div>
            )}
            {!dirLoading && filteredFiles.length > 0 && (
              <div className="list">
                {filteredFiles.map((file, idx) => {
                  const isSelected = selectedFile === file.path;
                  const isCueing = cueFile === file.path;
                  const isCuePlaying = isCueing && cuePlaying;
                  return (
                    <DraggableMidiaItem
                      key={file.path} file={file} idx={idx}
                      isSelected={isSelected} isCueing={isCueing} isCuePlaying={isCuePlaying}
                      onSelect={() => {
                        setSelectedFile(file.path);
                        if (cueRef.current && !isCueing && cuePlaying) {
                          cueRef.current.pause(); setCuePlaying(false);
                        }
                      }}
                      onDoubleClick={() => console.log("[Playlist] Double-click:", file.path)}
                      onCue={e => { e.stopPropagation(); toggleCue(file); }}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {cueFile && (
            <div className="cue-player-bar">
              <div className="cue-player-title">
                <span className="cue-badge">CUE</span>
                <span className="cue-player-name">
                  {cueFile.split(/[\\\/]/).pop()?.replace(/\.[^/.]+$/, "")}
                </span>
              </div>
              <div className="cue-progress-row">
                <span className="cue-time">{formatTime(cueTime)}</span>
                <input type="range" className="cue-progress-bar"
                  min={0} max={isNaN(cueDuration) ? 0 : cueDuration}
                  step={0.01} value={isNaN(cueTime) ? 0 : cueTime} onChange={handleCueSeek} />
                <span className="cue-time">{formatTime(cueDuration)}</span>
                <button className={`cue-stop-btn${cuePlaying ? " active" : ""}`}
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
          <div className={`midia drag-overlay${isOverPlaylist ? " drag-over-target" : ""}`}>
            <span className="drag-overlay-icon">🎵</span>
            <span className="midia-name">{activeFile.name.replace(/\.[^/.]+$/, "")}</span>
            <span className="midia-ext">{activeFile.name.split(".").pop()?.toUpperCase()}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

export default App;

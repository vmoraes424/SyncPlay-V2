import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import "./App.css";

// ─── Tipos da Biblioteca de Mídias ───────────────────────────────────────────

interface DirFile {
  name: string;
  path: string;
  size_bytes: number;
}

// ─── Hook de Virtual List ─────────────────────────────────────────────────────

const ITEM_H = 48;
const BUFFER = 8;

function useVirtualList(items: DirFile[], containerRef: React.RefObject<HTMLDivElement | null>) {
  const [scroll, setScroll] = useState(0);
  const [containerH, setContainerH] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerH(el.clientHeight);
    const onScroll = () => setScroll(el.scrollTop);
    const ro = new ResizeObserver(() => setContainerH(el.clientHeight));
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    return () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); };
  }, [containerRef]);

  const totalH = items.length * ITEM_H;
  const startIdx = Math.max(0, Math.floor(scroll / ITEM_H) - BUFFER);
  const visibleCount = Math.ceil(containerH / ITEM_H) + BUFFER * 2;
  const endIdx = Math.min(items.length, startIdx + visibleCount);
  const offsetTop = startIdx * ITEM_H;

  return { totalH, startIdx, endIdx, offsetTop };
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

function formatTime(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function App() {
  const [data, setData] = useState<SyncPlayData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // State from Rust Audio Engine
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [backgroundIds, setBackgroundIds] = useState<string[]>([]);
  const [backgroundPositions, setBackgroundPositions] = useState<Record<string, number>>({});
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const playableItemsRef = useRef<PlayableItem[]>([]);

  // ─── Estado da Coluna Direita (#midias) ──────────────────────────────────────
  const [dirPath, setDirPath] = useState("C:/SyncPlay/Músicas");
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

  // Virtual List container ref
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Filtered files based on search
  const filteredFiles = dirFiles.filter(f =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const { totalH, startIdx, endIdx, offsetTop } = useVirtualList(filteredFiles, listContainerRef);

  const loadDirectory = useCallback(async (path: string) => {
    if (!path.trim()) return;
    setDirLoading(true);
    setDirError("");
    setDirFiles([]);
    try {
      const files: DirFile[] = await invoke("list_directory", { dirPath: path.trim() });
      setDirFiles(files);
    } catch (e: any) {
      setDirError(String(e));
    } finally {
      setDirLoading(false);
    }
  }, []);

  // CUE handlers
  const toggleCue = useCallback((file: DirFile) => {
    if (!cueRef.current) {
      cueRef.current = new Audio();
      cueRef.current.ontimeupdate = () => setCueTime(cueRef.current!.currentTime);
      cueRef.current.ondurationchange = () => setCueDuration(cueRef.current!.duration);
      cueRef.current.onended = () => { setCuePlaying(false); setCueTime(0); };
    }
    const audio = cueRef.current;
    if (cueFile === file.path && cuePlaying) {
      audio.pause();
      setCuePlaying(false);
    } else if (cueFile === file.path && !cuePlaying) {
      audio.play().then(() => setCuePlaying(true));
    } else {
      audio.pause();
      audio.src = convertFileSrc(file.path);
      setCueFile(file.path);
      setCueTime(0);
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
        if (isPlaying) {
          await invoke("pause_audio");
        } else {
          await invoke("resume_audio");
        }
      } else {
        const idx = playableItemsRef.current.findIndex(i => i.id === uniqueId);
        if (idx !== -1) {
          await invoke("play_index", { index: idx });
        }
      }
    } catch (e) {
      console.error("Audio Command Error:", e);
    }
  };

  const handleSeek = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const time_sec = Number(e.target.value);
    setCurrentTime(time_sec);
    try {
      await invoke("seek_audio", { positionMs: Math.floor(time_sec * 1000) });
    } catch (err) {
      console.error(err);
    }
  };

  // Poll state from Rust Engine
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
          setPlayingId(null);
          setIsPlaying(false);
          setBackgroundIds(state.background_ids || []);
          setBackgroundPositions(state.background_positions || {});
        }
      } catch (e) {
        console.error(e);
      }
    }, 33);
    return () => clearInterval(interval);
  }, []);

  const fetchPlaylist = async () => {
    try {
      const jsonStr: string = await invoke("read_playlist", { date: "2026-04-29" });
      const parsedData: SyncPlayData = JSON.parse(jsonStr);
      setData(parsedData);
    } catch (err) {
      setError(`Erro ao carregar a playlist: ${err}`);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlaylist();
  }, []);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Pula para a próxima com crossfade ao apertar a barra de espaço
      if (e.code === "Space" && e.target instanceof HTMLElement && e.target.tagName !== "INPUT") {
        e.preventDefault();
        invoke("skip_with_fade").catch(console.error);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Update Rust queue when data arrives
  useEffect(() => {
    if (!data) return;
    const items: PlayableItem[] = [];
    Object.entries(data.playlists).forEach(([plKey, pl]) => {
      Object.entries(pl.blocks).forEach(([blockKey, block]) => {
        if (block.musics) {
          Object.entries(block.musics).forEach(([musicKey, music]) => {
            if (music.path) {

              let mix_end_ms = null;
              let duration_ms = null;
              let fade_duration_ms = null;

              if (music.extra?.mix) {
                if (music.extra.mix.mix_end) mix_end_ms = music.extra.mix.mix_end;
                if (music.extra.mix.duration_real) duration_ms = music.extra.mix.duration_real;
                else if (music.extra.mix.duration_total) duration_ms = music.extra.mix.duration_total;

                if (music.extra.mix.mix_total_milesecond) fade_duration_ms = music.extra.mix.mix_total_milesecond;
              }

              items.push({
                id: `${plKey}-${blockKey}-${musicKey}`,
                path: music.path,
                mix_end_ms,
                duration_ms,
                fade_duration_ms
              });
            }
          });
        }
      });
    });
    playableItemsRef.current = items;
    invoke("set_queue", { items }).catch(console.error);
  }, [data]);

  // Progress percentage calculation moved to inside the loop.

  return (
    <div className="app-container">
      <div className="left-column glass-panel scrollable-y">
        {loading && <p className="loading-state">Carregando lista...</p>}
        {error && <div className="error-message">{error}</div>}

        {!loading && !error && data && (
          <div className="playlist-list">
            {Object.entries(data.playlists).map(([plKey, pl]) => (
              <div key={plKey} className="playlist-section">
                <h2 className="playlist-title">{pl.program}</h2>

                <div className="blocks-list">
                  {Object.entries(pl.blocks).map(([blockKey, block]) => (
                    <div key={blockKey} className="block-item">
                      <div className="block-header">
                        <h3>Bloco {blockKey}</h3>
                        <span className={`block-type type-${block.type}`}>
                          {block.type}
                        </span>
                      </div>

                      {block.musics && Object.keys(block.musics).length > 0 ? (
                        <ul className="music-list">
                          {Object.entries(block.musics).map(([musicKey, music]) => {
                            const uniqueId = `${plKey}-${blockKey}-${musicKey}`;
                            const title = music.text || `Mídia: ${music.type}`;
                            const isCurrentlyPlaying = playingId === uniqueId;
                            const isBackgroundPlaying = backgroundIds.includes(uniqueId);

                            let itemClasses = "music-item";
                            if (isCurrentlyPlaying) itemClasses += " is-playing";
                            if (isBackgroundPlaying) itemClasses += " is-background";

                            let displayDuration = 0;
                            if (music.extra?.mix?.duration_total) {
                              displayDuration = music.extra.mix.duration_total / 1000;
                            } else if (music.extra?.mix?.duration_real) {
                              displayDuration = music.extra.mix.duration_real / 1000;
                            } else if (music.duration) {
                              displayDuration = music.duration;
                            } else if (isCurrentlyPlaying) {
                              displayDuration = duration;
                            }

                            let itemCurrentTime = 0;
                            if (isCurrentlyPlaying) {
                              itemCurrentTime = currentTime;
                            } else if (isBackgroundPlaying) {
                              itemCurrentTime = (backgroundPositions[uniqueId] || 0) / 1000;
                            }

                            let itemProgressPercentage = displayDuration ? (itemCurrentTime / displayDuration) * 100 : 0;
                            let mixEndPercentage: number | null = null;
                            
                            if (music.extra?.mix?.mix_end && displayDuration) {
                              mixEndPercentage = (music.extra.mix.mix_end / 1000 / displayDuration) * 100;
                            }
                            
                            let bgStyle = `linear-gradient(to right, var(--accent-color) ${itemProgressPercentage}%, rgba(255, 255, 255, 0.1) ${itemProgressPercentage}%)`;
                            if (mixEndPercentage !== null) {
                              if (itemProgressPercentage < mixEndPercentage) {
                                bgStyle = `linear-gradient(to right, var(--accent-color) ${itemProgressPercentage}%, rgba(255, 255, 255, 0.1) ${itemProgressPercentage}%, rgba(255, 255, 255, 0.1) ${mixEndPercentage}%, rgba(255, 100, 50, 0.4) ${mixEndPercentage}%)`;
                              } else {
                                bgStyle = `linear-gradient(to right, var(--accent-color) ${itemProgressPercentage}%, rgba(255, 100, 50, 0.4) ${itemProgressPercentage}%)`;
                              }
                            }

                            return (
                              <li key={musicKey} className={itemClasses}>
                                <div className="music-item-content">
                                  <div className="music-left-info">
                                    {music.path && (
                                      <button
                                        className={`play-btn ${isCurrentlyPlaying && isPlaying ? 'playing' : ''}`}
                                        onClick={() => togglePlay(uniqueId)}
                                        title={isCurrentlyPlaying && isPlaying ? "Pausar" : "Tocar"}
                                      >
                                        {isCurrentlyPlaying && isPlaying ? "⏸" : "▶"}
                                      </button>
                                    )}
                                    <span className="music-title">{title}</span>
                                  </div>
                                  {music.type && (
                                    <span className="music-type-badge">{music.type}</span>
                                  )}
                                </div>

                                  <div className="progress-container">
                                    <span className="time-text">{formatTime(itemCurrentTime)}</span>
                                    <input
                                      type="range"
                                      className="progress-bar"
                                      min="0"
                                      max={displayDuration || 0}
                                      step="0.001"
                                      value={itemCurrentTime}
                                      onChange={handleSeek}
                                      disabled={!isCurrentlyPlaying}
                                      style={{ background: bgStyle }}
                                    />
                                    <span className="time-text">{formatTime(displayDuration)}</span>
                                  </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="no-music">*(Sem mídias neste bloco)*</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div id="midias" className="right-column glass-panel">

        {/* ── Header: seleção de pasta ─────────────────────────────────── */}
        <div className="midias-header">
          <h2 className="midias-title">📂 Biblioteca de Mídias</h2>
          <div className="midias-dir-row">
            <input
              id="midias-dir-input"
              className="midias-dir-input"
              value={dirPath}
              onChange={e => setDirPath(e.target.value)}
              onKeyDown={e => e.key === "Enter" && loadDirectory(dirPath)}
              placeholder="Caminho da pasta..."
              spellCheck={false}
            />
            <button
              id="midias-load-btn"
              className="midias-load-btn"
              onClick={() => loadDirectory(dirPath)}
              disabled={dirLoading}
              title="Carregar pasta"
            >
              {dirLoading ? "⏳" : "🔍"}
            </button>
          </div>

          {/* ── Busca ──────────────────────────────────────────────────── */}
          <div className="midias-search-row">
            <span className="midias-search-icon">🔎</span>
            <input
              id="buscaMidia"
              className="midias-search-input"
              placeholder="Buscar mídia..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <span className="midias-result-count">
                {filteredFiles.length} resultado{filteredFiles.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        {/* ── Área de arquivos (.files) ────────────────────────────────── */}
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

          {/* Virtual List container (.list) */}
          {!dirLoading && filteredFiles.length > 0 && (
            <div className="list" ref={listContainerRef}>
              <div style={{ height: totalH, position: "relative" }}>
                <div style={{ position: "absolute", top: offsetTop, left: 0, right: 0 }}>
                  {filteredFiles.slice(startIdx, endIdx).map((file, relIdx) => {
                    const absIdx = startIdx + relIdx;
                    const isSelected = selectedFile === file.path;
                    const isCueing = cueFile === file.path;
                    const isCuePlaying = isCueing && cuePlaying;

                    return (
                      <div
                        key={file.path}
                        id={`midia-item-${absIdx}`}
                        className={`midia${isSelected ? " selected" : ""}${isCueing ? " cueing" : ""}`}
                        style={{ height: ITEM_H }}
                        title={file.path}
                        onClick={() => {
                          setSelectedFile(file.path);
                          if (cueRef.current && !isCueing && cuePlaying) {
                            cueRef.current.pause();
                            setCuePlaying(false);
                          }
                        }}
                        onDoubleClick={() => {
                          // TODO: inserir na playlist (createAndInsertMidia)
                          console.log("[Playlist] Inserir:", file.path);
                        }}
                      >
                        <button
                          className={`cue-play-btn${isCuePlaying ? " cue-playing" : ""}`}
                          title={isCuePlaying ? "Parar CUE" : "Preview CUE"}
                          onClick={e => { e.stopPropagation(); toggleCue(file); }}
                        >
                          {isCuePlaying ? "⏸" : "▶"}
                        </button>

                        <span className="midia-name">
                          {file.name.replace(/\.[^/.]+$/, "")}
                        </span>

                        <span className="midia-ext">
                          {file.name.split(".").pop()?.toUpperCase()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── CUE Mini-Player (rodapé) ─────────────────────────────────── */}
        {cueFile && (
          <div className="cue-player-bar">
            <div className="cue-player-title">
              <span className="cue-badge">CUE</span>
              <span className="cue-player-name">
                {cueFile.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, "")}
              </span>
            </div>
            <div className="cue-progress-row">
              <span className="cue-time">{formatTime(cueTime)}</span>
              <input
                type="range"
                className="cue-progress-bar"
                min={0}
                max={isNaN(cueDuration) ? 0 : cueDuration}
                step={0.01}
                value={isNaN(cueTime) ? 0 : cueTime}
                onChange={handleCueSeek}
              />
              <span className="cue-time">{formatTime(cueDuration)}</span>
              <button
                className={`cue-stop-btn${cuePlaying ? " active" : ""}`}
                onClick={() => {
                  if (cueRef.current) { cueRef.current.pause(); cueRef.current.currentTime = 0; }
                  setCuePlaying(false);
                  setCueTime(0);
                  setCueFile(null);
                }}
                title="Parar CUE"
              >
                ⏹
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

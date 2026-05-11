import type { CSSProperties, Dispatch, RefObject, SetStateAction } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import { invoke } from '@tauri-apps/api/core';
import { formatTime } from '../../time';
import type { DirFile, DirectoryOption, DirectoryOptionKind, MediaCategory } from '../../types';
import type { LibMusicFiltersState } from '../../hooks/useSyncplayLibrary';
import { LibraryMediaListItem } from './LibraryMediaListItem';

export interface LibraryColumnProps {
  col2Style: CSSProperties;
  libraryYearDecade: boolean;
  mediaCategory: MediaCategory;
  setMediaCategory: Dispatch<SetStateAction<MediaCategory>>;
  directoryOptions: DirectoryOption[];
  directoryValue: string;
  setDirectoryValue: Dispatch<SetStateAction<string>>;
  setDirectoryKind: Dispatch<SetStateAction<DirectoryOptionKind>>;
  libMusicFilterIds: LibMusicFiltersState;
  setLibMusicFilterIds: Dispatch<SetStateAction<LibMusicFiltersState>>;
  resetLibMusicFilters: () => void;
  musicCategoryMap: Record<string, string>;
  musicStyleMap: Record<string, string>;
  musicRhythmMap: Record<string, string>;
  musicNationalityMap: Record<string, string>;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  filteredFiles: DirFile[];
  dirError: string;
  dirLoading: boolean;
  dirFiles: DirFile[];
  parentRef: RefObject<HTMLDivElement | null>;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  selectedFile: string | null;
  setSelectedFile: Dispatch<SetStateAction<string | null>>;
  cueFile: string | null;
  setCueFile: Dispatch<SetStateAction<string | null>>;
  cuePlaying: boolean;
  setCuePlaying: Dispatch<SetStateAction<boolean>>;
  cueTime: number;
  setCueTime: Dispatch<SetStateAction<number>>;
  cueDuration: number;
  toggleCue: (file: DirFile) => void | Promise<void>;
  handleCueSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function LibraryColumn({
  col2Style,
  libraryYearDecade,
  mediaCategory,
  setMediaCategory,
  directoryOptions,
  directoryValue,
  setDirectoryValue,
  setDirectoryKind,
  libMusicFilterIds,
  setLibMusicFilterIds,
  resetLibMusicFilters,
  musicCategoryMap,
  musicStyleMap,
  musicRhythmMap,
  musicNationalityMap,
  searchQuery,
  setSearchQuery,
  filteredFiles,
  dirError,
  dirLoading,
  dirFiles,
  parentRef,
  rowVirtualizer,
  selectedFile,
  setSelectedFile,
  cueFile,
  setCueFile,
  cuePlaying,
  setCuePlaying,
  cueTime,
  setCueTime,
  cueDuration,
  toggleCue,
  handleCueSeek,
}: LibraryColumnProps) {
  return (
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
                const isCuePlayingRow = isCueing && cuePlaying;

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
                      isCuePlaying={isCuePlayingRow}
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
  );
}

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Virtualizer } from '@tanstack/react-virtual';
import { invoke } from '@tauri-apps/api/core';
import type { DirFile, DirectoryOption, DirectoryOptionKind, MediaCategory } from '../../../types';
import { hasAnyLibMusicFacet, type LibMusicFiltersState } from '../../../hooks/useSyncplayLibrary';
import { normalizeMediaPathKey } from '../../../playlist/playlistBlockHelpers';
import { LibraryMediaListItem } from '../LibraryMediaListItem';
import { Funnel, X } from 'lucide-react';

export interface LibraryAcervoPanelProps {
  hidden?: boolean;
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
  cuePlaying: boolean;
  setCuePlaying: Dispatch<SetStateAction<boolean>>;
  toggleCue: (file: DirFile) => void | Promise<void>;
  playlistStationCode?: string;
  libraryReloadBusy: boolean;
  libraryReloadError: string;
  onReloadLibrary: () => void;
  playlistMediaPathKeys: ReadonlySet<string>;
}

export function LibraryAcervoPanel({
  hidden,
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
  cuePlaying,
  setCuePlaying,
  toggleCue,
  playlistStationCode,
  libraryReloadBusy,
  libraryReloadError,
  onReloadLibrary,
  playlistMediaPathKeys,
}: LibraryAcervoPanelProps) {
  const [musicFiltersModalOpen, setMusicFiltersModalOpen] = useState(false);
  const [musicFiltersPopoverRect, setMusicFiltersPopoverRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const musicSelectsRowRef = useRef<HTMLDivElement | null>(null);
  const musicFiltersTriggerRef = useRef<HTMLButtonElement | null>(null);
  const musicFiltersPopoverRef = useRef<HTMLDivElement | null>(null);

  const updateMusicFiltersPopoverPosition = () => {
    const anchor = musicSelectsRowRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const gutter = 8;
    const minW = Math.min(Math.max(r.width, 272), window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - minW - 8));
    setMusicFiltersPopoverRect({
      top: r.top - gutter,
      left,
      width: minW,
    });
  };

  useLayoutEffect(() => {
    if (!musicFiltersModalOpen || hidden || mediaCategory !== 'musics') return;
    updateMusicFiltersPopoverPosition();
    const onResizeScroll = () => updateMusicFiltersPopoverPosition();
    window.addEventListener('resize', onResizeScroll);
    window.addEventListener('scroll', onResizeScroll, true);
    return () => {
      window.removeEventListener('resize', onResizeScroll);
      window.removeEventListener('scroll', onResizeScroll, true);
    };
  }, [musicFiltersModalOpen, hidden, mediaCategory]);

  useEffect(() => {
    if (!musicFiltersModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMusicFiltersModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [musicFiltersModalOpen]);

  useEffect(() => {
    if (!musicFiltersModalOpen) return;
    const onPointerDown = (e: MouseEvent | PointerEvent) => {
      const t = e.target as Node;
      if (musicFiltersPopoverRef.current?.contains(t)) return;
      if (musicFiltersTriggerRef.current?.contains(t)) return;
      setMusicFiltersModalOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [musicFiltersModalOpen]);

  useEffect(() => {
    if (mediaCategory !== 'musics') setMusicFiltersModalOpen(false);
  }, [mediaCategory]);

  useEffect(() => {
    if (hidden) setMusicFiltersModalOpen(false);
  }, [hidden]);

  useEffect(() => {
    if (!musicFiltersModalOpen) setMusicFiltersPopoverRect(null);
  }, [musicFiltersModalOpen]);

  const filtersOrSearchDirty =
    hasAnyLibMusicFacet(libMusicFilterIds) || searchQuery.trim().length > 0;

  const clearFiltersAndMediaSearch = () => {
    resetLibMusicFilters();
    setSearchQuery('');
  };

  return (
    <div
      id="library-tabpanel-acervo"
      role="tabpanel"
      aria-labelledby="library-tab-acervo"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#1e1e1e]"
      hidden={hidden}
    >
      <div className="flex flex-col gap-2 shrink-0 pb-2 ">
        <div ref={musicSelectsRowRef} className="flex min-w-0 w-full gap-0.5 bg-[#363636] pb-1">
          <select
            className="min-w-0 flex-1 bg-[#262626] border border-[#353535] px-3 py-1.5 text-white/90 text-[0.8rem] outline-none transition-colors focus:border-neutral-500 [&>option]:bg-[#262626] [&>option]:text-white"
            value={mediaCategory}
            onChange={(e) => setMediaCategory(e.target.value as MediaCategory)}
          >
            <option value="unset">Selecione o tipo</option>
            <option value="musics">Músicas</option>
            <option value="medias">Mídias</option>
            <option value="others">Comerciais / Outros</option>
          </select>

          <select
            className="min-w-0 flex-1 bg-[#262626] border border-[#353535] px-3 py-1.5 text-white/90 text-[0.8rem] outline-none transition-colors focus:border-neutral-500 disabled:opacity-50 [&>option]:bg-[#262626] [&>option]:text-white"
            value={directoryValue}
            onChange={(e) => {
              setDirectoryValue(e.target.value);
              const opt = directoryOptions.find((o) => o.value === e.target.value);
              if (opt) setDirectoryKind(opt.kind);
            }}
            disabled={mediaCategory === 'unset'}
          >
            {mediaCategory === 'unset' ? (
              <option value="" disabled>
                Selecione o tipo primeiro
              </option>
            ) : (
              directoryOptions.map((opt) => (
                <option key={`${opt.kind}-${opt.value}`} value={opt.value}>
                  {opt.label}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="flex w-full min-w-0 items-center gap-2 px-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#353535] bg-white/3 px-3 py-1.5">
            <span className="shrink-0 text-[0.85rem] opacity-70" aria-hidden>
              🔍
            </span>
            <input
              id="buscaMidia"
              className="min-w-0 flex-1 bg-transparent border-none text-[0.85rem] text-white/90 outline-none placeholder:text-slate-500"
              placeholder="Buscar mídia..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <span className="shrink-0 whitespace-nowrap text-[0.72rem] font-semibold text-neutral-400">
                {filteredFiles.length} resultado{filteredFiles.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="Limpar filtros de música e busca"
            title="Limpar filtros de música e busca"
            onClick={() => clearFiltersAndMediaSearch()}
            className={`shrink-0 rounded cursor-pointer p-0.5 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-neutral-500 ${filtersOrSearchDirty ? 'text-white' : 'text-[#323232]'
              }`}
          >
            <svg
              id="clean-filter"
              xmlns="http://www.w3.org/2000/svg"
              height="24px"
              viewBox="0 -960 960 960"
              width="24px"
              className="pointer-events-none"
              aria-hidden
              fill="currentColor"
            >
              <path d="M690-240h190v80H610l80-80Zm-500 80-85-85q-23-23-23.5-57t22.5-58l440-456q23-24 56.5-24t56.5 23l199 199q23 23 23 57t-23 57L520-160H190Zm296-80 314-322-198-198-442 456 64 64h262Zm-6-240Z" />
              <path d="M190-160h330l314-322-198-198-442 456 64 64h32Z" />
            </svg>
          </button>
          <button
            ref={musicFiltersTriggerRef}
            type="button"
            disabled={mediaCategory !== 'musics'}
            title={mediaCategory === 'musics' ? 'Filtros de música' : 'Selecione Músicas para filtrar'}
            aria-label="Abrir filtros de música"
            aria-expanded={musicFiltersModalOpen}
            aria-haspopup="dialog"
            className="shrink-0 rounded cursor-pointer p-0.5 text-[#e3e3e3] outline-none transition-opacity enabled:hover:bg-white/10 enabled:focus-visible:ring-2 enabled:focus-visible:ring-neutral-500 disabled:cursor-not-allowed disabled:opacity-35"
            onClick={() => setMusicFiltersModalOpen((o) => !o)}
          >
            <Funnel className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={
              playlistStationCode
                ? 'Recarregar biblioteca desde a API Superaudio'
                : 'Recarregar biblioteca (indisponível sem código da estação na playlist)'
            }
            title={
              playlistStationCode
                ? 'Recarregar biblioteca desde a API (sincronizar acervo)'
                : 'É necessário o campo header.extra.station na playlist.'
            }
            disabled={libraryReloadBusy || !playlistStationCode}
            id="reloadLibrary"
            onClick={() => onReloadLibrary()}
            className="shrink-0 rounded cursor-pointer p-0.5 text-[#e3e3e3] outline-none transition-colors enabled:hover:bg-white/10 enabled:focus-visible:ring-2 enabled:focus-visible:ring-neutral-500 disabled:opacity-35 disabled:cursor-not-allowed"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="24px"
              viewBox="0 -960 960 960"
              width="24px"
              fill="currentColor"
              className="pointer-events-none"
              aria-hidden
            >
              <path d="M186.67-186.67v-586.66 586.66ZM280-613.33h400V-680H280v66.67Zm0 166.66h214q18.61-20.06 40.47-37.19Q556.33-501 581-513.33H280v66.66ZM280-280h135.77q2.23-17.67 6.38-34.28t10.18-32.39H280V-280Zm-93.33 160q-27.5 0-47.09-19.58Q120-159.17 120-186.67v-586.66q0-27.5 19.58-47.09Q159.17-840 186.67-840h586.66q27.5 0 47.09 19.58Q840-800.83 840-773.33v251q-15.67-6.67-32.33-11.84-16.67-5.16-34.34-7.83v-231.33H186.67v586.66H418q2.67 17.67 7.83 34.34Q431-135.67 437.67-120h-251ZM720-40q-73 0-127.5-45.5T524-200h62q13 44 49.5 72t84.5 28q58 0 99-41t41-99q0-58-41-99t-99-41q-29 0-54 10.5T622-340h58v60H520v-160h60v57q27-26 63-41.5t77-15.5q83 0 141.5 58.5T920-240q0 83-58.5 141.5T720-40Z" />
            </svg>
          </button>
        </div>
      </div>

      {musicFiltersModalOpen &&
        mediaCategory === 'musics' &&
        musicFiltersPopoverRect &&
        createPortal(
          <div
            ref={musicFiltersPopoverRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby="library-music-filters-title"
            style={{
              position: 'fixed',
              zIndex: 100,
              top: musicFiltersPopoverRect.top,
              left: musicFiltersPopoverRect.left,
              width: musicFiltersPopoverRect.width,
              transform: 'translateY(-100%)',
            }}
            className="flex max-h-[min(70vh,440px)] flex-col gap-3 overflow-y-auto rounded-xl border border-[#353535]/80 bg-[#1e1e1e] p-3 shadow-xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[#353535]/80 pb-2">
              <h2 id="library-music-filters-title" className="text-[0.9rem] font-semibold text-white/90">
                Filtros de música
              </h2>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
                aria-label="Fechar"
                onClick={() => setMusicFiltersModalOpen(false)}
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2 items-center justify-between w-full flex-row">
                <select
                  className="min-w-[120px] flex-1 bg-white/5 border border-[#353535] rounded-lg px-2 py-1.5 text-white/90 text-[0.72rem] outline-none focus:border-neutral-500 [&>option]:bg-[#262626]"
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
                  className="min-w-[120px] flex-1 bg-white/5 border border-[#353535] rounded-lg px-2 py-1.5 text-white/90 text-[0.72rem] outline-none focus:border-neutral-500 [&>option]:bg-[#262626]"
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
                  className="min-w-[120px] flex-1 bg-white/5 border border-[#353535] rounded-lg px-2 py-1.5 text-white/90 text-[0.72rem] outline-none focus:border-neutral-500 [&>option]:bg-[#262626]"
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
                  className="min-w-[120px] flex-1 bg-white/5 border border-[#353535] rounded-lg px-2 py-1.5 text-white/90 text-[0.72rem] outline-none focus:border-neutral-500 [&>option]:bg-[#262626]"
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
              <div className="flex flex-wrap gap-2 items-center justify-between w-full flex-row">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={libraryYearDecade ? 'Ano min (década)' : 'Ano min'}
                  className="min-w-[120px] flex-1 bg-white/5 border border-[#353535] rounded-lg px-2 py-1.5 text-white/90 text-[0.72rem] outline-none focus:border-neutral-500"
                  value={libMusicFilterIds.yearMin}
                  onChange={(e) =>
                    setLibMusicFilterIds((prev) => ({ ...prev, yearMin: e.target.value }))
                  }
                />
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={libraryYearDecade ? 'Ano máx' : 'Ano máx'}
                  className="min-w-[120px] flex-1 bg-white/5 border border-[#353535] rounded-lg px-2 py-1.5 text-white/90 text-[0.72rem] outline-none focus:border-neutral-500"
                  value={libMusicFilterIds.yearMax}
                  onChange={(e) =>
                    setLibMusicFilterIds((prev) => ({ ...prev, yearMax: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>,
          document.body,
        )}

      <div className="flex-1 overflow-hidden flex flex-col relative min-h-0">
        {(dirError || libraryReloadError) && (
          <div className="m-3 px-3 py-2 bg-red-500/12 border border-red-500/30 rounded-lg text-red-300 text-[0.82rem]">
            ⚠️ {libraryReloadError || dirError}
          </div>
        )}
        {!dirLoading &&
          !libraryReloadBusy &&
          dirFiles.length === 0 &&
          !dirError &&
          !libraryReloadError && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 text-[0.88rem] text-center p-8">
              <span className="text-[2.5rem] opacity-50" aria-hidden>
                🎵
              </span>
              <p>Selecione uma pasta e carregue os arquivos (🔍 acima).</p>
            </div>
          )}
        {libraryReloadBusy && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 text-[0.88rem]">
            <div className="w-8 h-8 border-3 border-[#353535] border-t-neutral-400 rounded-full animate-spin-custom" />
            <p>Sincronizando biblioteca com a API…</p>
          </div>
        )}
        {dirLoading && !libraryReloadBusy && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 text-[0.88rem]">
            <div className="w-8 h-8 border-3 border-[#353535] border-t-neutral-400 rounded-full animate-spin-custom" />
            <p>Lendo diretório...</p>
          </div>
        )}
        {!dirLoading && !libraryReloadBusy && filteredFiles.length > 0 && (
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
                      mediaCategory={mediaCategory}
                      idx={virtualRow.index}
                      isSelected={isSelected}
                      isCueing={isCueing}
                      isCuePlaying={isCuePlayingRow}
                      inPlaylist={playlistMediaPathKeys.has(normalizeMediaPathKey(file.path))}
                      onSelect={() => {
                        setSelectedFile(file.path);
                        if (!isCueing && cuePlaying) {
                          invoke('stop_independent', { id: 'cue-player' }).catch(console.error);
                          setCuePlaying(false);
                        }
                      }}
                      onDoubleClick={() => console.log('[Playlist] Double-click:', file.path)}
                      onCue={(e) => {
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
    </div>
  );
}

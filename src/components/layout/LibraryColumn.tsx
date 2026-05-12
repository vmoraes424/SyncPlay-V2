import { useEffect, useState, type CSSProperties, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import { invoke } from '@tauri-apps/api/core';
import { formatPlaylistDayShortPt, formatTime } from '../../time';
import type { DirFile, DirectoryOption, DirectoryOptionKind, MediaCategory } from '../../types';
import type { LibMusicFiltersState } from '../../hooks/useSyncplayLibrary';
import { LibraryAcervoPanel } from './library-column/LibraryAcervoPanel';
import { LibraryColumnTabBar } from './library-column/LibraryColumnTabBar';
import { LibraryIaTab } from './library-column/LibraryIaTab';
import { LibraryTocouTab } from './library-column/LibraryTocouTab';
import type { LibraryColumnTabId } from './library-column/types';

export interface WeatherCurrentPayload {
  cityLabel: string;
  icon: string;
  description: string;
  temperatureC: number;
  weathercode: number;
  title: string;
}

export interface LibraryColumnProps {
  col2Style: CSSProperties;
  /** Data da playlist carregada (`YYYY-MM-DD`), exibe abaixo do nome da filial. */
  playlistDateYmd: string;
  branchName?: string;
  branchImgUrl?: string;
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
  playlistDateYmd,
  branchName,
  branchImgUrl,
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
  const [libraryTab, setLibraryTab] = useState<LibraryColumnTabId>('acervo');
  const dayLabel = formatPlaylistDayShortPt(playlistDateYmd);
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<WeatherCurrentPayload | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadWeather = async () => {
      try {
        const data = await invoke<WeatherCurrentPayload | null>('fetch_weather_current');
        if (!cancelled) setWeather(data);
      } catch (err) {
        console.warn('[Weather] Erro ao buscar clima:', err);
        if (!cancelled) setWeather(null);
      }
    };
    void loadWeather();
    const weatherIntervalMs = 15 * 60 * 1000;
    const wxId = window.setInterval(() => void loadWeather(), weatherIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(wxId);
    };
  }, []);

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  return (
    <div
      id="midias"
      className="flex flex-col overflow-hidden p-0 bg-[#262626]"
      style={col2Style}
    >
      <div className="border-b border-[#353535] flex flex-col gap-2.5 shrink-0">
        <div className="flex items-center justify-between gap-3 min-w-0 pr-2 ">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            {branchImgUrl ? (
              <img
                src={branchImgUrl}
                alt=""
                className="w-14 h-14 rounded-lg object-cover bg-black/25 shrink-0 border border-[#353535]"
              />
            ) : null}
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              {branchName ? (
                <span className="text-[10px] font-semibold text-white">{branchName}</span>
              ) : null}
              {dayLabel ? (
                <span className="text-sm text-white font-bold leading-snug">{dayLabel}</span>
              ) : null}
            </div>
          </div>
          <div
            className="flex items-baseline shrink-0 tabular-nums leading-none text-white/90"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="text-4xl font-semibold tracking-tight">{hh}:{mm}</span>
            <span className="text-xs font-medium text-[#818181]">:{ss}</span>
          </div>
        </div>
        {weather ? (
          <div
            id="weather-widget"
            className="flex items-center gap-2.5 px-2.5 rounded-lg text-white min-w-0"
            title={weather.title}
          >
            <span id="weather-icon" className="text-xl leading-none shrink-0" aria-hidden>
              {weather.icon}
            </span>
            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
              <span id="weather-city" className="text-[0.72rem] font-semibold truncate">
                {weather.cityLabel}
              </span>
              <span id="weather-desc" className="text-[0.65rem] text-[#818181] truncate">
                {weather.description}
              </span>
            </div>
            <span id="weather-temp" className="text-sm font-bold tabular-nums shrink-0 text-white">
              {weather.temperatureC}°C
            </span>
          </div>
        ) : null}
      </div>

      <LibraryColumnTabBar active={libraryTab} onChange={setLibraryTab} />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <LibraryAcervoPanel
          hidden={libraryTab !== 'acervo'}
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
          cuePlaying={cuePlaying}
          setCuePlaying={setCuePlaying}
          toggleCue={toggleCue}
        />
        {libraryTab === 'ia' ? <LibraryIaTab /> : null}
        {libraryTab === 'tocou' ? <LibraryTocouTab /> : null}
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

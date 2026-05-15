import { useEffect, useState, type CSSProperties, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import { invoke } from '@tauri-apps/api/core';
import { Music2 } from 'lucide-react';
import pauseBco from '../../assets/pause.png';
import pauseLoad from '../../assets/pause_load.gif';
import playVerde from '../../assets/play_verde.png';
import stopBco from '../../assets/stop_bco.png';
import { formatPlaylistDayShortPt, formatTime } from '../../time';
import type { DirFile, DirectoryOption, DirectoryOptionKind, MediaCategory } from '../../types';
import type { LibMusicFiltersState } from '../../hooks/useSyncplayLibrary';
import { LibraryAcervoPanel } from './library-column/LibraryAcervoPanel';
import { LibraryColumnTabBar } from './library-column/LibraryColumnTabBar';
import { LibraryIaTab } from './library-column/LibraryIaTab';
import { LibraryTocouTab } from './library-column/LibraryTocouTab';
import type { LibraryColumnTabId } from './library-column/types';
import { MarqueeText } from '../MarqueeText';

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
  cuePlaying: boolean;
  setCuePlaying: Dispatch<SetStateAction<boolean>>;
  cueTime: number;
  cueDuration: number;
  toggleCue: (file: DirFile) => void | Promise<void>;
  toggleCuePlaybackToolbar: () => void | Promise<void>;
  stopCuePlayer: () => void | Promise<void>;
  handleCueSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Presente quando a playlist expõe `header.extra.station` (sync API acervo). */
  playlistStationCode?: string;
  /** `X-SyncPlay-SN` — prioriza `sn` do arquivo `%LOCALAPPDATA%\\SuperAudio\\configAPI`; senão pode coincidir com a estação da playlist. */
  syncPlaySn?: string;
  /** Relê arquivo `configAPI` e atualiza `window.apiConfig` (ex.: antes de atualizar prompts na nuvem). */
  onReloadSuperaudioApiConfig?: () => Promise<void>;
  libraryReloadBusy: boolean;
  libraryReloadError: string;
  onReloadLibrary: () => void;
  libraryTab: LibraryColumnTabId;
  setLibraryTab: Dispatch<SetStateAction<LibraryColumnTabId>>;
  /** Caminhos normalizados das mídias já na playlist (acervo × ícone de relógio). */
  playlistMediaPathKeys: ReadonlySet<string>;
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
  cuePlaying,
  setCuePlaying,
  cueTime,
  cueDuration,
  toggleCue,
  toggleCuePlaybackToolbar,
  stopCuePlayer,
  handleCueSeek,
  playlistStationCode,
  syncPlaySn,
  onReloadSuperaudioApiConfig,
  libraryReloadBusy,
  libraryReloadError,
  onReloadLibrary,
  libraryTab,
  setLibraryTab,
  playlistMediaPathKeys,
}: LibraryColumnProps) {
  const [cueDropHover, setCueDropHover] = useState(false);
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
      <div className="flex flex-col gap-2.5 shrink-0">
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

      <div className="relative min-w-0 p-2">
        <p className="flex min-w-0 items-baseline gap-1 text-left text-xs font-bold text-neutral-400">
          <span className="shrink-0">ON AIR:</span>
          <div className="min-w-0 flex-1">
            <MarqueeText
              text="MANHÃ NEXT RÁDIO"
              className="text-left font-normal italic text-white"
            />
          </div>
        </p>
        <div className="relative flex w-full min-w-0 items-center gap-2">
          <p className="flex min-w-0 flex-1 items-baseline gap-1 pr-9 text-left text-xs font-bold text-neutral-400">
            <span className="shrink-0">RDS:</span>
            <div className="min-w-0 flex-1">
              <MarqueeText text="102.5 FM" className="text-left font-normal text-white" />
            </div>
          </p>
          <svg className='w-6 h-6 absolute right-2 top-0' id="rdsManual" data-status="0" viewBox="0 0 33 33" fill="none"
            xmlns="http://www.w3.org/2000/svg">
            <g clipPath="url(#clip0_5772_365)">
              <path
                d="M26.9889 17.3479V19.2186C26.9889 21.3052 25.2983 22.9959 23.2116 22.9959H17.2849L10.9889 28.0332V22.9959H8.0996C6.01293 22.9959 4.32227 21.3052 4.32227 19.2186V9.14391C4.32227 7.05724 6.01293 5.36658 8.0996 5.36658H14.9889"
                stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M22.5557 7.54524L23.6837 6.41591V10.9292" stroke="white" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" />
              <path d="M22.5596 10.9319H24.8076" stroke="white" strokeWidth="1.5" strokeLinecap="round"
                strokeLinejoin="round" />
              <path
                d="M23.6553 14.6999C26.969 14.6999 29.6553 12.0136 29.6553 8.69991C29.6553 5.3862 26.969 2.69991 23.6553 2.69991C20.3416 2.69991 17.6553 5.3862 17.6553 8.69991C17.6553 12.0136 20.3416 14.6999 23.6553 14.6999Z"
                stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </g>
            <defs>
              <clipPath id="clip0_5772_365">
                <rect width="32" height="32" fill="white" transform="translate(0.322266 0.0332336)" />
              </clipPath>
            </defs>
          </svg>
        </div>
      </div>

      <div className="icons text-center relative shrink-0 border-b border-[#353535]">
        <div className='bg-[#161616] pt-1 px-3 rounded-tr-lg justify-self-start rounded-tl-lg'>
          <p className="m-0 flex items-center gap-1.5 italic text-neutral-400 text-[10px] text-left">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="14"
              viewBox="0 -960 960 960"
              width="14"
              fill="#7f7f7f"
              className="shrink-0"
              aria-hidden
            >
              <path d="M238-96q66 0 100.5-41t51.5-96q14-46 30.5-77t64.5-57q66-35 102.5-98T624-601q0-110-77-186.5T360-864q-110 0-187 77T96-600h72q0-80 56-136t136-56q80 0 136 55.5T552-601q0 53-27 99t-73 70q-62 32-84.5 69.5T322-255q-16 48-37 67.5T238-168q-29 0-49.5-21.5T168-240H96q0 59 41.5 101.5T238-96Zm122-408q40 0 68-28t28-68q0-40-28-68t-68-28q-40 0-68 28t-28 68q0 40 28 68t68 28Zm362 122-54-54q14-32 21.5-67.5T697-577q0-46-11.5-88T654-745l53-51q29 48 45.5 103.5T769-576q0 53-12 101.5T722-382Zm105 105-52-52q31-55 47.5-117T839-576q0-75-20.5-143.5T760-848l53-51q47 69 72 150.5T910-577q0 83-21.5 158.5T827-277Z" />
            </svg>
            <span id="pre-escuta-span" className="font-semibold not-italic tracking-wide">
              CUE:
            </span>
            <span className="not-italic">Pré-Escuta</span>
          </p>
        </div>
        <div
          id="cue-drop-outer"
          className={[
            'fundo-verde flex justify-center items-center p-2 transition-[background-color] duration-200 rounded-lg rounded-tl-none',
            cueDropHover ? 'bg-[#0098a6]' : 'bg-[#161616]',
          ].join(' ')}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setCueDropHover(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setCueDropHover(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setCueDropHover(false);
          }}
        >
          <div
            id="inner-fundo-verde"
            className="flex flex-1 flex-col max-w-full min-w-0 rounded-[10px] bg-[#2a2a2a] p-2"
          >
            <div className="flex gap-1.5 items-center justify-between">
              <div className="min-h-5 min-w-0 flex-1">
                <MarqueeText
                  text={
                    cueFile
                      ? (cueFile.split(/[/\\]/).pop()?.replace(/\.[^/.]+$/, '') ?? cueFile)
                      : 'Arraste para ouvir 👉'
                  }
                  className="text-neutral-300 text-[11px]"
                />
              </div>
              <div className="flex items-center gap-1 text-neutral-500 border p-2 border-dashed rounded">
                <Music2 className="h-3 w-3 opacity-80" strokeWidth={1.25} aria-hidden />
                <p className="m-0 text-[10px]">Arraste mídias para ouvir</p>
              </div>
            </div>

            <div className="flex gap-2 items-center min-w-0">
              <button
                type="button"
                id="cue-play-button"
                data-status={cuePlaying ? 1 : 0}
                data-cue={cueFile ?? ''}
                disabled={!cueFile}
                className="shrink-0 p-0.5 rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 focus-visible:outline focus-visible:ring-1 focus-visible:ring-cyan-400/80"
                title={cuePlaying ? 'Pausar CUE' : 'Tocar CUE'}
                onClick={() => void toggleCuePlaybackToolbar()}
              >
                <img
                  src={!cueFile ? playVerde : cuePlaying ? pauseLoad : pauseBco}
                  alt=""
                  draggable={false}
                  className="w-7! h-7! p-[2px]! object-contain pointer-events-none"
                />
              </button>
              <button
                type="button"
                className="shrink-0 p-0.5 rounded cursor-pointer hover:opacity-90 focus-visible:outline focus-visible:ring-1 focus-visible:ring-cyan-400/80"
                title="Parar CUE"
                id="cue-stop-button"
                onClick={() => void stopCuePlayer()}
              >
                <img src={stopBco} alt="" draggable={false} className="w-7! h-7! p-[2px]! object-contain pointer-events-none" />
              </button>
              <div
                id="cue-vu"
                className="flex flex-col flex-1 min-w-0 items-stretch gap-2 justify-center"
              >
                <span
                  className="cue-vu-channel block w-full h-[5px] rounded-[2px] bg-[#4a4f5a] overflow-hidden"
                  data-channel={1}
                >
                  <canvas width={322} height={5} className="block h-full w-full" aria-hidden />
                </span>
                <span
                  className="cue-vu-channel block w-full h-[5px] rounded-[2px] bg-[#4a4f5a] overflow-hidden"
                  data-channel={2}
                >
                  <canvas width={322} height={5} className="block h-full w-full" aria-hidden />
                </span>
              </div>
            </div>

            <div className="cue-progress-container flex w-full items-center mt-1 gap-2">
              <input
                type="range"
                id="cue-progressbar"
                min={0}
                max={Number.isFinite(cueDuration) && cueDuration > 0 ? cueDuration : 0}
                step={0.01}
                value={Number.isFinite(cueTime) ? Math.min(cueTime, cueDuration || 0) : 0}
                onChange={handleCueSeek}
                disabled={!cueFile || !Number.isFinite(cueDuration) || cueDuration <= 0}
                className={`cue-progress-bar flex-1 min-w-0 w-full max-w-none h-[5px] ${!cueFile || cueDuration <= 0 ? 'opacity-40' : ''}`}
              />
              <div id="cue-times" className="cue-times shrink-0 flex items-center gap-1 text-[#c7c7c7] text-xs tabular-nums">
                <span id="cue-current-time">{formatTime(cueTime)}</span>
                <span aria-hidden>/</span>
                <span id="cue-total-time">{formatTime(cueDuration)}</span>
              </div>
            </div>
          </div>
        </div>
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
          playlistStationCode={playlistStationCode}
          libraryReloadBusy={libraryReloadBusy}
          libraryReloadError={libraryReloadError}
          onReloadLibrary={onReloadLibrary}
          playlistMediaPathKeys={playlistMediaPathKeys}
        />
        <LibraryIaTab
          hidden={libraryTab !== 'ia'}
          syncPlaySn={syncPlaySn}
          playlistStationFallback={playlistStationCode}
          onReloadSuperaudioApiConfig={onReloadSuperaudioApiConfig}
        />
        {libraryTab === 'tocou' ? <LibraryTocouTab /> : null}
      </div>
    </div>
  );
}

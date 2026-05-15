import type { Music, MediaCategory } from '../types';
import type { LibMusicFiltersState } from '../hooks/useSyncplayLibrary';

import { formatTimeRemaining } from '../time';
import { useCallback, useEffect, useRef, useState } from 'react';
import proximaBcoImg from '../assets/proxima_bco.png';
import lixeiraImg from '../assets/lixeira.png';
import refraoPlayGif from '../assets/refraoPlay.gif';
import playRPiscanteGif from '../assets/playRPiscante.gif';
import { invoke } from '@tauri-apps/api/core';
import { useSyncplayLibraryMaps } from '../library/SyncplayLibraryContext';
import {
  fileBaseKey,
  getMediaAcervoLabels,
  getMusicLibraryCollectionLabels,
  pickStringMap,
  resolveFilterLabel,
  resolveMusicFilterId,
  stripHtmlToText,
} from '../library/syncplayLibrary';
import { CollectionIcon } from '../assets/CollectionIcon';
import { FiltersIcon } from '../assets/FiltersIcon';
import { ArtistIcon } from '../assets/ArtistIcon';
import { VarinhaMagicaIcon } from '../assets/VarinhaMagica';
import { ReloadMusicIcon } from '../assets/ReloadMusicIcon';
import { getPlaylistItemFallbackCover } from '../lib/playlistItemCover';
import { INTRO_CHORUS_CHANNEL_ID } from '../hooks/useMixer';

// ─── Gradientes e bordas por tipo de mídia ────────────────────────────────────

const TYPE_BG: Record<string, string> = {
  music: 'linear-gradient(270deg, #007113 25%, #161616, #161616)',
  vem: 'linear-gradient(270deg, #716c06 25%, #161616, #161616)',
  commercial: 'linear-gradient(270deg, #1c3684 25%, #161616, #161616)',
  media: 'linear-gradient(270deg, #84581c 25%, #161616, #161616)',
  intro: 'linear-gradient(270deg, #4f729c 25%, #161616, #161616)',
  command: 'linear-gradient(180deg, #9b0000, transparent)',
};

const TYPE_BORDER: Record<string, string> = {
  music: 'rgba(0,113,19,0.55)',
  vem: 'rgba(113,108,6,0.55)',
  commercial: '#2b7fff',
  media: 'rgba(132,88,28,0.55)',
  intro: 'rgba(79,114,156,0.55)',
  command: 'rgba(155,0,0,0.55)',
};

const BAR_TRACK = 'rgba(148, 163, 184, 0.24)';
const BAR_PLAYED = 'rgba(148, 163, 184, 0.62)';
const BAR_MIX = 'rgba(255, 100, 50, 0.45)';

// ─── Filtros playlist ↔ biblioteca ─────────────────────────────────────────────

export interface PlaylistFilterVisibility {
  playlistShowMusicFilterYear: boolean;
  playlistShowMusicFilterCategory: boolean;
  playlistShowMusicFilterCollection: boolean;
  playlistShowMusicFilterStyle: boolean;
  playlistShowMusicFilterRhythm: boolean;
  playlistShowMusicFilterNationality: boolean;
  playlistShowMediaFilterCollection: boolean;
  playlistShowMediaFilterTag: boolean;
  playlistShowMediaFilterMediaType: boolean;
}

export type PlaylistFilterClickPayload =
  | { kind: 'artist'; artist: string; itemUniqueId: string }
  | { kind: 'year'; year: number; itemUniqueId: string }
  | {
    kind: 'musicMeta';
    field: 'category' | 'style' | 'rhythm' | 'nationality';
    displayText: string;
    raw?: string | number;
    itemUniqueId: string;
  }
  | { kind: 'collection'; label: string; itemUniqueId: string }
  | { kind: 'mediaBrowse'; label: string; itemUniqueId: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitArtistTitle(text: string): { artist: string | null; track: string } {
  const idx = text.indexOf(' - ');
  if (idx === -1) return { artist: null, track: text };
  const artist = text.slice(0, idx).trim();
  const track = text.slice(idx + 3).trim();
  return { artist: artist || null, track: track || text };
}

function getMixDurationSec(
  music: Music,
  displayDuration: number,
  overrideMixEndMs?: number
): { sec: number; isOverride: boolean } | null {
  // Override automático tem prioridade máxima sobre qualquer valor da biblioteca
  if (overrideMixEndMs != null && displayDuration > 0) {
    const tail = displayDuration - overrideMixEndMs / 1000;
    if (tail > 0) return { sec: tail, isOverride: true };
  }
  const ms = music.extra?.mix?.mix_total_milesecond;
  if (ms != null && ms > 0) return { sec: ms / 1000, isOverride: false };
  const mixEndMs = music.extra?.mix?.mix_end;
  if (mixEndMs != null && displayDuration > 0) {
    const tail = displayDuration - mixEndMs / 1000;
    if (tail > 0) return { sec: tail, isOverride: false };
  }
  return null;
}

function formatMixLabel(seconds: number) {
  const t =
    isNaN(seconds) || seconds < 0 ? '0,00' : seconds.toFixed(2).replace('.', ',');
  return `Mix ${t}`;
}

function parseWaveformSec(raw: string | undefined): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  const n = parseFloat(String(raw).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Início do refrão em ms quando `chorus_init` e `chorus_end` existem no waveform. */
export function getChorusSeekMs(music: Music): number | null {
  const w = music.extra?.mix?.waveform_content;
  if (!w) return null;
  const start = parseWaveformSec(w.chorus_init);
  const end = parseWaveformSec(w.chorus_end);
  if (start == null || end == null) return null;
  return Math.round(start * 1000);
}

/** Intro marcada no waveform (`intro` em segundos): salta para o início da faixa (tocar desde o início da intro). */
export function getIntroSeekMs(music: Music): number | null {
  const w = music.extra?.mix?.waveform_content;
  if (!w) return null;
  if (parseWaveformSec(w.intro) == null) return null;
  return 0;
}

function parseYear(raw: string | number | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Estado da barra lateral usado para refletir chips ativos (busca + mídias + diretório). */
export interface PlaylistSidebarFilterHighlight {
  searchQuery: string;
  mediaCategory: MediaCategory;
  directoryValue: string;
}

function hasAnyPlaylistLibFacet(f: LibMusicFiltersState): boolean {
  return !!(
    f.categoryId ||
    f.styleId ||
    f.rhythmId ||
    f.nationalityId ||
    f.yearMin ||
    f.yearMax ||
    f.collectionLabel
  );
}

function resolveMusicMetaId(
  musicFilters: Record<string, unknown> | null,
  field: 'category' | 'style' | 'rhythm' | 'nationality',
  raw: unknown,
  displayLabel: string | null
): string {
  const map =
    field === 'category'
      ? pickStringMap(musicFilters, 'categories', 'category')
      : field === 'style'
        ? pickStringMap(musicFilters, 'styles', 'style', 'estilos')
        : field === 'rhythm'
          ? pickStringMap(musicFilters, 'rhythms', 'rhythm', 'ritmos')
          : pickStringMap(musicFilters, 'nationalities', 'nationality', 'paises');
  return resolveMusicFilterId(map, raw, displayLabel);
}

function yearFacetMatchesTrack(
  year: number | null,
  f: LibMusicFiltersState,
  libraryYearDecade: boolean
): boolean {
  if (year == null) return false;
  if (!f.yearMin.trim() || !f.yearMax.trim()) return false;
  const yMin = parseInt(f.yearMin, 10);
  const yMax = parseInt(f.yearMax, 10);
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return false;
  if (libraryYearDecade) {
    const d = Math.floor(year / 10) * 10;
    return yMin === d && yMax === d + 9;
  }
  return yMin === yMax && yMin === year;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface PlaylistMusicItemProps {
  music: Music;
  itemUniqueId: string;
  isCurrentlyPlaying: boolean;
  isBackgroundPlaying: boolean;
  isScheduledUpcoming: boolean;
  isDisabled: boolean;
  isPlaying: boolean;
  startLabel?: string;
  currentTime: number;
  duration: number;
  backgroundPosition: number;
  onPlay: () => void;
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
  showTrashSkipIcon?: boolean;
  onPlaylistItemSelect?: () => void;
  onTrashRemove?: () => void;
  /** Próxima faixa na fila após esta linha (fade); ícone na lista — diferente do skip global (faixa atual). */
  onSkipNextFromRow?: () => void;
  /** Crossfade para esta linha na fila começando em `positionMs` (refrão); pode ser clicada mesmo com outra faixa a tocar. */
  onChorusSeekTo?: (positionMs: number) => void | Promise<void>;
  /** Crossfade para esta linha no início da intro (`positionMs` usualmente 0). */
  onIntroSeekTo?: (positionMs: number) => void | Promise<void>;
  filterVisibility: PlaylistFilterVisibility;
  libraryYearDecade: boolean;
  showMusicFileName: boolean;
  showCommercialFileName: boolean;
  showMediaFileName: boolean;
  libMusicFilterIds: LibMusicFiltersState;
  playlistSidebarFilterHighlight: PlaylistSidebarFilterHighlight;
  onPlaylistFilterClick?: (payload: PlaylistFilterClickPayload) => void;
  /** mix_end_ms detectado automaticamente — prevalece sobre music.extra.mix.mix_end para UI */
  overrideMixEndMs?: number;
}

export function PlaylistMusicItem({
  music,
  itemUniqueId,
  isCurrentlyPlaying,
  isBackgroundPlaying,
  isScheduledUpcoming,
  isDisabled,
  isPlaying,
  startLabel,
  currentTime,
  duration,
  backgroundPosition,
  onPlay,
  onSeek,
  showTrashSkipIcon = false,
  onPlaylistItemSelect,
  onTrashRemove,
  onSkipNextFromRow,
  filterVisibility,
  libraryYearDecade,
  showMusicFileName,
  showCommercialFileName,
  showMediaFileName,
  libMusicFilterIds,
  playlistSidebarFilterHighlight,
  onPlaylistFilterClick,
  overrideMixEndMs,
  onChorusSeekTo,
  onIntroSeekTo,
}: PlaylistMusicItemProps) {
  const { musicLibrary, musicFilters, mediaLibrary, mediaFilters } = useSyncplayLibraryMaps();

  const rawTitle = music.text || `Mídia: ${music.type}`;
  const { artist, track } = splitArtistTitle(rawTitle);

  const isMusicKind = (music.type ?? 'music') === 'music';

  const isVisuallyPlaying = isCurrentlyPlaying || isBackgroundPlaying;

  const trashHighlighted =
    Boolean(showTrashSkipIcon && !isVisuallyPlaying && !isDisabled);

  const chorusSeekMs = getChorusSeekMs(music);
  const hasChorusControl = chorusSeekMs != null;
  const introSeekMs = getIntroSeekMs(music);
  const hasIntroControl = introSeekMs != null;
  const [refrainUi, setRefrainUi] = useState<'idle' | 'playing' | 'flash'>('idle');
  const refrainFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCurrentlyPlayingRef = useRef(isCurrentlyPlaying);

  const beginRefrainStopFlash = useCallback(() => {
    if (refrainFlashTimerRef.current != null) {
      clearTimeout(refrainFlashTimerRef.current);
      refrainFlashTimerRef.current = null;
    }
    setRefrainUi('flash');
    refrainFlashTimerRef.current = setTimeout(() => {
      setRefrainUi('idle');
      refrainFlashTimerRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    if (
      prevCurrentlyPlayingRef.current &&
      !isCurrentlyPlaying &&
      refrainUi === 'playing'
    ) {
      beginRefrainStopFlash();
    }
    prevCurrentlyPlayingRef.current = isCurrentlyPlaying;
  }, [isCurrentlyPlaying, refrainUi, beginRefrainStopFlash]);

  useEffect(() => {
    return () => {
      if (refrainFlashTimerRef.current != null) {
        clearTimeout(refrainFlashTimerRef.current);
      }
    };
  }, []);

  const itemBg = TYPE_BG[music.type ?? ''];
  const itemBorderColor = TYPE_BORDER[music.type ?? ''];

  const itemClass = [
    'playlist-music-item flex flex-col rounded-md transition-all duration-75 border px-3 py-2',
    trashHighlighted ? 'playlist-music-item--trash-selected' : '',
    isDisabled ? 'playlist-music-item--disabled-extra' : '',
    isDisabled
      ? 'bg-black/30 border-[#353535]/55 border-dashed opacity-45 grayscale saturate-0'
      : isVisuallyPlaying
        ? 'playing'
        : isScheduledUpcoming
          ? 'playlist-item--scheduled-upcoming'
          : 'bg-white/[0.02] border-[#353535]/55',
  ].filter(Boolean).join(' ');

  const itemStyle: React.CSSProperties = {
    ...(itemBg && !isDisabled ? { background: itemBg } : {}),
    ...(itemBorderColor &&
      !isDisabled &&
      !isVisuallyPlaying &&
      !trashHighlighted
      ? { borderColor: itemBorderColor }
      : {}),
  };

  let displayDuration = 0;
  if (music.extra?.mix?.duration_total) displayDuration = music.extra.mix.duration_total / 1000;
  else if (music.extra?.mix?.duration_real) displayDuration = music.extra.mix.duration_real / 1000;
  else if (music.duration) displayDuration = music.duration;
  else if (isVisuallyPlaying) displayDuration = duration;

  let itemCurrentTime = 0;
  if (isCurrentlyPlaying) itemCurrentTime = currentTime;
  else if (isBackgroundPlaying) itemCurrentTime = backgroundPosition / 1000;

  const prog = displayDuration ? (itemCurrentTime / displayDuration) * 100 : 0;
  let mixEndPct: number | null = null;
  const effectiveMixEndMs = overrideMixEndMs ?? music.extra?.mix?.mix_end;
  if (effectiveMixEndMs && displayDuration) {
    const mixTriggerSec = Math.max(0, effectiveMixEndMs / 1000 - 1);
    mixEndPct = (mixTriggerSec / displayDuration) * 100;
  }

  let barBg: string;
  if (mixEndPct === null) {
    barBg = `linear-gradient(to right, ${BAR_PLAYED} ${prog}%, ${BAR_TRACK} ${prog}%)`;
  } else if (prog < mixEndPct) {
    barBg = `linear-gradient(to right, ${BAR_PLAYED} ${prog}%, ${BAR_TRACK} ${prog}%, ${BAR_TRACK} ${mixEndPct}%, ${BAR_MIX} ${mixEndPct}%)`;
  } else {
    barBg = `linear-gradient(to right, ${BAR_PLAYED} ${prog}%, ${BAR_MIX} ${prog}%)`;
  }

  const remainingSec = Math.max(0, displayDuration - itemCurrentTime);
  const mixResult = getMixDurationSec(music, displayDuration, overrideMixEndMs);
  const mixSec = mixResult?.sec ?? null;
  const mixIsOverride = mixResult?.isOverride ?? false;
  const mixLabel = mixSec !== null ? formatMixLabel(mixSec) : null;

  useEffect(() => {
    if (overrideMixEndMs == null) return;
    const libMixEndMs = music.extra?.mix?.mix_end ?? null;
    const libMixTotal = music.extra?.mix?.mix_total_milesecond ?? null;
    const libSec = libMixTotal != null
      ? libMixTotal / 1000
      : libMixEndMs != null && displayDuration > 0
        ? displayDuration - libMixEndMs / 1000
        : null;
    const overrideSec = displayDuration > 0 ? displayDuration - overrideMixEndMs / 1000 : null;
    console.debug(
      `[AutoMix UI] Override aplicado em ${itemUniqueId}\n` +
      `  biblioteca : mix_total=${libMixTotal}ms, mix_end=${libMixEndMs}ms → ${libSec?.toFixed(2) ?? 'n/a'}s\n` +
      `  override   : mix_end_ms=${overrideMixEndMs} → ${overrideSec?.toFixed(2) ?? 'n/a'}s\n` +
      `  exibindo   : ${mixSec?.toFixed(2) ?? 'n/a'}s  (isOverride=${mixIsOverride})`
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideMixEndMs, itemUniqueId]);

  const fileLabel =
    music.path != null && music.path !== ''
      ? fileBaseKey(music.path.split(/[\\/]/).pop() ?? music.path)
      : null;

  const collectionLabels =
    isMusicKind && music.path
      ? getMusicLibraryCollectionLabels(musicLibrary, musicFilters, music.path.split(/[\\/]/).pop() ?? '')
      : [];

  const mediaAcervo =
    !isMusicKind && music.path ? getMediaAcervoLabels(mediaLibrary, mediaFilters, music.path) : null;

  const fallbackCoverSrc = getPlaylistItemFallbackCover(music.type, mediaAcervo);
  const coverSrc =
    music.cover != null && String(music.cover).trim() !== '' ? String(music.cover) : fallbackCoverSrc;

  const catLabel = resolveFilterLabel(musicFilters, ['categories', 'category'], music.extra?.category);
  const styleLabel = resolveFilterLabel(musicFilters, ['styles', 'style', 'estilos'], music.extra?.style);
  const rhythmLabel = resolveFilterLabel(musicFilters, ['rhythms', 'rhythm', 'ritmos'], music.extra?.rhythm);
  const natLabel = resolveFilterLabel(musicFilters, ['nationalities', 'nationality', 'paises'], music.extra?.nationality);
  const yearRaw = music.extra?.released;
  const yearNum = parseYear(yearRaw);
  const yearLabel = yearRaw != null && String(yearRaw).trim() !== '' ? String(yearRaw) : null;

  const sb = playlistSidebarFilterHighlight;
  const catMetaId = resolveMusicMetaId(musicFilters, 'category', music.extra?.category, catLabel);
  const styleMetaId = resolveMusicMetaId(musicFilters, 'style', music.extra?.style, styleLabel);
  const rhythmMetaId = resolveMusicMetaId(musicFilters, 'rhythm', music.extra?.rhythm, rhythmLabel);
  const natMetaId = resolveMusicMetaId(musicFilters, 'nationality', music.extra?.nationality, natLabel);

  const categoryChipActive =
    catMetaId !== '' && String(libMusicFilterIds.categoryId).trim() === String(catMetaId).trim();
  const styleChipActive =
    styleMetaId !== '' && String(libMusicFilterIds.styleId).trim() === String(styleMetaId).trim();
  const rhythmChipActive =
    rhythmMetaId !== '' && String(libMusicFilterIds.rhythmId).trim() === String(rhythmMetaId).trim();
  const natChipActive =
    natMetaId !== '' && String(libMusicFilterIds.nationalityId).trim() === String(natMetaId).trim();
  const yearChipActive = yearFacetMatchesTrack(yearNum, libMusicFilterIds, libraryYearDecade);

  const artistChipActive =
    artist != null &&
    sb.mediaCategory === 'musics' &&
    sb.directoryValue === '0' &&
    !hasAnyPlaylistLibFacet(libMusicFilterIds) &&
    sb.searchQuery.trim().toLowerCase() === artist.trim().toLowerCase();

  function mediaBrowseChipActive(label: string) {
    return (
      sb.mediaCategory === 'medias' &&
      sb.directoryValue === '0' &&
      sb.searchQuery.trim().toLowerCase() === label.trim().toLowerCase()
    );
  }

  function collectionChipActive(label: string) {
    return libMusicFilterIds.collectionLabel.trim().toLowerCase() === label.trim().toLowerCase();
  }

  const extraPlain =
    music.extraInfoHTML != null && String(music.extraInfoHTML).trim() !== ''
      ? stripHtmlToText(String(music.extraInfoHTML))
      : null;

  function handlePlaylistItemSurfaceClick(e: React.MouseEvent) {
    if (!onPlaylistItemSelect || isVisuallyPlaying || isDisabled) return;
    const el = e.target as HTMLElement;
    if (el.closest('button')) return;
    if (el.closest('input')) return;
    if (el.closest('[data-skip-trash-zone]')) return;
    if (el.closest('[data-filter-chip]')) return;
    onPlaylistItemSelect();
  }

  function emitFilter(payload: PlaylistFilterClickPayload) {
    onPlaylistFilterClick?.(payload);
  }

  const chipClass = (active: boolean) =>
    [
      'cursor-pointer underline rounded px-1 py-0.5 text-[11px] leading-tight transition-colors',
      active ? 'filter-active' : 'text-white',
    ].join(' ');

  const itemType = music.type ?? '';
  const showFn = isMusicKind
    ? showMusicFileName
    : itemType === 'commercial'
      ? showCommercialFileName
      : showMediaFileName;

  const hasMusicChips =
    isMusicKind &&
    ((filterVisibility.playlistShowMusicFilterCategory && catLabel) ||
      (filterVisibility.playlistShowMusicFilterStyle && styleLabel) ||
      (filterVisibility.playlistShowMusicFilterRhythm && rhythmLabel) ||
      (filterVisibility.playlistShowMusicFilterYear && yearLabel) ||
      (filterVisibility.playlistShowMusicFilterNationality && natLabel) ||
      music.extra?.favorite ||
      music.extra?.fixed ||
      music.extra?.fitting != null);

  const hasCollections =
    isMusicKind &&
    filterVisibility.playlistShowMusicFilterCollection &&
    collectionLabels.length > 0;

  const hasMediaChips =
    !isMusicKind &&
    ((filterVisibility.playlistShowMediaFilterMediaType && mediaAcervo?.mediaType) ||
      (filterVisibility.playlistShowMediaFilterTag && mediaAcervo?.tagBumper) ||
      (filterVisibility.playlistShowMediaFilterCollection && mediaAcervo?.collections?.length));

  const showExtraBlock =
    !isDisabled && (hasMusicChips || hasCollections || (showFn && fileLabel) || extraPlain || hasMediaChips);

  function handleSkipZoneClick(ev: React.MouseEvent) {
    ev.stopPropagation();
    if (trashHighlighted && onTrashRemove) {
      onTrashRemove();
      return;
    }
    if (hasChorusControl && chorusSeekMs != null) {
      if (isDisabled) return;
      if (refrainUi === 'idle') {
        setRefrainUi('playing');
        const p =
          onChorusSeekTo != null
            ? Promise.resolve(onChorusSeekTo(chorusSeekMs))
            : invoke('seek_with_fade', {
                positionMs: chorusSeekMs,
                mixerBus: INTRO_CHORUS_CHANNEL_ID,
              });
        void p.catch((e) => {
          console.error(e);
          if (refrainFlashTimerRef.current != null) {
            clearTimeout(refrainFlashTimerRef.current);
            refrainFlashTimerRef.current = null;
          }
          setRefrainUi('idle');
        });
        return;
      }
      if (refrainUi === 'playing') {
        beginRefrainStopFlash();
        return;
      }
      return;
    }
    if (onSkipNextFromRow) {
      onSkipNextFromRow();
      return;
    }
    invoke('skip_with_fade').catch(console.error);
  }

  function handleIntroClick(ev: React.MouseEvent) {
    ev.stopPropagation();
    if (isDisabled || introSeekMs == null) return;
    if (onIntroSeekTo == null) return;
    if (refrainUi === 'playing') {
      beginRefrainStopFlash();
    }
    void Promise.resolve(onIntroSeekTo(introSeekMs)).catch(console.error);
  }

  const skipIconWrapClass = [
    'w-10 h-10 shrink-0 flex items-center justify-center',
    trashHighlighted ? 'cursor-pointer' : isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
  ].join(' ');

  return (
    <div
      className={itemClass}
      style={itemStyle}
      title={isDisabled ? 'Mídia descartada/desabilitada' : undefined}
      onClick={
        onPlaylistItemSelect && !isDisabled && !isVisuallyPlaying
          ? handlePlaylistItemSurfaceClick
          : undefined
      }
    >
      <div className="flex flex-row gap-3 items-center w-full min-w-0">
        <div className="flex flex-row gap-1 items-stretch shrink-0">
          <div className="relative w-[100px] h-[100px] shrink-0 rounded-xl overflow-hidden bg-white/5">
            <img
              src={coverSrc}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => {
                const el = e.currentTarget;
                if (el.dataset.coverFallback === '1') return;
                el.dataset.coverFallback = '1';
                el.src = fallbackCoverSrc;
              }}
            />
            {music.path ? (
              <button
                className={[
                  'absolute inset-0 w-full h-full flex items-center justify-center text-white p-0 text-[1rem] transition-all duration-75',
                  isDisabled
                    ? 'text-slate-500 cursor-not-allowed bg-black/30'
                    : isVisuallyPlaying && isPlaying
                      ? 'bg-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.4)] animate-pulse-btn'
                      : 'bg-black/30 hover:bg-[#353535]/90 hover:shadow-[0_0_10px_rgba(0,0,0,0.35)]',
                ].join(' ')}
                onClick={onPlay}
                onPointerDown={(ev) => ev.stopPropagation()}
                disabled={isDisabled}
                title={
                  isDisabled ? 'Mídia descartada/desabilitada' : isVisuallyPlaying && isPlaying ? 'Pausar' : 'Tocar'
                }
              >
                <span className="drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)] text-xl">
                  {isVisuallyPlaying && isPlaying ? '⏸' : '▶'}
                </span>
              </button>
            ) : null}
          </div>
          {hasIntroControl ? (
            <button
              type="button"
              data-skip-trash-zone
              title={
                isDisabled
                  ? 'Mídia descartada/desabilitada'
                  : 'Intro: ir a esta faixa desde o início (intro) com crossfade'
              }
              onClick={handleIntroClick}
              onPointerDown={(ev) => ev.stopPropagation()}
              disabled={isDisabled}
              className={[
                'flex items-center justify-center w-4 shrink-0',
                'hover:bg-white/8 transition-colors',
                isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
              ].join(' ')}
            >
              <span className="rotate-270 select-none text-[10px] font-bold uppercase tracking-wide text-emerald-400/95 whitespace-nowrap leading-none">
                intro
              </span>
            </button>
          ) : null}
        </div>
        <div className="flex flex-col w-full min-w-0 gap-1 flex-1 justify-between">
          <div className="flex flex-col gap-1 min-w-0">
            {artist ? (
              <>
                <div className="flex flex-row items-center gap-1">
                  <ArtistIcon />
                  <span
                    data-filter-chip
                    className={`filterArtist text-xs font-bold text-white leading-snug truncate underline cursor-pointer hover:text-sky-200 ${artistChipActive ? 'filter-active rounded px-1' : ''}`}
                    title={artist}
                    onClick={(e) => {
                      e.stopPropagation();
                      emitFilter({ kind: 'artist', artist, itemUniqueId });
                    }}
                  >
                    {artist}
                  </span>
                  <VarinhaMagicaIcon />
                </div>
                <div className="flex flex-row items-center gap-1">
                  <ReloadMusicIcon />
                  <span className="text-xs font-bold text-white leading-snug truncate" title={track}>
                    {track}
                  </span>
                </div>
              </>
            ) : (
              <span className="text-[0.875rem] font-medium text-white/90 truncate" title={rawTitle}>
                {track}
              </span>
            )}

            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {isDisabled && (
                <span className="text-[0.58rem] uppercase tracking-widest font-bold bg-slate-700/60 px-2 py-0.5 rounded-full text-slate-300 whitespace-nowrap">
                  inativa
                </span>
              )}
            </div>

            {showExtraBlock ? (
              <div
                id={`extra-information-${itemUniqueId}`}
                className="playlist-extra-information mt-1 flex flex-col gap-1 min-w-0"
                data-extra-information-container
              >
                {hasMusicChips ? (
                  <div className="filter-container flex flex-row items-start gap-1 min-w-0">
                    <span className="filter-container-icon text-[0.65rem] opacity-70 shrink-0 pt-0.5" aria-hidden>
                      <FiltersIcon />
                    </span>
                    <span className="flex flex-wrap gap-x-1 gap-y-0.5 min-w-0">
                      {music.extra?.favorite ? (
                        <span className="text-amber-300 text-[0.65rem]" title="Favorito">
                          ★
                        </span>
                      ) : null}
                      {music.extra?.fixed ? (
                        <span className="text-slate-300 text-[0.65rem]" title="Fixo">
                          📌
                        </span>
                      ) : null}
                      {music.extra?.fitting != null && music.extra?.fitting !== false ? (
                        <span className="text-emerald-300/90 text-[0.65rem]" title="Fitting">
                          ⧉
                        </span>
                      ) : null}
                      {filterVisibility.playlistShowMusicFilterCategory && catLabel ? (
                        <span
                          data-filter-chip
                          className={`filterCategory ${chipClass(categoryChipActive)}`}
                          title={libraryYearDecade ? 'Filtrar por categoria (acervo)' : 'Filtrar por categoria'}
                          onClick={(e) => {
                            e.stopPropagation();
                            emitFilter({
                              kind: 'musicMeta',
                              field: 'category',
                              displayText: catLabel,
                              raw: music.extra?.category,
                              itemUniqueId,
                            });
                          }}
                        >
                          {catLabel}
                        </span>
                      ) : null}
                      {filterVisibility.playlistShowMusicFilterStyle && styleLabel ? (
                        <span
                          data-filter-chip
                          className={`filterStyle ${chipClass(styleChipActive)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            emitFilter({
                              kind: 'musicMeta',
                              field: 'style',
                              displayText: styleLabel,
                              raw: music.extra?.style,
                              itemUniqueId,
                            });
                          }}
                        >
                          {styleLabel}
                        </span>
                      ) : null}
                      {filterVisibility.playlistShowMusicFilterRhythm && rhythmLabel ? (
                        <span
                          data-filter-chip
                          className={`filterRhythm ${chipClass(rhythmChipActive)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            emitFilter({
                              kind: 'musicMeta',
                              field: 'rhythm',
                              displayText: rhythmLabel,
                              raw: music.extra?.rhythm,
                              itemUniqueId,
                            });
                          }}
                        >
                          {rhythmLabel}
                        </span>
                      ) : null}
                      {filterVisibility.playlistShowMusicFilterNationality && natLabel ? (
                        <span
                          data-filter-chip
                          className={`filterNationality ${chipClass(natChipActive)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            emitFilter({
                              kind: 'musicMeta',
                              field: 'nationality',
                              displayText: natLabel,
                              raw: music.extra?.nationality,
                              itemUniqueId,
                            });
                          }}
                        >
                          {natLabel}
                        </span>
                      ) : null}
                      {filterVisibility.playlistShowMusicFilterYear && yearLabel ? (
                        <span
                          data-filter-chip
                          className={`filterYear ${chipClass(yearChipActive)}`}
                          title={libraryYearDecade ? 'Filtrar por década' : 'Filtrar por ano'}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (yearNum != null) {
                              emitFilter({ kind: 'year', year: yearNum, itemUniqueId });
                            }
                          }}
                        >
                          {yearLabel}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ) : null}

                {hasCollections ? (
                  <div className="filter-container flex flex-row items-start gap-1 flex-wrap">
                    <span className="filter-container-icon text-[0.65rem] opacity-70 shrink-0 pt-0.5" aria-hidden>
                      <CollectionIcon />
                    </span>
                    <span className="flex flex-wrap gap-x-1 gap-y-0.5">
                      {collectionLabels.map((label) => (
                        <span
                          key={label}
                          data-filter-chip
                          className={`filterCollection ${chipClass(collectionChipActive(label))}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            emitFilter({ kind: 'collection', label, itemUniqueId });
                          }}
                        >
                          {label}
                        </span>
                      ))}
                    </span>
                  </div>
                ) : null}

                {hasMediaChips ? (
                  <div className="filter-container flex flex-row items-start gap-1 min-w-0">
                    <span className="filter-container-icon text-[0.65rem] opacity-70 shrink-0 pt-0.5" aria-hidden>
                      ▣
                    </span>
                    <span className="flex flex-wrap gap-x-1 gap-y-0.5 min-w-0">
                      {filterVisibility.playlistShowMediaFilterMediaType && mediaAcervo?.mediaType ? (
                        <span
                          data-filter-chip
                          className={`filterDirectory ${chipClass(mediaBrowseChipActive(mediaAcervo.mediaType!))}`}
                          data-type={mediaAcervo.mediaType}
                          onClick={(e) => {
                            e.stopPropagation();
                            emitFilter({ kind: 'mediaBrowse', label: mediaAcervo.mediaType!, itemUniqueId });
                          }}
                        >
                          {mediaAcervo.mediaType}
                        </span>
                      ) : null}
                      {filterVisibility.playlistShowMediaFilterTag && mediaAcervo?.tagBumper ? (
                        <span
                          data-filter-chip
                          className={`filterTagBumper ${chipClass(mediaBrowseChipActive(mediaAcervo.tagBumper!))}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            emitFilter({ kind: 'mediaBrowse', label: mediaAcervo.tagBumper!, itemUniqueId });
                          }}
                        >
                          {mediaAcervo.tagBumper}
                        </span>
                      ) : null}
                      {(mediaAcervo?.collections ?? []).map((c) =>
                        filterVisibility.playlistShowMediaFilterCollection ? (
                          <span
                            key={c}
                            data-filter-chip
                            className={`filterCollection ${chipClass(mediaBrowseChipActive(c))}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              emitFilter({ kind: 'mediaBrowse', label: c, itemUniqueId });
                            }}
                          >
                            {c}
                          </span>
                        ) : null
                      )}
                    </span>
                  </div>
                ) : null}

                {showFn && fileLabel ? (
                  <div className="playlist-extra-filename text-[10px] text-white truncate" title={music.path}>
                    {fileLabel}
                  </div>
                ) : null}

                {extraPlain ? (
                  <div className="playlist-extra-info-plain text-[0.58rem] text-slate-400 whitespace-pre-wrap wrap-break-word">
                    {extraPlain}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <input
            type="range"
            className="progress-bar playlist-music-progress-bar w-full min-w-0 min-h-[12px] bg-zinc-900!"
            min="0"
            max={displayDuration || 0}
            step="0.001"
            value={itemCurrentTime}
            onChange={onSeek}
            onPointerDown={(ev) => ev.stopPropagation()}
            disabled={isDisabled || !isVisuallyPlaying}
            style={{ background: barBg }}
          />
        </div>

        <div className="shrink-0 flex flex-col items-center justify-center gap-1 min-w-0 w-[20%]">
          <span className="text-md text-white font-black">
            {formatTimeRemaining(remainingSec)}
          </span>
          <div
            className={skipIconWrapClass}
            data-skip-trash-zone
            title={
              hasChorusControl && !trashHighlighted
                ? isDisabled
                  ? 'Mídia descartada/desabilitada'
                  : 'Refrão: ir a esta faixa no refrão com crossfade (mesmo que outra esteja a tocar). Toque de novo para sair do modo.'
                : undefined
            }
            onPointerDown={(ev) => ev.stopPropagation()}
            onClick={handleSkipZoneClick}
          >
            {trashHighlighted ? (
              <img src={lixeiraImg} alt="" className="w-full h-full object-contain pointer-events-none" />
            ) : hasChorusControl ? (
              refrainUi === 'playing' ? (
                <img src={refraoPlayGif} alt="" className="w-full h-full object-contain pointer-events-none" />
              ) : refrainUi === 'flash' ? (
                <img src={playRPiscanteGif} alt="" className="w-full h-full object-contain pointer-events-none" />
              ) : (
                <svg
                  className="mix-point-chorus w-full h-full object-contain pointer-events-none"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 512 512"
                  aria-hidden
                >
                  <defs>
                    <style>{`.mix-point-chorus .cls-12{fill:none;stroke:#43a035;stroke-width:15px}.mix-point-chorus .cls-2{fill:#43a035}.mix-point-chorus .cls-2,.mix-point-chorus .cls-3{fill-rule:evenodd}`}</style>
                  </defs>
                  <circle className="cls-12" cx="255.75" cy="255.75" r="245.844" />
                  <path
                    className="cls-2"
                    d="M409.453,249.348a5,5,0,0,1,0,8.3L186.807,406.99a5,5,0,0,1-7.785-4.152V104.162a5,5,0,0,1,7.785-4.152Z"
                  />
                  <path
                    className="cls-3"
                    d="M240.306,214.7h7.542q12.034,0,17.771,3.529t5.736,11.869q0,8.421-5.616,12.351t-17.41,3.93h-8.023V214.7Zm13.238,51.889,28,44.991h27.6q-8.023-11.549-34.5-51.086a37.7,37.7,0,0,0,16.126-12.632,31.1,31.1,0,0,0,5.7-18.4q0-17.724-11.473-26.426t-35.381-8.7H215.435V311.583h24.871V266.592h13.238Z"
                  />
                </svg>
              )
            ) : (
              <img
                src={proximaBcoImg}
                alt=""
                className="w-full h-full object-contain rotate-90 pointer-events-none"
              />
            )}
          </div>
          <div className='flex gap-3 mt-1'>
            {mixLabel && (
              <span
                className="playlist-music-mix-label"
                style={mixIsOverride ? { color: '#ef4444', fontWeight: 700 } : undefined}
                title={mixIsOverride ? 'Ponto de mix detectado automaticamente' : undefined}
              >
                {mixLabel}
              </span>
            )}
            {startLabel && (
              <span className="playlist-music-start-time" title="Horário previsto da mídia">
                {startLabel}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

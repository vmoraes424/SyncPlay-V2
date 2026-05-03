import type { Music } from '../types';

import { formatTimeRemaining } from '../time';
import proximaBcoImg from '../assets/proxima_bco.png';
import lixeiraImg from '../assets/lixeira.png';
import { invoke } from '@tauri-apps/api/core';

// ─── Gradientes e bordas por tipo de mídia ────────────────────────────────────

const TYPE_BG: Record<string, string> = {
  music: 'linear-gradient(270deg, #007113 25%, #161616, #161616)',
  vem: 'linear-gradient(270deg, #716c06 25%, #161616, #161616)',
};

const TYPE_BORDER: Record<string, string> = {
  music: 'rgba(0,113,19,0.55)',
  vem: 'rgba(113,108,6,0.55)',
};

const BAR_TRACK = 'rgba(148, 163, 184, 0.24)';
const BAR_PLAYED = 'rgba(148, 163, 184, 0.62)';
const BAR_MIX = 'rgba(255, 100, 50, 0.45)';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitArtistTitle(text: string): { artist: string | null; track: string } {
  const idx = text.indexOf(' - ');
  if (idx === -1) return { artist: null, track: text };
  const artist = text.slice(0, idx).trim();
  const track = text.slice(idx + 3).trim();
  return { artist: artist || null, track: track || text };
}

function getMixDurationSec(music: Music, displayDuration: number): number | null {
  const ms = music.extra?.mix?.mix_total_milesecond;
  if (ms != null && ms > 0) return ms / 1000;
  const mixEndMs = music.extra?.mix?.mix_end;
  if (mixEndMs != null && displayDuration > 0) {
    const tail = displayDuration - mixEndMs / 1000;
    if (tail > 0) return tail;
  }
  return null;
}

function formatMixLabel(seconds: number) {
  const t =
    isNaN(seconds) || seconds < 0 ? '0,00' : seconds.toFixed(2).replace('.', ',');
  return `Mix ${t}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface PlaylistMusicItemProps {
  music: Music;
  isCurrentlyPlaying: boolean;
  isBackgroundPlaying: boolean;
  isScheduledUpcoming: boolean;
  isDisabled: boolean;
  isPlaying: boolean;
  startLabel?: string;
  currentTime: number;
  duration: number;
  backgroundPosition: number; // posição em ms
  onPlay: () => void;
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Quando true, o ícone à direita é a lixeira em vez do skip. */
  showTrashSkipIcon?: boolean;
  /** Clique na mídia (área do item, exceto play/slider/ícone skip) alterna a lixeira neste item. */
  onPlaylistItemSelect?: () => void;
  /** Com lixeira visível: remove o item da playlist em memória (não grava arquivo). */
  onTrashRemove?: () => void;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function PlaylistMusicItem({
  music,
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
}: PlaylistMusicItemProps) {
  const rawTitle = music.text || `Mídia: ${music.type}`;
  const { artist, track } = splitArtistTitle(rawTitle);

  /** Lixeira só em itens que não são a linha atualmente tocando (principal). */
  const trashHighlighted =
    Boolean(showTrashSkipIcon && !isCurrentlyPlaying && !isDisabled);

  const itemBg = TYPE_BG[music.type ?? ''];
  const itemBorderColor = TYPE_BORDER[music.type ?? ''];

  const itemClass = [
    'playlist-music-item flex flex-col rounded-md transition-all duration-200 border mx-2 px-3 py-2',
    trashHighlighted ? 'playlist-music-item--trash-selected' : '',
    isDisabled
      ? 'bg-slate-950/35 border-slate-500/20 border-dashed opacity-45 grayscale saturate-0'
      : isCurrentlyPlaying
        ? 'playing'
        : isBackgroundPlaying
          ? 'border-violet-500/25'
          : isScheduledUpcoming
            ? 'playlist-item--scheduled-upcoming'
            : 'bg-white/[0.025] border-white/[0.06]',
  ].filter(Boolean).join(' ');

  const itemStyle: React.CSSProperties = {
    ...(itemBg && !isDisabled ? { background: itemBg } : {}),
    ...(itemBorderColor &&
    !isDisabled &&
    !isCurrentlyPlaying &&
    !isBackgroundPlaying &&
    !trashHighlighted
      ? { borderColor: itemBorderColor }
      : {}),
  };

  let displayDuration = 0;
  if (music.extra?.mix?.duration_total) displayDuration = music.extra.mix.duration_total / 1000;
  else if (music.extra?.mix?.duration_real) displayDuration = music.extra.mix.duration_real / 1000;
  else if (music.duration) displayDuration = music.duration;
  else if (isCurrentlyPlaying) displayDuration = duration;

  let itemCurrentTime = 0;
  if (isCurrentlyPlaying) itemCurrentTime = currentTime;
  else if (isBackgroundPlaying) itemCurrentTime = backgroundPosition / 1000;

  const prog = displayDuration ? (itemCurrentTime / displayDuration) * 100 : 0;
  let mixEndPct: number | null = null;
  if (music.extra?.mix?.mix_end && displayDuration) {
    // Subtrai 1 s para alinhar com o ponto real de disparo do engine (trigger_at = mix_end - 1 s).
    const mixTriggerSec = Math.max(0, music.extra.mix.mix_end / 1000 - 1);
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
  const mixSec = getMixDurationSec(music, displayDuration);
  const mixLabel = mixSec !== null ? formatMixLabel(mixSec) : null;

  function handlePlaylistItemSurfaceClick(e: React.MouseEvent) {
    if (!onPlaylistItemSelect || isCurrentlyPlaying || isDisabled) return;
    const el = e.target as HTMLElement;
    if (el.closest('button')) return;
    if (el.closest('input')) return;
    if (el.closest('[data-skip-trash-zone]')) return;
    onPlaylistItemSelect();
  }

  return (
    <div
      className={itemClass}
      style={itemStyle}
      title={isDisabled ? 'Mídia descartada/desabilitada' : undefined}
      onClick={
        onPlaylistItemSelect && !isDisabled && !isCurrentlyPlaying
          ? handlePlaylistItemSurfaceClick
          : undefined
      }
    >
      {/* Linha 1: cover+play | artista/música | tempos */}
      <div className="flex flex-row gap-3 items-center w-full min-w-0">
        {/* Cover com botão de play sobreposto */}
        <div className="relative w-[100px] h-[64px] shrink-0 rounded overflow-hidden bg-white/5">
          {music.cover ? (
            <img
              src={music.cover}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-white/5" />
          )}
          {music.path ? (
            <button
              className={[
                'absolute inset-0 w-full h-full flex items-center justify-center text-white p-0 text-[1rem] transition-all duration-200',
                isDisabled
                  ? 'text-slate-500 cursor-not-allowed bg-black/30'
                  : isCurrentlyPlaying && isPlaying
                    ? 'bg-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.4)] animate-pulse-btn'
                    : 'bg-black/30 hover:bg-blue-500/60 hover:shadow-[0_0_10px_rgba(59,130,246,0.4)]',
              ].join(' ')}
              onClick={onPlay}
              disabled={isDisabled}
              title={
                isDisabled ? 'Mídia descartada/desabilitada' : isCurrentlyPlaying && isPlaying ? 'Pausar' : 'Tocar'
              }
            >
              <span className="drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)] text-xl">
                {isCurrentlyPlaying && isPlaying ? '⏸' : '▶'}
              </span>
            </button>
          ) : null}
        </div>

        {/* Título / artista + barra de progresso */}
        <div className="flex flex-col w-full min-w-0 gap-1 flex-1 justify-between">
          <div className="flex flex-col gap-1">
            {artist ? (
              <>
                <span className="text-xs font-bold text-white leading-snug truncate underline cursor-pointer" title={artist}>
                  {artist}
                </span>
                <span className="text-xs font-bold text-white leading-snug truncate" title={track}>
                  {track}
                </span>
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
          </div>

          {/* Barra de progresso no rodapé deste container */}
          <input
            type="range"
            className="progress-bar playlist-music-progress-bar w-full min-w-0 min-h-[12px] bg-zinc-900!"
            min="0"
            max={displayDuration || 0}
            step="0.001"
            value={itemCurrentTime}
            onChange={onSeek}
            disabled={isDisabled || !isCurrentlyPlaying}
            style={{ background: barBg }}
          />
        </div>

        {/* Tempos + skip/lixeira */}
        <div className="shrink-0 flex flex-col items-center justify-center gap-1 min-w-0 w-[20%]">
          <span className="text-md text-white font-black">
            {formatTimeRemaining(remainingSec)}
          </span>
          <img
            src={trashHighlighted ? lixeiraImg : proximaBcoImg}
            alt=""
            data-skip-trash-zone
            onClick={(ev) => {
              ev.stopPropagation();
              if (trashHighlighted && onTrashRemove) {
                onTrashRemove();
                return;
              }
              invoke("skip_with_fade").catch(console.error);
            }}
            className="w-10 h-10 rotate-90 cursor-pointer"
          />
          <div className='flex gap-3 mt-1'>
            {mixLabel && <span className="playlist-music-mix-label">{mixLabel}</span>}
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

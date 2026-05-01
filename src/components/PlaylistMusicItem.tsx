import type { Music } from '../types';

import proximaBcoImg from '../assets/proxima_bco.png';
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

function formatTimeRemaining(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

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
}: PlaylistMusicItemProps) {
  const rawTitle = music.text || `Mídia: ${music.type}`;
  const { artist, track } = splitArtistTitle(rawTitle);

  const itemBg = TYPE_BG[music.type ?? ''];
  const itemBorderColor = TYPE_BORDER[music.type ?? ''];

  const itemClass = [
    'playlist-music-item flex flex-col rounded-md transition-all duration-200 border mx-2 px-3 py-2',
    isDisabled
      ? 'bg-slate-950/35 border-slate-500/20 border-dashed opacity-45 grayscale saturate-0'
      : isCurrentlyPlaying
        ? 'playing'
        : isBackgroundPlaying
          ? 'border-violet-500/25'
          : isScheduledUpcoming
            ? 'playlist-item--scheduled-upcoming'
            : 'bg-white/[0.025] border-white/[0.06]',
  ].join(' ');

  const itemStyle: React.CSSProperties = {
    ...(itemBg && !isDisabled ? { background: itemBg } : {}),
    ...(itemBorderColor && !isDisabled && !isCurrentlyPlaying && !isBackgroundPlaying
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
  if (music.extra?.mix?.mix_end && displayDuration)
    mixEndPct = (music.extra.mix.mix_end / 1000 / displayDuration) * 100;

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

  return (
    <div className={itemClass} style={itemStyle} title={isDisabled ? 'Mídia descartada/desabilitada' : undefined}>
      {/* Linha 1: play | artista/música | tempos */}
      <div className="flex flex-row gap-3 items-start w-full min-w-0 h-full">
        <div className="w-8 shrink-0 flex justify-center items-start pt-0.5">
          {music.path ? (
            <button
              className={[
                'w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 p-0 text-[0.85rem] transition-all duration-200',
                isDisabled
                  ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                  : isCurrentlyPlaying && isPlaying
                    ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)] animate-pulse-btn'
                    : 'bg-white/10 hover:bg-blue-500 hover:shadow-[0_0_10px_rgba(59,130,246,0.4)] hover:scale-110',
              ].join(' ')}
              onClick={onPlay}
              disabled={isDisabled}
              title={
                isDisabled ? 'Mídia descartada/desabilitada' : isCurrentlyPlaying && isPlaying ? 'Pausar' : 'Tocar'
              }
            >
              {isCurrentlyPlaying && isPlaying ? '⏸' : '▶'}
            </button>
          ) : null}
        </div>

        <div className='flex flex-col w-full min-w-0 gap-1 flex-1 relative h-full justify-between'>
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

        <div className="shrink-0 flex flex-col items-center justify-center gap-1 min-w-0 w-[20%]">
          <span className="text-md text-white font-black">
            {formatTimeRemaining(remainingSec)}
          </span>
          <img src={proximaBcoImg} alt="" onClick={() => {
            invoke("skip_with_fade").catch(console.error);
          }} className="w-10 h-10 rotate-90" />
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

import type { Music } from '../types';

// ─── Gradientes e bordas por tipo de mídia ────────────────────────────────────

const TYPE_BG: Record<string, string> = {
  music: 'linear-gradient(270deg, #007113 25%, #161616, #161616)',
  vem: 'linear-gradient(270deg, #716c06 25%, #161616, #161616)',
};

const TYPE_BORDER: Record<string, string> = {
  music: 'rgba(0,113,19,0.55)',
  vem: 'rgba(113,108,6,0.55)',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface PlaylistMusicItemProps {
  music: Music;
  isCurrentlyPlaying: boolean;
  isBackgroundPlaying: boolean;
  isScheduledUpcoming: boolean;
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
  isPlaying,
  startLabel,
  currentTime,
  duration,
  backgroundPosition,
  onPlay,
  onSeek,
}: PlaylistMusicItemProps) {
  const title = music.text || `Mídia: ${music.type}`;

  // Background e borda por tipo
  const itemBg = TYPE_BG[music.type ?? ''];
  const itemBorderColor = TYPE_BORDER[music.type ?? ''];

  const itemClass = [
    'flex flex-col px-3.5 py-3 rounded-xl transition-all duration-200 border mx-2 my-0.5',
    isCurrentlyPlaying
      ? 'border-blue-500/25 shadow-[0_0_0_1px_rgba(59,130,246,0.15)]'
      : isBackgroundPlaying
        ? 'border-violet-500/25'
        : isScheduledUpcoming
          ? 'playlist-item--scheduled-upcoming'
          : itemBorderColor
          ? 'hover:brightness-110'
          : 'bg-white/[0.025] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/10',
  ].join(' ');

  const itemStyle: React.CSSProperties = {
    ...(itemBg ? { background: itemBg } : {}),
    ...(itemBorderColor && !isCurrentlyPlaying && !isBackgroundPlaying
      ? { borderColor: itemBorderColor }
      : {}),
  };

  // Duração display
  let displayDuration = 0;
  if (music.extra?.mix?.duration_total) displayDuration = music.extra.mix.duration_total / 1000;
  else if (music.extra?.mix?.duration_real) displayDuration = music.extra.mix.duration_real / 1000;
  else if (music.duration) displayDuration = music.duration;
  else if (isCurrentlyPlaying) displayDuration = duration;

  // Tempo atual
  let itemCurrentTime = 0;
  if (isCurrentlyPlaying) itemCurrentTime = currentTime;
  else if (isBackgroundPlaying) itemCurrentTime = backgroundPosition / 1000;

  // Progresso e mix-end
  const prog = displayDuration ? (itemCurrentTime / displayDuration) * 100 : 0;
  let mixEnd: number | null = null;
  if (music.extra?.mix?.mix_end && displayDuration)
    mixEnd = (music.extra.mix.mix_end / 1000 / displayDuration) * 100;

  let barBg = `linear-gradient(to right, var(--accent-color) ${prog}%, rgba(255,255,255,0.08) ${prog}%)`;
  if (mixEnd !== null) {
    barBg = prog < mixEnd
      ? `linear-gradient(to right, var(--accent-color) ${prog}%, rgba(255,255,255,0.08) ${prog}%, rgba(255,255,255,0.08) ${mixEnd}%, rgba(255,100,50,0.4) ${mixEnd}%)`
      : `linear-gradient(to right, var(--accent-color) ${prog}%, rgba(255,100,50,0.4) ${prog}%)`;
  }

  return (
    <div className={itemClass} style={itemStyle}>
      {/* Linha superior: play + título + badge */}
      <div className="flex items-center gap-3 w-full">
        {music.path && (
          <button
            className={[
              'w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 p-0 text-[0.85rem] transition-all duration-200',
              isCurrentlyPlaying && isPlaying
                ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)] animate-pulse-btn'
                : 'bg-white/10 hover:bg-blue-500 hover:shadow-[0_0_10px_rgba(59,130,246,0.4)] hover:scale-110',
            ].join(' ')}
            onClick={onPlay}
            title={isCurrentlyPlaying && isPlaying ? 'Pausar' : 'Tocar'}
          >
            {isCurrentlyPlaying && isPlaying ? '⏸' : '▶'}
          </button>
        )}
        <span className="flex-1 text-[0.875rem] font-medium text-white/90 whitespace-nowrap overflow-hidden text-ellipsis">
          {title}
        </span>
        {startLabel && (
          <span className="playlist-music-start-time" title="Horário previsto da mídia">
            {startLabel}
          </span>
        )}
        {music.type && (
          <span className="text-[0.6rem] uppercase tracking-widest font-bold bg-white/8 px-2 py-0.5 rounded-full text-slate-400 whitespace-nowrap shrink-0">
            {music.type}
          </span>
        )}
      </div>

      {/* Linha inferior: progress bar com tempos */}
      <div className="flex items-center gap-2.5 w-full mt-2.5 pl-[44px]">
        <span className="text-[0.7rem] text-slate-500 tabular-nums min-w-[32px]">
          {formatTime(itemCurrentTime)}
        </span>
        <input
          type="range"
          className="progress-bar"
          min="0"
          max={displayDuration || 0}
          step="0.001"
          value={itemCurrentTime}
          onChange={onSeek}
          disabled={!isCurrentlyPlaying}
          style={{ background: barBg }}
        />
        <span className="text-[0.7rem] text-slate-500 tabular-nums min-w-[32px] text-right">
          {formatTime(displayDuration)}
        </span>
      </div>
    </div>
  );
}

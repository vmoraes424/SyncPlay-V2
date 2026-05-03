import stopBco from "../../assets/stop_bco.png";
import playVerde from "../../assets/play_verde.png";
import pauseBco from "../../assets/pause.png";
import pauseLoad from "../../assets/pause_load.gif";
import proximaBcoImg from "../../assets/proxima_bco.png";
import { formatTimeRemaining } from "../../time";

interface PlaylistPlaybackBarProps {
  currentTime: number;
  duration: number;
  /** Há faixa carregada na fila (pode estar pausada). */
  hasCurrentTrack: boolean;
  isPlaying: boolean;
  onStop: () => void;
  onTogglePlayPause: () => void;
  onNext: () => void;
}

export function PlaylistPlaybackBar({
  currentTime,
  duration,
  hasCurrentTrack,
  isPlaying,
  onStop,
  onTogglePlayPause,
  onNext,
}: PlaylistPlaybackBarProps) {
  const centerSrc = !hasCurrentTrack
    ? playVerde
    : isPlaying
      ? pauseLoad
      : pauseBco;

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[#353535] px-2">
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          className="flex cursor-pointer shrink-0 rounded p-0.5 hover:opacity-90 focus-visible:ring-1 focus-visible:ring-emerald-400/80"
          onClick={onStop}
          aria-label="Parar reprodução"
        >
          <img src={stopBco} alt="" className="pointer-events-none h-5 w-5 object-contain" draggable={false} />
        </button>
        <button
          type="button"
          className="flex cursor-pointer shrink-0 rounded p-0.5 hover:opacity-90 focus-visible:ring-1 focus-visible:ring-emerald-400/80 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onTogglePlayPause}
          disabled={!hasCurrentTrack}
          aria-label={isPlaying ? "Pausar" : "Retomar"}
        >
          <img
            src={centerSrc}
            alt=""
            className="pointer-events-none h-8 w-8 object-contain"
            draggable={false}
          />
        </button>
        <button
          type="button"
          className="flex cursor-pointer shrink-0 rounded p-0.5 hover:opacity-90 focus-visible:ring-1 focus-visible:ring-emerald-400/80"
          onClick={onNext}
          aria-label="Próxima faixa"
        >
          <img src={proximaBcoImg} alt="" className="pointer-events-none h-5 w-5 object-contain" draggable={false} />
        </button>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
        <span className="text-lg font-black text-[#43a035]">
          {formatTimeRemaining(currentTime)}
        </span>
        <span className="text-[10px] tabular-nums text-white">
          Total: {formatTimeRemaining(duration)}
        </span>
      </div>
    </div>
  );
}

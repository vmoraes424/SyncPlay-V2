import stopBco from "../../assets/stop_bco.png";
import playVerde from "../../assets/play_verde.png";
import pauseBco from "../../assets/pause.png";
import pauseLoad from "../../assets/pause_load.gif";
import proximaBcoImg from "../../assets/proxima_bco.png";
import { formatTimeRemaining } from "../../time";
import { invoke } from "@tauri-apps/api/core";
import { DraggableCommandIcon } from "../dnd/DraggableCommandIcon";

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
    <div className="flex h-12 shrink-0 items-center gap-3 border-b-4 border-[#353535] px-2">
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

      <div className="flex items-center gap-2">
        <svg
          className={`teclado cursor-pointer ${isPlaying ? "fill-white" : "playlist-teclado--idle"}`}
          onClick={(e) => {
            e.preventDefault();
            void invoke("skip_with_fade").catch(console.error);
          }}
          xmlns="http://www.w3.org/2000/svg"
          height="52px"
          viewBox="0 -960 960 960"
          width="52px"
          aria-hidden
        >
          <path
            d="M160-200q-33 0-56.5-23.5T80-280v-400q0-33 23.5-56.5T160-760h640q33 0 56.5 23.5T880-680v400q0 33-23.5 56.5T800-200H160Zm0-80h640v-400H160v400Zm160-40h320v-80H320v80ZM200-440h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80ZM200-560h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80ZM160-280v-400 400Z" />
        </svg>
        <DraggableCommandIcon commandId="cmd-reload-playlist" label="Recarregar playlist">
          <svg
            id="reload-playlist"
            className="reloadplaylistcommand pointer-events-none"
            xmlns="http://www.w3.org/2000/svg"
            width={32}
            height={32}
            viewBox="0 0 500 500"
            aria-hidden
          >
            <path
              fill="white"
              id="Shape_1_copy"
              data-name="Shape 1 copy"
              className="cls-1"
              d="M144,138H357v44H144V138Zm0,60H357v44H144V198Zm0,60H357v44H144V258Zm0,60H357v44H144V318ZM198.142,17.521l27.674,50.746s75.162-14.217,140.056,37.7,73.757,127.8,70.788,160.92-23.612,77.214-28.228,84.286-5.183,6.866-5.183,6.866L378.1,325.365l-31.912,110.2,116.039,0.055L439.105,402s36.751-44.7,45.538-95.835,10.958-75.7-9.257-142.293C453.052,101.718,398.533,57.053,358.665,37.754S274.621,10.275,246.31,11.787C217.535,13.324,198.142,17.521,198.142,17.521ZM304.077,485.574L276.426,434.88s-75.1,14.2-139.94-37.661-73.7-127.664-70.73-160.753,23.592-77.135,28.2-84.2,5.178-6.859,5.178-6.859l25.128,32.64L156.152,67.964,40.209,67.909l23.1,33.586s-36.721,44.658-45.5,95.734S6.864,272.846,27.064,339.375c22.315,62.088,76.789,106.707,116.624,125.987s83.974,27.451,112.262,25.94C284.7,489.767,304.077,485.574,304.077,485.574Z"
            />
          </svg>
        </DraggableCommandIcon>
      </div>
    </div>
  );
}

import { CircleDollarSign, Music2 } from "lucide-react";
import streaming from "../../assets/streaming_in_clock_off.png";

interface PlaylistCurrentBlockProps {
  predictedTimeLabel: string | null;
  /** Nome do programa (playlist), como em `pl.program`. */
  programName: string | null;
  /** `block.type` do bloco atual (`musical` | `commercial`, etc.). */
  blockType: string | null;
  /** Cor do ícone “ir para faixa atual” (`#454545` | `#ffffff` | `#353535`). */
  jumpArrowFill: string;
  /** `true` se há música tocando ou próxima agendada para rolar até ela. */
  canJumpToCurrentMusic: boolean;
  onJumpToCurrentMusic: () => void;
}

export function PlaylistCurrentBlock({
  predictedTimeLabel,
  programName,
  blockType,
  jumpArrowFill,
  canJumpToCurrentMusic,
  onJumpToCurrentMusic,
}: PlaylistCurrentBlockProps) {
  const line =
    predictedTimeLabel != null && programName != null
      ? `${predictedTimeLabel} (${programName})`
      : programName != null
        ? `— (${programName})`
        : null;

  const isCommercial = blockType === "commercial";
  const Icon = isCommercial ? CircleDollarSign : Music2;
  const showIcon = line != null && blockType != null;

  return (
    <div
      className="flex h-12 w-full shrink-0 items-center gap-2 border-b border-[#353535] px-2 justify-between"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        {showIcon ? (
          <Icon className="shrink-0" color="white" size={14} strokeWidth={2} aria-hidden />
        ) : null}
        {line ? (
          <span className="min-w-0 truncate text-[0.78rem] uppercase text-slate-200" title={line}>
            {line}
          </span>
        ) : (
          <span className="text-[0.72rem] text-slate-500">Sem programa na fila</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <p id="played-music-btn-top" className="flex items-center justify-center cursor-pointer bg-[#4d4d4d] m-0 transition-all uppercase text-xs duration-200 rounded-md p-0.5 px-2">
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px"
            fill="#e3e3e3">
            <path
              d="M400-120q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T480-418v-422h240v160H560v400q0 66-47 113t-113 47Z" />
          </svg>
          Tocou
        </p>
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="lucide lucide-list-chevrons-up-down playlist-compact-icon playlist-compact-icon-compact"
          aria-hidden="true">
          <path d="M3 5h8" />
          <path d="M3 12h8" />
          <path d="M3 19h8" />
          <path d="m15 8 3-3 3 3" />
          <path d="m15 16 3 3 3-3" />
        </svg>
        <svg xmlns="http://www.w3.org/2000/svg" height="26px" viewBox="0 -960 960 960" width="26px"
          fill="#e3e3e3">
          <path
            d="M480-480v-400q0-17 11.5-28.5T520-920q17 0 28.5 11.5T560-880v400h-80Zm-160 0v-360q0-17 11.5-28.5T360-880q17 0 28.5 11.5T400-840v360h-80ZM500-40q-142 0-241-99t-99-241v-380q0-17 11.5-28.5T200-800q17 0 28.5 11.5T240-760v380q0 109 75.5 184.5T500-120q109 0 184.5-75.5T760-380v-140q-17 0-28.5 11.5T720-480v160H600q-33 0-56.5 23.5T520-240v40h-80v-40q0-66 47-113t113-47h40v-400q0-17 11.5-28.5T680-840q17 0 28.5 11.5T720-800v207q10-3 19.5-5t20.5-2h80v220q0 142-99 241T500-40Zm40-320Z" />
        </svg>
        <button
          type="button"
          aria-label="Rolar até a música atual ou próxima agendada"
          title={canJumpToCurrentMusic ? 'Ir para música na playlist (T)' : 'Sem faixa atual na fila'}
          disabled={!canJumpToCurrentMusic}
          className={`m-0 border-0 bg-transparent p-0 ${canJumpToCurrentMusic ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}
          onClick={onJumpToCurrentMusic}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            height="26px"
            viewBox="0 -960 960 960"
            width="26px"
            aria-hidden
            fill={jumpArrowFill}
          >
            <path d="M440-80v-168l-64 64-56-56 160-160 160 160-56 56-64-64v168h-80ZM160-440v-80h640v80H160Zm320-120L320-720l56-56 64 64v-168h80v168l64-64 56 56-160 160Z" />
          </svg>
        </button>
        <img src={streaming} alt="" className="size-7" />
      </div>
    </div>
  );
}

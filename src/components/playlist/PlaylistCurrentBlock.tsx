import { CircleDollarSign, Music2 } from "lucide-react";

interface PlaylistCurrentBlockProps {
  predictedTimeLabel: string | null;
  /** Nome do programa (playlist), como em `pl.program`. */
  programName: string | null;
  /** `block.type` do bloco atual (`musical` | `commercial`, etc.). */
  blockType: string | null;
}

export function PlaylistCurrentBlock({
  predictedTimeLabel,
  programName,
  blockType,
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
      className="flex h-12 w-full shrink-0 items-center gap-2 border-b border-[#353535] px-2"
      role="status"
      aria-live="polite"
    >
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
  );
}

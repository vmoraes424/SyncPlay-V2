import type { DirFile, MediaCategory } from '../../types';
import { useLibraryItemDrag } from '../../hooks/usePlaylistItemDrag';

export interface LibraryMediaListItemProps {
  file: DirFile;
  mediaCategory: MediaCategory;
  idx: number;
  isSelected: boolean;
  isCueing: boolean;
  isCuePlaying: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  onCue: (e: React.MouseEvent) => void;
}

export function LibraryMediaListItem({
  file,
  mediaCategory,
  idx,
  isSelected,
  isCueing,
  isCuePlaying,
  onSelect,
  onDoubleClick,
  onCue,
}: LibraryMediaListItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useLibraryItemDrag(file, mediaCategory);

  return (
    <div
      id={`midia-item-${idx}`}
      ref={setNodeRef}
      {...attributes}
      className={[
        "flex items-center gap-2.5 px-3 h-9 cursor-default border-b border-[#353535]/50 select-none transition-colors duration-150",
        isSelected ? "bg-white/8 border-l-2 border-l-[#525252]" : "hover:bg-white/5",
        isCueing ? "bg-violet-500/12 border-l-2 border-l-violet-400" : "",
        isDragging ? "opacity-40" : "",
      ].join(" ")}
      title={file.path}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="flex h-full w-2 shrink-0 cursor-grab items-center justify-center touch-none self-stretch active:cursor-grabbing hover:bg-white/5 rounded-sm"
        {...listeners}
        aria-hidden
      />
      <button
        type="button"
        className={[
          "w-[26px] h-[26px] rounded-full flex items-center justify-center text-xs text-white/90 shrink-0 transition-all duration-200",
          isCuePlaying ? "bg-violet-700 animate-pulse-cue" : "bg-white/10 hover:bg-violet-400 hover:scale-110",
        ].join(" ")}
        title={isCuePlaying ? "Parar CUE" : "Preview CUE"}
        onClick={onCue}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {isCuePlaying ? "⏸" : "▶"}
      </button>
      <span className="flex-1 text-[0.82rem] text-white/90 whitespace-nowrap overflow-hidden text-ellipsis">{file.name.replace(/\.[^/.]+$/, "")}</span>
      <span className="text-[0.62rem] bg-white/10 text-slate-400 px-1.5 py-0.5 rounded font-semibold shrink-0">{file.name.split(".").pop()?.toUpperCase()}</span>
    </div>
  );
}

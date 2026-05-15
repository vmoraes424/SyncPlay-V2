import type { DirFile, MediaCategory } from '../../types';
import { formatTimeRemaining } from '../../time';
import { useLibraryItemDrag } from '../../hooks/usePlaylistItemDrag';
import { TYPE_ACERVO_BG, TYPE_BORDER } from '../../lib/mediaTypeItemStyles';

function playlistTypeFromMediaCategory(cat: MediaCategory): string | null {
  if (cat === 'musics') return 'music';
  if (cat === 'medias') return 'media';
  if (cat === 'others') return 'commercial';
  return null;
}

/** Mesma regra da playlist: `Artista - Faixa` → artista em cima, faixa embaixo (sem o traço). */
function splitArtistTitle(basename: string): { artist: string | null; track: string } {
  const idx = basename.indexOf(' - ');
  if (idx === -1) return { artist: null, track: basename };
  const artist = basename.slice(0, idx).trim();
  const track = basename.slice(idx + 3).trim();
  return { artist: artist || null, track: track || basename };
}

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

  const playlistType = playlistTypeFromMediaCategory(mediaCategory);
  const itemBg = playlistType ? TYPE_ACERVO_BG[playlistType] : undefined;
  const itemBorderColor = playlistType ? TYPE_BORDER[playlistType] : undefined;

  const outerStyle: React.CSSProperties = {
    ...(itemBorderColor ? { borderBottomColor: itemBorderColor } : {}),
  };

  const basename = file.name.replace(/\.[^/.]+$/, '');
  const { artist, track } = splitArtistTitle(basename);

  const ds = file.duration_sec;
  const durationLabel =
    ds != null && Number.isFinite(ds) && ds >= 0 ? formatTimeRemaining(ds) : null;

  return (
    <div
      id={`midia-item-${idx}`}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={[
        'group relative flex items-center gap-2.5 px-3 min-h-9 py-1 cursor-grab touch-none active:cursor-grabbing border-b border-[#353535]/50 select-none transition-colors duration-150',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
      style={outerStyle}
      title={file.path}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
    >
      {itemBg ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0"
          style={{ background: itemBg }}
        />
      ) : null}
      {!isSelected && !isCueing ? (
        <div className="pointer-events-none absolute inset-0 z-1 bg-transparent transition-colors group-hover:bg-white/5" />
      ) : null}
      {isSelected && !isCueing ? (
        <div className="pointer-events-none absolute inset-0 z-1 border-l-2 border-l-[#525252] bg-white/8" />
      ) : null}
      {isCueing ? (
        <div className="pointer-events-none absolute inset-0 z-1 border-l-2 border-l-violet-400 bg-violet-500/12" />
      ) : null}
      <button
        type="button"
        className={[
          'relative z-10 w-[26px] h-[26px] rounded-full flex items-center justify-center text-xs text-white/90 shrink-0 transition-all duration-200',
          isCuePlaying ? 'bg-violet-700 animate-pulse-cue' : 'bg-white/10 hover:bg-violet-400 hover:scale-110',
        ].join(' ')}
        title={isCuePlaying ? 'Parar CUE' : 'Preview CUE'}
        onClick={onCue}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {isCuePlaying ? '⏸' : '▶'}
      </button>
      <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-center gap-0 leading-snug">
        {artist ? (
          <>
            <span className="truncate text-[0.72rem] text-white/65" title={`${artist} — ${track}`}>
              {artist}
            </span>
            <span className="truncate text-[0.82rem] text-white/90" title={`${artist} — ${track}`}>
              {track}
            </span>
          </>
        ) : (
          <span className="truncate text-[0.82rem] text-white/90" title={track}>
            {track}
          </span>
        )}
      </div>
      <span
        className="relative z-10 shrink-0 self-center tabular-nums text-[0.72rem] text-white/55"
        title={durationLabel ? `Duração: ${durationLabel}` : undefined}
      >
        {durationLabel ?? '—'}
      </span>
    </div>
  );
}

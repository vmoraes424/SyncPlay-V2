import type { CSSProperties, MouseEvent } from 'react';
import { memo } from 'react';
import type { DirFile, MediaCategory } from '../../types';
import { formatTimeRemaining } from '../../time';
import { useLibraryItemDrag } from '../../hooks/usePlaylistItemDrag';
import { TYPE_ACERVO_BG, TYPE_BORDER } from '../../lib/mediaTypeItemStyles';

/** Ícone “relógio” quando o arquivo já está na playlist vs só no acervo. */
const CLOCK_IN_PLAYLIST = 'rgb(76, 175, 80)';
const CLOCK_NOT_IN_PLAYLIST = 'rgb(125, 125, 125)';

const AcervoPlaylistClockIcon = memo(function AcervoPlaylistClockIcon({
  inPlaylist,
}: {
  inPlaylist: boolean;
}) {
  const fill = inPlaylist ? CLOCK_IN_PLAYLIST : CLOCK_NOT_IN_PLAYLIST;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      width={24}
      height={24}
      className="shrink-0"
      fill={fill}
      role="img"
      aria-label={inPlaylist ? 'Arquivo já está na playlist' : 'Arquivo não está na playlist'}
    >
      <path d="M480-144q-140 0-238-98t-98-238h72q0 109 77.5 186.5T480-216q109 0 186.5-77.5T744-480q0-109-77.5-186.5T480-744q-62 0-114.55 25.6Q312.91-692.8 277-648h107v72H144v-240h72v130q46-60 114.5-95T480-816q70 0 131.13 26.6 61.14 26.6 106.4 71.87 45.27 45.26 71.87 106.4Q816-550 816-480t-26.6 131.13q-26.6 61.14-71.87 106.4-45.26 45.27-106.4 71.87Q550-144 480-144Zm100-200L444-480v-192h72v162l115 115-51 51Z" />
    </svg>
  );
});

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
  /** Caminho do arquivo coincide com alguma mídia já colocada na playlist. */
  inPlaylist: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  onCue: (e: MouseEvent) => void;
}

function LibraryMediaListItemInner({
  file,
  mediaCategory,
  idx,
  isSelected,
  isCueing,
  isCuePlaying,
  inPlaylist,
  onSelect,
  onDoubleClick,
  onCue,
}: LibraryMediaListItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useLibraryItemDrag(file, mediaCategory);

  const fallbackType = playlistTypeFromMediaCategory(mediaCategory);
  const styleKey = file.libraryPlaylistItemType ?? fallbackType;
  const itemBg = styleKey ? TYPE_ACERVO_BG[styleKey] : undefined;
  const itemBorderColor = styleKey ? TYPE_BORDER[styleKey] : undefined;

  const outerStyle: CSSProperties = {
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
        'group relative flex items-center gap-2.5 px-2 min-h-9 py-1 cursor-grab touch-none active:cursor-grabbing border-b border-[#353535]/50 select-none transition-colors duration-150',
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
      <div className="relative z-10 flex shrink-0 items-center gap-1 self-center">
        <span
          className="tabular-nums text-[0.72rem] text-white/55"
          title={durationLabel ? `Duração: ${durationLabel}` : undefined}
        >
          {durationLabel ?? '—'}
        </span>
        <AcervoPlaylistClockIcon inPlaylist={inPlaylist} />
      </div>
    </div>
  );
}

export const LibraryMediaListItem = memo(LibraryMediaListItemInner);

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { MutableRefObject, ReactNode } from 'react';
import type { Music } from '../../types';
import type { PlaylistItemType, PlaylistSortableItemData } from '../../types/dnd';

function playlistItemDragType(music: Music, _musicKey: string): PlaylistItemType {
  const t = (music.type ?? '').toLowerCase().trim();
  if (t === 'command') return 'COMMAND';
  return 'MEDIA';
}

export interface SortablePlaylistRowProps {
  uniqueId: string;
  plKey: string;
  blockKey: string;
  musicKey: string;
  music: Music;
  playlistItemRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  children: ReactNode;
}

export function SortablePlaylistRow({
  uniqueId,
  plKey,
  blockKey,
  musicKey,
  music,
  playlistItemRefs,
  children,
}: SortablePlaylistRowProps) {
  const type = playlistItemDragType(music, musicKey);
  const data: PlaylistSortableItemData = {
    type,
    sourceZone: 'PLAYLIST',
    sourceId: (music.path ?? music.path_storage ?? musicKey).trim() || musicKey,
    metadata: {
      title: music.text,
      path: music.path ?? music.path_storage,
      mediaType: music.type,
    },
    plKey,
    blockKey,
    musicKey,
  };

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: uniqueId,
    data,
  });

  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    if (node) playlistItemRefs.current[uniqueId] = node;
    else delete playlistItemRefs.current[uniqueId];
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  return (
    <div
      ref={setRefs}
      style={style}
      data-playlist-music-id={uniqueId}
      className="relative flex min-h-0"
      {...attributes}
    >
      <div
        className="w-2 shrink-0 cursor-grab touch-none self-stretch rounded-sm active:cursor-grabbing hover:bg-white/6"
        {...listeners}
        aria-hidden
      />
      <div className="min-w-0 min-h-0 flex-1">{children}</div>
    </div>
  );
}

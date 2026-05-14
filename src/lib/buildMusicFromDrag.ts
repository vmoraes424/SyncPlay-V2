import type { DragItemData } from '../types/dnd';
import type { MediaCategory, Music } from '../types';

export function buildMusicFromDrag(d: DragItemData, mediaCategory: MediaCategory): Music {
  if (d.type === 'COMMAND') {
    return {
      text: String(d.metadata?.title ?? d.sourceId),
      type: 'command',
      path: typeof d.metadata?.path === 'string' ? d.metadata.path : '',
    };
  }

  const path = String(d.metadata?.path ?? d.sourceId);
  const title = String(d.metadata?.title ?? path);
  const fromMeta =
    typeof d.metadata?.mediaType === 'string' ? d.metadata.mediaType.trim() : '';
  const mediaType =
    fromMeta ||
    (mediaCategory === 'musics' ? 'music' :
      mediaCategory === 'medias' ? 'media' :
        'media');

  return {
    text: title,
    path,
    type: mediaType,
  };
}

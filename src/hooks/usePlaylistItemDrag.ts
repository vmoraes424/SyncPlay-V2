import { useDraggable } from '@dnd-kit/core';
import type { DirFile, MediaCategory } from '../types';
import type { DragItemData } from '../types/dnd';

export function useLibraryItemDrag(file: DirFile, mediaCategory: MediaCategory) {
  const baseName = file.name.replace(/\.[^/.]+$/, '');
  const mediaType =
    mediaCategory === 'musics' ? 'music' :
      mediaCategory === 'medias' ? 'media' :
        'media';

  const data: DragItemData = {
    type: 'MEDIA',
    sourceZone: 'ACERVO',
    sourceId: file.path,
    metadata: {
      title: baseName,
      path: file.path,
      /** Nome com extensão — mesma chave típica de `music_library.json` / `media_library.json`. */
      fileName: file.name,
      mediaType,
    },
  };

  return useDraggable({
    id: `acervo:${file.path}`,
    data,
  });
}

export function useCommandIconDrag(
  commandId: string,
  label: string,
  metadata?: Record<string, unknown>,
) {
  const data: DragItemData = {
    type: 'COMMAND',
    sourceZone: 'COMANDOS',
    sourceId: commandId,
    metadata: {
      title: label,
      commandId,
      ...metadata,
    },
  };

  return useDraggable({
    id: `comando:${commandId}`,
    data,
  });
}

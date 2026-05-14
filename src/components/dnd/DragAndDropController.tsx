import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  PointerSensor,
  type CollisionDetection,
  pointerWithin,
  closestCorners,
  useSensor,
  useSensors,
  DragOverlay,
  type ClientRect,
} from '@dnd-kit/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  DragItemData,
  DroppablePlaylistBlockData,
  PlaylistInsertFromClonePayload,
  PlaylistReorderPayload,
  PlaylistSortableItemData,
  BotoneiraShortcutPayload,
} from '../../types/dnd';
import { DragOverlayCard } from './DragOverlayCard';

function isPlaylistSortableData(d: unknown): d is PlaylistSortableItemData {
  if (!d || typeof d !== 'object') return false;
  const o = d as PlaylistSortableItemData;
  return (
    o.sourceZone === 'PLAYLIST' &&
    typeof o.plKey === 'string' &&
    typeof o.blockKey === 'string' &&
    typeof o.musicKey === 'string'
  );
}

function isDroppablePlaylistEmpty(d: unknown): d is DroppablePlaylistBlockData {
  if (!d || typeof d !== 'object') return false;
  const o = d as DroppablePlaylistBlockData;
  return o.zone === 'PLAYLIST' && o.kind === 'block-empty';
}

function isDragItemData(d: unknown): d is DragItemData {
  if (!d || typeof d !== 'object') return false;
  const o = d as DragItemData;
  return (
    (o.type === 'MEDIA' || o.type === 'COMMAND' || o.type === 'BLOCK') &&
    typeof o.sourceZone === 'string' &&
    typeof o.sourceId === 'string'
  );
}

const BOTONEIRA_ZONE = 'BOTONEIRA' as const;

/** Evita `closestCenter` favorecer sempre o fim da lista em colunas roláveis. */
const playlistCollisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length > 0) return hits;
  return closestCorners(args);
};

export interface DragAndDropControllerProps {
  children: ReactNode;
  onPlaylistReorder?: (payload: PlaylistReorderPayload) => void;
  onPlaylistInsertFromClone?: (payload: PlaylistInsertFromClonePayload) => void;
  onBotoneiraShortcut?: (payload: BotoneiraShortcutPayload) => void;
}

export function DragAndDropController({
  children,
  onPlaylistReorder,
  onPlaylistInsertFromClone,
  onBotoneiraShortcut,
}: DragAndDropControllerProps) {
  const [activeItem, setActiveItem] = useState<DragItemData | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const lastPlaylistDropRef = useRef<
    DroppablePlaylistBlockData | PlaylistSortableItemData | null
  >(null);
  const lastPlaylistRowRectRef = useRef<ClientRect | null>(null);

  useEffect(() => {
    if (activeItem == null) return;
    const onMove = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [activeItem]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const clearPlaylistDropCache = () => {
    lastPlaylistDropRef.current = null;
    lastPlaylistRowRectRef.current = null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    clearPlaylistDropCache();
    lastPointerRef.current = null;
    const raw = event.active.data.current;
    if (isDragItemData(raw)) setActiveItem(raw);
    else setActiveItem(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const d = event.over?.data.current;
    if (isDroppablePlaylistEmpty(d) || isPlaylistSortableData(d)) {
      lastPlaylistDropRef.current = d;
      if (event.over?.rect) lastPlaylistRowRectRef.current = event.over.rect;
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveItem(null);

    if (!over) {
      clearPlaylistDropCache();
      return;
    }

    const activeData = active.data.current;
    if (!isDragItemData(activeData)) {
      clearPlaylistDropCache();
      return;
    }

    const overRaw = over.data.current;
    const effectivePlaylistDrop: unknown =
      isDroppablePlaylistEmpty(overRaw) || isPlaylistSortableData(overRaw)
        ? overRaw
        : lastPlaylistDropRef.current;

    if (
      overRaw &&
      typeof overRaw === 'object' &&
      'zone' in overRaw &&
      (overRaw as { zone: string }).zone === BOTONEIRA_ZONE
    ) {
      clearPlaylistDropCache();
      onBotoneiraShortcut?.({
        drag: activeData,
        instanceId: crypto.randomUUID(),
      });
      return;
    }

    if (
      isPlaylistSortableData(activeData) &&
      isPlaylistSortableData(overRaw) &&
      activeData.plKey === overRaw.plKey &&
      activeData.blockKey === overRaw.blockKey
    ) {
      clearPlaylistDropCache();
      if (active.id !== over.id) {
        onPlaylistReorder?.({
          plKey: activeData.plKey,
          blockKey: activeData.blockKey,
          activeUniqueId: String(active.id),
          overUniqueId: String(over.id),
        });
      }
      return;
    }

    if (activeData.sourceZone === 'ACERVO' || activeData.sourceZone === 'COMANDOS') {
      if (!onPlaylistInsertFromClone) {
        clearPlaylistDropCache();
        return;
      }

      if (isDroppablePlaylistEmpty(effectivePlaylistDrop)) {
        clearPlaylistDropCache();
        onPlaylistInsertFromClone({
          plKey: effectivePlaylistDrop.plKey,
          blockKey: effectivePlaylistDrop.blockKey,
          beforeMusicKey: null,
          drag: activeData,
        });
        return;
      }

      if (isPlaylistSortableData(effectivePlaylistDrop)) {
        const pointer = lastPointerRef.current;
        const rowRect = lastPlaylistRowRectRef.current ?? over.rect;
        let insertPlacement: 'before' | 'after' | undefined;
        if (pointer && rowRect) {
          const midY = rowRect.top + rowRect.height / 2;
          insertPlacement = pointer.y > midY ? 'after' : 'before';
        }
        clearPlaylistDropCache();
        onPlaylistInsertFromClone({
          plKey: effectivePlaylistDrop.plKey,
          blockKey: effectivePlaylistDrop.blockKey,
          beforeMusicKey: effectivePlaylistDrop.musicKey,
          insertPlacement,
          drag: activeData,
        });
      } else {
        clearPlaylistDropCache();
      }
    } else {
      clearPlaylistDropCache();
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={playlistCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        <DragOverlayCard item={activeItem} />
      </DragOverlay>
    </DndContext>
  );
}

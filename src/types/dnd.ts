export type ZoneType = 'ACERVO' | 'COMANDOS' | 'PLAYLIST' | 'BOTONEIRA';

export type PlaylistItemType = 'MEDIA' | 'COMMAND' | 'BLOCK';

/** Metadados exibidos no overlay e ao montar `Music` no drop. */
export interface DragItemMetadata {
  title?: string;
  path?: string;
  /** Nome do arquivo com extensão (acervo / biblioteca). */
  fileName?: string;
  /** Tipo SyncPlay da mídia (ex.: music, media, vem). */
  mediaType?: string;
  commandId?: string;
  [key: string]: unknown;
}

export interface DragItemData {
  type: PlaylistItemType;
  sourceZone: ZoneType;
  /** ID original (path do arquivo, id semântico do comando, etc.). */
  sourceId: string;
  metadata?: DragItemMetadata;
}

/** Item já materializado na playlist (React key / dnd sortable id = uniqueId). */
export interface PlaylistSortableItemData extends DragItemData {
  sourceZone: 'PLAYLIST';
  plKey: string;
  blockKey: string;
  musicKey: string;
}

export interface DroppablePlaylistBlockData {
  zone: 'PLAYLIST';
  kind: 'block-empty';
  plKey: string;
  blockKey: string;
}

export type DroppableData = DroppablePlaylistBlockData;

export interface PlaylistReorderPayload {
  plKey: string;
  blockKey: string;
  activeUniqueId: string;
  overUniqueId: string;
}

export interface PlaylistInsertFromClonePayload {
  plKey: string;
  blockKey: string;
  /** Inserir antes desta chave no bloco; `null` = início (ex.: bloco vazio). */
  beforeMusicKey: string | null;
  /**
   * Com `beforeMusicKey` definido: `before` (default) = antes da linha; `after` = depois
   * (útil com ponteiro na metade inferior da linha — ex.: após a última faixa = fim do bloco).
   */
  insertPlacement?: 'before' | 'after';
  drag: DragItemData;
}

export interface BotoneiraShortcutPayload {
  /** Reservado para fase futura. */
  drag: DragItemData;
  instanceId: string;
}

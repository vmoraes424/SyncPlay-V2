// ─── Tipos compartilhados entre App e componentes ─────────────────────────────

export type MediaCategory = 'unset' | 'musics' | 'medias' | 'others';
export type DirectoryOptionKind = 'sync' | 'manual' | 'collection' | 'streaming';

export interface DirectoryOption {
  value: string;
  label: string;
  kind: DirectoryOptionKind;
}

export interface DirFile {
  name: string;
  path: string;
  size_bytes: number;
}

export interface MixData {
  mix_init?: number;
  mix_end?: number;
  duration_real?: number;
  duration_total?: number;
  mix_total_milesecond?: number;
}

export interface ExtraData {
  fixed?: boolean;
  mix?: MixData;
}

export interface Music {
  text?: string;
  type?: string;
  id?: number;
  start?: number;
  duration?: number;
  path?: string;
  extra?: ExtraData;
  disabled?: boolean | number;
  discarded?: boolean | number;
  manualDiscard?: boolean | number;
  manual_discard?: boolean | number;
  manualType?: boolean | number;
  manual_type?: boolean | number;
  disableDiscard?: boolean | number;
  disable_discard?: boolean | number;
}

export interface Block {
  type: string;
  start?: number;
  duration?: number;
  size?: number;
  disableDiscard?: boolean | number;
  disable_discard?: boolean | number;
  musics?: Record<string, Music>;
}

export interface Playlist {
  program: string;
  start?: number;
  duration?: number;
  blocks: Record<string, Block>;
}

export interface SyncPlayData {
  playlists: Record<string, Playlist>;
}

export interface PlayableItem {
  id: string;
  path: string;
  mix_end_ms: number | null;
  duration_ms: number | null;
  fade_duration_ms: number | null;
}

export interface ScheduledMusicDto {
  id: string;
  title: string;
  path: string;
  targetStartSec: number;
  durationSec: number | null;
  mixOutSec: number | null;
  disabled: boolean;
}

export interface ScheduledMediaDto {
  id: string;
  title: string;
  mediaType: string;
  path: string;
  durationSec: number | null;
  mixOutSec: number | null;
  disabled: boolean;
  discarded: boolean;
  manualDiscard: boolean;
  fixed: boolean;
  manualType: boolean;
  disableDiscard: boolean;
}

export interface ScheduledBlockDto {
  id: string;
  startSec: number;
  sizeSec: number;
  disableDiscard: boolean;
  medias: ScheduledMediaDto[];
}

export type ScheduleSelectionDto =
  | {
      type: 'active';
      musicId: string;
      elapsedSec: number;
      activeQueueIds: string[];
    }
  | {
      type: 'upcoming';
      musicId: string;
      startsInSec: number;
      activeQueueIds: string[];
    }
  | {
      type: 'empty';
      activeQueueIds: string[];
    };

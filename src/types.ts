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

/** Estrutura do arquivo C:/SyncPlay/Configs/mix.json */
export interface MixConfig {
  /** Fadeout de músicas em ms (0 = toca até o fim sem ramp) */
  music_fade_out_time?: number;
  /** Fadeout de mídias em ms (0 = toca até o fim sem ramp) */
  media_fade_out_time?: number;
  /** Tempos de mix por tipo (reservado para uso futuro) */
  mix_commercial?: number;
  mix_bumper?: number;
  mix_media?: number;
  mix_others?: number;
  mix_vem?: number;
  mix_prefix_and_right_time?: number;
  mix_right_time?: number;
  mix_prefix_and_temperatures?: number;
  mix_music?: number;
}

export interface ExtraData {
  fixed?: boolean;
  mix?: MixData;
}

export interface Music {
  text?: string;
  type?: string;
  /** URL remota (ex.: CDN) quando `path` é local/cache */
  path_storage?: string;
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
  /** Itens musicais (blocos tipo musical) */
  musics?: Record<string, Music>;
  /** Spot/comerciais (blocos tipo commercial no SyncPlay) */
  commercials?: Record<string, Music>;
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
  /** Fadeout automático (mix natural). 0 = sem ramp, toca até o fim. */
  fade_out_time_ms: number | null;
  /** Fadeout ao trocar manualmente (espaço ou clique). Música=3000, mídia=1500. */
  manual_fade_out_ms: number | null;
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
  rawStartSec: number | null;
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

export interface ScheduleMediaStartDto {
  id: string;
  rawStartSec: number | null;
  startSec: number;
  startLabel: string;
  active: boolean;
}

export type ScheduleSelectionDto =
  | {
      type: 'active';
      musicId: string;
      elapsedSec: number;
      activeQueueIds: string[];
      mediaStarts: ScheduleMediaStartDto[];
    }
  | {
      type: 'upcoming';
      musicId: string;
      startsInSec: number;
      activeQueueIds: string[];
      mediaStarts: ScheduleMediaStartDto[];
    }
  | {
      type: 'empty';
      activeQueueIds: string[];
      mediaStarts: ScheduleMediaStartDto[];
    };

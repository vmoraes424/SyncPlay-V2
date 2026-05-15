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
  /** Segundos (backend Symphonia); omitido ou null quando não detectável. */
  duration_sec?: number | null;
  /**
   * Tipo derivado de `music_library.json` / `media_library.json` (`playlist_type` + `vem`),
   * para cores no acervo (music, media, vem, intro, preview, commercial…).
   */
  libraryPlaylistItemType?: string;
}

/** Tempos de marcadores no waveform (SyncPlay), em segundos como string. */
export interface WaveformContent {
  intro?: string;
  mix_init?: string;
  mix_end?: string;
  chorus_init?: string;
  chorus_end?: string;
}

export interface MixData {
  mix_init?: number;
  mix_end?: number;
  duration_real?: number;
  duration_total?: number;
  mix_total_milesecond?: number;
  waveform_content?: WaveformContent;
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

/** Configurações de detecção automática de mix (de configs.json). */
export interface AutoMixSettings {
  /** Liga detecção automática para músicas (type === "music"). */
  automaticMix: boolean;
  /** Liga detecção automática para mídias não-música e não-comercial. */
  automaticMixMedia: boolean;
  /** Sensibilidade para músicas: 0–100. Default: 25. */
  musicMixSensitivity: number;
  /** Sensibilidade para mídias: 0–100. Default: 20. */
  mediaMixSensitivity: number;
  /** Modo de extração das amostras. */
  mixType: 'basic' | 'advanced';
}

export interface ExtraData {
  fixed?: boolean;
  favorite?: boolean;
  fitting?: boolean | number | string;
  mix?: MixData;
  /** Filtros / metadados SyncPlay (IDs ou texto já resolvido) */
  category?: string | number;
  style?: string | number;
  rhythm?: string | number;
  released?: string | number;
  nationality?: string | number;
  /** Acervo — mídia não-música */
  media_type?: string | number;
  tag_bumper?: string | number;
  /** Coleção única ou lista de IDs (acervo) */
  collection?: string | number | string[];
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
  /** Caminho ou URL da imagem de capa */
  cover?: string;
  extra?: ExtraData;
  /** Legado: HTML extra (exibido como texto seguro no React) */
  extraInfoHTML?: string;
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
  /** Horário fixo de referência (legado SyncPlay / `buildBlockHeaderHTML`) */
  start_alias?: string | number | null;
  /** Soma das durações reais das mídias (ms), preenchido em `read_playlist` (Rust) na chave homônima. */
  duration_real_total_ms?: number;
  disableDiscard?: boolean | number;
  disable_discard?: boolean | number;
  /** Itens musicais (blocos tipo musical) */
  musics?: Record<string, Music>;
  /** Spot/comerciais (blocos tipo commercial no SyncPlay) */
  commercials?: Record<string, Music>;
  /**
   * Ordem de exibição local das chaves de `musics` após inserções/reordenações em memória.
   * Necessário porque chaves numéricas ("0","1","2") em objetos JS sempre são ordenadas
   * numericamente pelo motor, o que jogaria novas entradas com chave UUID para o final.
   * Nunca enviado ao servidor — campo de controle local apenas.
   */
  _localMusicOrder?: string[];
  /** Mesma semântica de `_localMusicOrder` para blocos de comerciais. */
  _localCommercialOrder?: string[];
}

export interface Playlist {
  program: string;
  start?: number;
  duration?: number;
  blocks: Record<string, Block>;
}

/** Metadados do arquivo de playlist (SyncPlay), ex.: `header.extra.branch_*`. */
export interface SyncPlayHeaderExtra {
  station?: string;
  company_img?: string;
  branch_name?: string;
  branch_img?: string;
}

export interface SyncPlayHeader {
  date?: string;
  day?: string;
  type?: string;
  extra?: SyncPlayHeaderExtra;
}

export interface SyncPlayData {
  header?: SyncPlayHeader;
  playlists: Record<string, Playlist>;
}

export interface PlayableItem {
  id: string;
  /** ID numérico da mídia na biblioteca (music.id da playlist), usado como chave no cache mixPoints.json. */
  media_id: string | null;
  path: string;
  mix_end_ms: number | null;
  duration_ms: number | null;
  fade_duration_ms: number | null;
  /** Fadeout automático (mix natural). 0 = sem ramp, toca até o fim. */
  fade_out_time_ms: number | null;
  /** Fadeout ao trocar manualmente (espaço ou clique). Música=3000, mídia=1500. */
  manual_fade_out_ms: number | null;
  /** Tipo da mídia: "music", "vem", "commercial", etc. */
  media_type: string;
  /** Permite forçar o áudio para um canal específico do mixer (ex: "cue") */
  mixer_bus?: string;
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

export interface ScheduleMediaDiscardDto {
  id: string;
  discarded: boolean;
}

export type ScheduleSelectionDto =
  | {
      type: 'active';
      musicId: string;
      elapsedSec: number;
      activeQueueIds: string[];
      mediaStarts: ScheduleMediaStartDto[];
      mediaDiscards: ScheduleMediaDiscardDto[];
    }
  | {
      type: 'upcoming';
      musicId: string;
      startsInSec: number;
      activeQueueIds: string[];
      mediaStarts: ScheduleMediaStartDto[];
      mediaDiscards: ScheduleMediaDiscardDto[];
    }
  | {
      type: 'empty';
      activeQueueIds: string[];
      mediaStarts: ScheduleMediaStartDto[];
      mediaDiscards: ScheduleMediaDiscardDto[];
    };

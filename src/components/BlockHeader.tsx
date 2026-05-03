import { useId } from 'react';
import { ChevronDown, ChevronUp, Clock, ListMusic, Trash2 } from 'lucide-react';
import { formatSecondsOfDay, formatTimeRemaining } from '../time';

/** Metadados mínimos para ações no bloco (espelho de `blockInfo` no legado `player.js`). */
export interface BlockHeaderBlockMeta {
  playlist: string;
  block: string;
  program: string;
  isCommercialBlock: boolean;
}

export interface BlockHeaderProps {
  playlistKey: string;
  programKey: string;
  blockKey: string;
  /** Data já formatada ao lado do horário no `<h2>` (ex.: dd/mm/aaaa). */
  dateText: string;
  isCommercialBlock: boolean;
  /** Segundos do dia para início previsto (`formatSeconds` / `formatSecondsOfDay`). */
  startTimeSeconds?: number | null;
  /** Comprimento total do bloco em segundos (soma duration_real etc.); formato HH:MM:SS, não horário do dia. */
  durationSeconds?: number | null;
  /** `start_alias != null`: horário fixo + classe `bloco-fixed` no container pai. */
  hasFixedTime: boolean;
  isCurrentBlock: boolean;
  /** Valor inicial legado `"false"`; `"true"` esconde mídias desabilitadas no bloco. */
  dataHideDisabled: boolean;
  onToggleHideDisabled?: () => void;
  onClearBlock?: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}

function encodeBlockData(meta: BlockHeaderBlockMeta): string {
  return encodeURIComponent(JSON.stringify(meta));
}

function formatClockOfDay(seconds: number | null | undefined): string {
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? formatSecondsOfDay(seconds, true)
    : '—';
}

function formatElapsedDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  return formatTimeRemaining(seconds);
}

const timingChipBase =
  'tabular-nums font-bold text-xs tracking-[0.06em] whitespace-nowrap px-[0.42rem] py-px';

const iconBtnCore =
  'sign inline-flex cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 leading-none text-inherit transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400/50';

const iconBtnFilledHover = `${iconBtnCore} hover:bg-white/[0.06]`;
const iconBtnChevronHover = `${iconBtnCore} hover:bg-white/[0.04]`;

/**
 * Cabeçalho do bloco na playlist — equivalente React a `buildBlockHeaderHTML` em `resources/js/player.js`.
 * O container externo `.bloco` com drag-and-drop continua sendo o `<section>` no `App.tsx`.
 */
export function BlockHeader({
  playlistKey,
  programKey,
  blockKey,
  dateText,
  isCommercialBlock,
  startTimeSeconds,
  durationSeconds,
  hasFixedTime,
  isCurrentBlock,
  dataHideDisabled,
  onToggleHideDisabled,
  onClearBlock,
  expanded,
  onToggleExpanded,
}: BlockHeaderProps) {
  const listNextMusicsDomId = useId();
  const accent = isCommercialBlock ? '#258ad0' : '#f5a834';
  const textAccent = isCommercialBlock ? 'text-[#258ad0]' : 'text-[#f5a834]';
  const blocoTitle = isCommercialBlock ? 'Bloco Comercial' : 'Bloco Musical';
  const startTime = formatClockOfDay(startTimeSeconds);
  const blockDurationLabel = formatElapsedDuration(durationSeconds);
  const meta: BlockHeaderBlockMeta = {
    playlist: playlistKey,
    block: blockKey,
    program: programKey,
    isCommercialBlock,
  };
  const blockDataEncoded = encodeBlockData(meta);
  const showListNextMusics = isCurrentBlock && !isCommercialBlock;

  return (
    <header
      className={`playlist-block-header topo grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-start gap-x-[0.65rem] gap-y-2 px-[0.7rem] py-1 ${textAccent}`}
    >
      <div className="topo-col topo-timing-col flex min-w-0 flex-col items-start gap-[0.15rem]">
        <span className={`forecastStartTime ${timingChipBase}`} title="Previsão de início do bloco">
          {startTime}
        </span>
        <span className={`totalBlockTime ${timingChipBase}`} title="Duração total do bloco (soma duration_real das mídias)">
          {blockDurationLabel}
        </span>
      </div>
      <div className="topo-col topo-title-col flex min-w-0 flex-col justify-center gap-[0.35rem]">
        <h2 className="playlist-block-heading-title m-0 text-sm font-bold uppercase leading-snug tracking-[0.12em]">
          {blocoTitle}
          <br />
          <span className="playlist-block-heading-sub text-sm font-semibold normal-case tracking-[0.04em]">
            {startTime} — {dateText}
          </span>
        </h2>
        {hasFixedTime && (
          <div className="fixed-time inline-flex items-center gap-[0.35rem]" title="Horário fixo">
            <Clock size={14} aria-hidden strokeWidth={2} className="size-[14px] shrink-0 stroke-current text-current" />
            <span className="fixed-time-slot inline-block min-h-3.5 min-w-3" aria-hidden />
          </div>
        )}
      </div>
      <div className="topo-col topo-end-col flex min-w-0 items-center">
        <span className={`timeToEnd ${timingChipBase}`} title="Tempo até o fim do bloco">
          {blockDurationLabel}
        </span>
      </div>
      <div className="topo-col block-clear min-w-0">
        <div className="clear-adjacent flex shrink-0 items-center gap-1">
          {showListNextMusics && (
            <button
              id={`listNextMusics-${listNextMusicsDomId.replace(/:/g, '')}`}
              type="button"
              className={`clear-adjacent ${iconBtnFilledHover}`}
              title={
                dataHideDisabled
                  ? 'Mostrar músicas já tocadas / desabilitadas'
                  : 'Ocultar músicas já tocadas'
              }
              data-block={blockDataEncoded}
              data-hide-active={dataHideDisabled ? 'true' : 'false'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleHideDisabled?.();
              }}
            >
              <ListMusic size={18} strokeWidth={2} color={accent} aria-hidden />
            </button>
          )}
          {onClearBlock && (
            <button
              type="button"
              className={`clearBlock clear-adjacent ${iconBtnFilledHover}`}
              title="Limpar bloco"
              data-block={blockDataEncoded}
              onClick={(e) => {
                e.stopPropagation();
                onClearBlock();
              }}
            >
              <Trash2 size={18} strokeWidth={2} color={accent} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className={`chevron-container ${iconBtnChevronHover} flex items-center justify-center`}
            data-block={blockDataEncoded}
            title={expanded ? 'Recolher bloco' : 'Expandir bloco'}
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpanded();
            }}
          >
            {expanded ? (
              <ChevronUp size={22} strokeWidth={2} className="size-[22px] stroke-current text-current" aria-hidden />
            ) : (
              <ChevronDown size={22} strokeWidth={2} className="size-[22px] stroke-current text-current" aria-hidden />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

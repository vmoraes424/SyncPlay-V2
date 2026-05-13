import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { JsonObject } from '../../../api/superaudioAi';
import {
  addCloudPrompt,
  cloneCloudPrompt,
  fetchAiTokens,
  fetchAiVoices,
  fetchCloudPrompts,
} from '../../../api/superaudioAi';
import {
  AI_PROMPT_DRAG_MIME,
  buildAiPromptDragPayload,
  normalizeCompanyPrompt,
  normalizeGlobalPrompt,
  type NormalizedAiPromptCard,
} from './aiPromptsNormalize';
import {
  Loader2,
  Pencil,
  Trash2,
  WandSparkles,
  Infinity as InfinityIcon,
  Volume2,
  ListMusic,
  Copy,
  ChevronDown,
} from 'lucide-react';
import { getSyncPlaySn } from '../../../api/apiConfig';

export interface LibraryIaTabProps {
  /** Quando verdadeiro, o painel fica montado mas oculto (evita novo fetch ao trocar de aba da biblioteca). */
  hidden?: boolean;
  /**
   * Prioridade sobre `playlistStationFallback` — já deve refletir `sn` do arquivo quando o App faz merge.
   * Header HTTP: `X-SyncPlay-SN`.
   */
  syncPlaySn?: string;
  /** Fallback quando não há serial no arquivo (ex.: só estação na playlist). */
  playlistStationFallback?: string;
  /** Relê disco (`read_superaudio_api_config`) antes de um refresh manual. */
  onReloadSuperaudioApiConfig?: () => Promise<void>;
}

type ListMode = 'company' | 'global';

function strVal(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

async function enrichPromptPayloadForDrag(raw: JsonObject): Promise<JsonObject> {
  const url =
    strVal(raw.track_audio_url) ||
    strVal(raw.track_audio_path) ||
    strVal(raw.trackAudioUrl);
  if (url) return { ...raw, track_audio_url: url };

  const mid =
    raw.track_media_id ?? raw.trackMediaId ?? raw.media_id_track ?? raw.track_media_library_id;

  const mediaIdStr = strVal(mid);
  if (!mediaIdStr) return raw;

  try {
    const local = await invoke<string | null>('resolve_media_track_path', { mediaId: mediaIdStr });
    if (local) {
      return {
        ...raw,
        resolved_track_local_path: local,
      };
    }
  } catch {
    /* biblioteca pode não existir */
  }

  return raw;
}

/** Heurística sobre campos comuns vindos da API — só leitura na UI até existir PATCH. */
function readBoolFlag(raw: JsonObject, keys: string[], defaultTrue = false): boolean {
  for (const k of keys) {
    if (!(k in raw)) continue;
    const v = raw[k];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const s = strVal(v).toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
    if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  }
  return defaultTrue;
}

function providerLabel(raw: JsonObject, kind: 'text' | 'voice'): string {
  const tk =
    kind === 'text'
      ? strVal(raw.text_provider_token_id ?? raw.ai_text_provider ?? raw.provider_text)
      : strVal(raw.voice_provider_token_id ?? raw.ai_voice_provider ?? raw.provider_voice);
  if (!tk || tk === '0') return kind === 'text' ? 'Texto' : 'Voz';
  return tk.slice(0, 8);
}

function IconPromptCompany({ active }: { active: boolean }) {
  const fill = active ? '#ffffff' : '#787878';
  return (
    <svg id="promptLocal" data-permission="local" xmlns="http://www.w3.org/2000/svg" height="22px"
      viewBox="0 -960 960 960" width="22px" fill={fill}>
      <path
        fill={fill}
        d="M480-80q-84.33 0-157.33-30.83-73-30.84-127-84.84t-84.84-127Q80-395.67 80-480q0-83.67 30.83-156.67 30.84-73 84.84-127t127-85.16Q395.67-880 480-880q71.67 0 134.33 22.33Q677-835.33 728-796l-48 48.33q-42-31.33-92.33-48.5-50.34-17.16-107.67-17.16-141 0-237.17 96.16Q146.67-621 146.67-480t96.16 237.17Q339-146.67 480-146.67q35.33 0 68.33-6.66Q581.33-160 612-173l50 51q-41 20-86.67 31Q529.67-80 480-80Zm286.67-86.67v-120h-120v-66.66h120v-120h66.66v120h120v66.66h-120v120h-66.66ZM422-297.33 255.33-464.67 304-513.33l118 118L831.33-805l49.34 48.67-458.67 459Z" />
    </svg>
  );
}

function IconPromptGlobal({ active }: { active: boolean }) {
  const fill = active ? '#ffffff' : '#787878';
  return (
    <svg id="promptsGlobais" xmlns="http://www.w3.org/2000/svg" height="22px" viewBox="0 -960 960 960"
      width="22px" fill={fill}>
      <path
        fill={fill}
        d="M480-380Zm80 220H260q-91 0-155.5-63T40-377q0-78 47-139t123-78q25-92 100-149t170-57q106 0 184.5 68.5T757-560q-21 0-40.5 4.5T679-543q-8-75-65-126t-134-51q-83 0-141.5 58.5T280-520h-20q-58 0-99 41t-41 99q0 58 41 99t99 41h300v80Zm120 0q-17 0-28.5-11.5T640-200v-120q0-17 11.5-28.5T680-360v-40q0-33 23.5-56.5T760-480q33 0 56.5 23.5T840-400v40q17 0 28.5 11.5T880-320v120q0 17-11.5 28.5T840-160H680Zm40-200h80v-40q0-17-11.5-28.5T760-440q-17 0-28.5 11.5T720-400v40Z" />
    </svg>
  );
}

export function LibraryIaTab({
  hidden,
  syncPlaySn,
  playlistStationFallback,
  onReloadSuperaudioApiConfig,
}: LibraryIaTabProps) {
  const serialFromProps = (syncPlaySn ?? playlistStationFallback ?? '').trim();
  const [listMode, setListMode] = useState<ListMode>('company');
  const [aiSearch, setAiSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [companyCards, setCompanyCards] = useState<NormalizedAiPromptCard[]>([]);
  const [globalCards, setGlobalCards] = useState<NormalizedAiPromptCard[]>([]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [cadastrarOpen, setCadastrarOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPromptText, setNewPromptText] = useState('');
  const [cadastrarSaving, setCadastrarSaving] = useState(false);
  const [cloningId, setCloningId] = useState<string | null>(null);

  async function resolveSerial(opts?: { rereadConfigFile?: boolean }): Promise<string> {
    if (opts?.rereadConfigFile && onReloadSuperaudioApiConfig) {
      await onReloadSuperaudioApiConfig();
      const fromWindow =
        typeof window !== 'undefined' && window.apiConfig
          ? getSyncPlaySn(window.apiConfig).trim()
          : '';
      if (fromWindow) return fromWindow;
    }
    return serialFromProps;
  }

  const loadAll = useCallback(
    async (opts?: { rereadConfigFile?: boolean }) => {
      const serial = await resolveSerial({ rereadConfigFile: opts?.rereadConfigFile });
      if (!serial) {
        setLoadError(null);
        setCompanyCards([]);
        setGlobalCards([]);
        return;
      }
      setLoading(true);
      setLoadError(null);

      try {
        const [, , payload] = await Promise.all([
          fetchAiVoices(serial).catch(() => null),
          fetchAiTokens(serial).catch(() => null),
          fetchCloudPrompts(serial),
        ]);

        const companyRaw = Array.isArray(payload.company_prompts) ? payload.company_prompts : [];
        const globalRaw = Array.isArray(payload.global_prompts) ? payload.global_prompts : [];

        setCompanyCards(
          companyRaw
            .map((item) =>
              normalizeCompanyPrompt(typeof item === 'object' && item ? (item as JsonObject) : {})
            )
            .sort((a, b) => a.title.localeCompare(b.title, 'pt'))
        );

        setGlobalCards(
          globalRaw
            .map((item) =>
              normalizeGlobalPrompt(typeof item === 'object' && item ? (item as JsonObject) : {})
            )
            .sort((a, b) => a.title.localeCompare(b.title, 'pt'))
        );
      } catch (e: unknown) {
        setCompanyCards([]);
        setGlobalCards([]);
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [serialFromProps, onReloadSuperaudioApiConfig]
  );

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (hidden) setCadastrarOpen(false);
  }, [hidden]);

  const visibleCards = listMode === 'company' ? companyCards : globalCards;

  const filteredCards = useMemo(() => {
    const q = aiSearch.trim().toLowerCase();
    if (!q) return visibleCards;
    return visibleCards.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.body.toLowerCase().includes(q) ||
        c.excerpt.toLowerCase().includes(q)
    );
  }, [visibleCards, aiSearch]);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const onClone = useCallback(
    async (card: NormalizedAiPromptCard) => {
      if (!serialFromProps || cloningId) return;
      setCloningId(card.id);
      try {
        const id =
          card.raw.id ?? card.raw.prompt_id ?? card.raw.promptId ?? card.raw._id;
        const body: JsonObject = id != null ? { id } : card.raw;
        await cloneCloudPrompt(serialFromProps, body as JsonObject);
        await loadAll();
      } catch (e: unknown) {
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        setCloningId(null);
      }
    },
    [serialFromProps, cloningId, loadAll]
  );

  const onSaveCadastro = useCallback(async () => {
    if (!serialFromProps || cadastrarSaving) return;
    const nome = newTitle.trim();
    const texto = newPromptText.trim();
    if (!nome || !texto) return;
    setCadastrarSaving(true);
    setLoadError(null);
    try {
      await addCloudPrompt(serialFromProps, {
        title: nome,
        name: nome,
        prompt: texto,
      });
      setCadastrarOpen(false);
      setNewTitle('');
      setNewPromptText('');
      await loadAll();
      setListMode('company');
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setCadastrarSaving(false);
    }
  }, [serialFromProps, cadastrarSaving, loadAll, newTitle, newPromptText]);

  const onDragStart = useCallback(
    async (card: NormalizedAiPromptCard, e: React.DragEvent) => {
      if (!serialFromProps) return;
      const enriched = await enrichPromptPayloadForDrag(card.raw);
      try {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData(AI_PROMPT_DRAG_MIME, buildAiPromptDragPayload(enriched));
      } catch {
        /* navegadores antigos */
      }
      e.currentTarget.classList.add('opacity-65');
      const el = e.currentTarget;
      const clear = () => el.classList.remove('opacity-65');
      window.setTimeout(clear, 0);
      el.addEventListener('dragend', clear, { once: true });
    },
    [serialFromProps]
  );

  const onDoubleActivate = useCallback(
    async (card: NormalizedAiPromptCard) => {
      if (!serialFromProps) return;
      const enriched = await enrichPromptPayloadForDrag(card.raw);
      window.dispatchEvent(
        new CustomEvent('syncplay:ai-prompt-insert', {
          bubbles: true,
          detail: { prompt: enriched, sourceCategory: card.category },
        })
      );
    },
    [serialFromProps]
  );

  return (
    <div
      id="library-tabpanel-ia"
      role="tabpanel"
      aria-labelledby="library-tab-ia"
      className="flex flex-1 min-h-0 flex-col overflow-hidden bg-[#1e1e1e]"
      hidden={hidden}
    >
      <div className="flex flex-col gap-2 shrink-0">
        {/* Barra `.search-ai-container`: empresa × global + busca + refresh */}
        <div className="search-ai-container flex w-full min-w-0 flex-wrap items-center gap-1 px-2 pt-2">
          <div className="flex min-h-9 min-w-[120px] flex-1 items-center gap-2 rounded-lg border border-[#353535] bg-white/3 px-2">
            <input
              id="searchAi"
              type="search"
              placeholder="Pesquisar prompts…"
              value={aiSearch}
              onChange={(e) => setAiSearch(e.target.value)}
              className="min-w-0 flex-1 bg-transparent py-1 text-[0.8rem] text-white/90 outline-none placeholder:text-slate-500"
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
          <button
            type="button"
            id="promptsGlobais"
            aria-pressed={listMode === 'global'}
            title="Prompts globais (catálogo — clonar para editar)"
            className={[
              'flex h-9 w-10 items-center justify-center rounded-lg border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500',
              listMode === 'global'
                ? 'active border-neutral-400 bg-white/15'
                : 'border-transparent bg-white/4 hover:bg-white/[0.07]',
            ].join(' ')}
            onClick={() => setListMode('global')}
          >
            <IconPromptGlobal active={listMode === 'global'} />
          </button>
          <button
            type="button"
            id="promptLocal"
            aria-pressed={listMode === 'company'}
            title="Prompts da empresa (editáveis)"
            className={[
              'flex h-9 w-10 items-center justify-center rounded-lg border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500',
              listMode === 'company'
                ? 'active border-neutral-400 bg-white/15'
                : 'border-transparent bg-white/4 hover:bg-white/[0.07]',
            ].join(' ')}
            onClick={() => setListMode('company')}
          >
            <IconPromptCompany active={listMode === 'company'} />
          </button>
          <button
            type="button"
            id="refreshPrompts"
            disabled={loading}
            title={
              serialFromProps
                ? 'Atualizar prompts e tokens na nuvem'
                : 'Informe SN em `%LOCALAPPDATA%\\\\SuperAudio\\\\configAPI` ou carregue a playlist com estação'
            }
            aria-busy={loading}
            className="flex h-9 w-10 shrink-0 items-center justify-center rounded-lg border border-transparent text-white/80 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:pointer-events-none disabled:opacity-40"
            onClick={() => void loadAll({ rereadConfigFile: true })}
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="26px" viewBox="0 -960 960 960"
              width="26px" fill="#FFFFFF">
              <path
                d="m482-200 114-113-114-113-42 42 43 43q-28 1-54.5-9T381-381q-20-20-30.5-46T340-479q0-17 4.5-34t12.5-33l-44-44q-17 25-25 53t-8 57q0 38 15 75t44 66q29 29 65 43.5t74 15.5l-38 38 42 42Zm165-170q17-25 25-53t8-57q0-38-14.5-75.5T622-622q-29-29-65.5-43T482-679l38-39-42-42-114 113 114 113 42-42-44-44q27 0 55 10.5t48 30.5q20 20 30.5 46t10.5 52q0 17-4.5 34T603-414l44 44ZM480-80q-82.33 0-155.33-31.5-73-31.5-127.34-85.83Q143-251.67 111.5-324.67T80-480q0-83 31.5-156t85.83-127q54.34-54 127.34-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 82.33-31.5 155.33-31.5 73-85.5 127.34Q709-143 636-111.5T480-80Zm0-66.67q139.33 0 236.33-97.33t97-236q0-139.33-97-236.33t-236.33-97q-138.67 0-236 97-97.33 97-97.33 236.33 0 138.67 97.33 236 97.33 97.33 236 97.33ZM480-480Z" />
            </svg>
          </button>
        </div>

        {!serialFromProps ? (
          <p className="px-3 text-[0.75rem] text-amber-200/95">
            Sem serial para <code className="text-[0.7rem]">X-SyncPlay-SN</code>: preencha{' '}
            <code className="text-[0.7rem]">sn</code> no arquivo{' '}
            <code className="text-[0.7rem]">%LOCALAPPDATA%\SuperAudio\configAPI</code> ou carregue a
            playlist com <code className="text-[0.7rem]">header.extra.station</code>.
          </p>
        ) : null}
        {loadError ? (
          <p className="mx-3 rounded-lg border border-red-500/45 bg-red-950/35 px-2 py-1.5 text-[0.72rem] text-red-100">
            {loadError}
          </p>
        ) : null}
      </div>

      <div
        id="ai-options-container"
        className="scrollable-y flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 py-2"
      >
        {listMode === 'company' ? (
          <button
            type="button"
            id="cadastrar-prompt-option"
            className="ai-option-register flex shrink-0 items-center gap-2 rounded-lg border border-dashed border-[#4f4f4f] bg-[#663399]/90 px-3 py-2.5 text-left text-[0.8rem] text-white/85 outline-none transition-all focus-visible:ring-2 hover:translate-y-[-2px]"
            onClick={() => setCadastrarOpen(true)}
          >
            <WandSparkles className="size-4 shrink-0 text-teal-300" strokeWidth={1.85} aria-hidden />
            <span className="font-semibold tracking-tight">Cadastrar Prompt</span>
          </button>
        ) : null}

        {!loading && serialFromProps && filteredCards.length === 0 ? (
          <p className="px-3 py-6 text-center text-[0.8rem] text-slate-500">
            Nenhum prompt encontrado nesta categoria{filteredEmptySuffix(aiSearch)}.
          </p>
        ) : null}

        {filteredCards.map((card) => {
          const expandedRow = !!expanded[card.id];
          const ttsOn = readBoolFlag(
            card.raw,
            ['tts_enabled', 'enable_tts', 'use_tts', 'tts_active'],
            true
          );
          const trackOn = readBoolFlag(
            card.raw,
            ['track_enabled', 'use_track', 'has_track', 'background_track'],
            Boolean(
              strVal(card.raw.track_audio_url) ||
              card.raw.track_media_id ||
              card.raw.trackMediaId
            )
          );
          const loopTrack = readBoolFlag(card.raw, ['track_loop', 'loop_track', 'music_loop'], false);
          const isCompany = card.category === 'company';
          const isCloningThis = cloningId === card.id;

          return (
            <div
              key={card.id}
              draggable
              data-category={card.category}
              className="ai-option group rounded-lg border border-[#383838] bg-[#353535] px-2.5 py-2 text-[0.78rem] text-white/85 shadow-[0_1px_0_rgba(255,255,255,0.03)] cursor-grab active:cursor-grabbing"
              onDragStart={(e) => void onDragStart(card, e)}
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                void onDoubleActivate(card);
              }}
            >
              <div className="flex gap-2">
                {/* Indicadores TTS / trilha */}
                <div className="flex shrink-0 flex-col gap-1 pt-0.5">
                  <button
                    type="button"
                    className={`tts-toggle-btn flex h-7 w-7 items-center justify-center rounded-md border outline-none transition-colors disabled:opacity-55 ${ttsOn
                      ? 'border-teal-500/60 bg-teal-950/55 text-teal-100'
                      : 'border-[#484848] bg-[#2a2a2a] text-slate-500'
                      }`}
                    title={
                      isCompany ? 'Estado de TTS (somente visual até PATCH na API).' : 'TTS (somente leitura — prompt global)'
                    }
                    aria-label="Indicador TTS"
                  >
                    <Volume2 className="size-[15px]" strokeWidth={2} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={`track-indicator-btn flex h-7 w-7 items-center justify-center rounded-md border outline-none transition-colors disabled:opacity-55 ${trackOn ? 'border-teal-400/65 bg-teal-950/40 text-teal-100' : 'border-[#484848] bg-[#282828] text-slate-500'
                      }`}
                    title={
                      isCompany ? 'Estado da trilha de fundo (somente visual até PATCH).' : 'Trilha (somente leitura — prompt global)'
                    }
                    aria-label="Indicador de trilha"
                  >
                    <ListMusic className="size-[15px]" strokeWidth={2} aria-hidden />
                  </button>
                </div>

                <div className="min-w-0 flex-1 flex flex-col gap-1">
                  <div className="flex flex-wrap items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold text-[0.84rem] text-white leading-snug block truncate">
                        {card.title}
                      </span>
                      <span className="ai-option-info mt-0.5 flex flex-wrap items-center gap-2 text-[0.62rem] text-slate-500">
                        <span className="inline-flex items-center gap-0.5" title="Provedores (heurística)">
                          <span className="provider-badge inline-flex rounded border border-[#4a5568]/80 px-1 py-px text-[10px] text-[#cfd8ea]">
                            {providerLabel(card.raw, 'text')}
                          </span>
                          <span className="provider-badge inline-flex rounded border border-[#4a5568]/80 px-1 py-px text-[10px] text-[#cfd8ea]">
                            {providerLabel(card.raw, 'voice')}
                          </span>
                        </span>
                        {(strVal(card.raw.track_audio_url) ||
                          card.raw.track_media_id ||
                          strVal(trackSummaryLabel(card.raw))) !== '' ||
                          typeof card.raw.track_media_id !== 'undefined' ? (
                          <span className="inline-flex items-center gap-0.5" title="Trilha de fundo">
                            <MusicNoteIcon />
                            <span className="max-w-28 truncate">
                              {strVal(trackSummaryLabel(card.raw)) ||
                                strVal(card.raw.track_media_id)?.slice(0, 8) ||
                                'URL'}
                            </span>
                            {loopTrack ? <InfinityIcon className="size-3 shrink-0 text-teal-500/85" aria-label="loop" /> : null}
                          </span>
                        ) : null}
                      </span>
                    </div>

                    {/* Ações à direita */}
                    <div className="flex shrink-0 items-start gap-0.5 pt-px">
                      {isCompany ? (
                        <>
                          <button
                            type="button"
                            className="ai-option-edit rounded-md p-1 text-slate-400 outline-none hover:bg-white/8 hover:text-white focus-visible:ring-1 focus-visible:ring-neutral-400"
                            title="Editar (API em evolução no Tauri)"
                            aria-label="Editar prompt"
                          >
                            <Pencil className="size-[15px]" strokeWidth={2} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="ai-option-delete rounded-md p-1 text-slate-500 outline-none hover:bg-red-950/55 hover:text-red-200 focus-visible:ring-1 focus-visible:ring-red-400"
                            title="Excluir (implementar comando Controla correspondente)"
                            aria-label="Excluir prompt"
                          >
                            <Trash2 className="size-[15px]" strokeWidth={2} aria-hidden />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="ai-option-clone rounded-md p-1 text-slate-300 outline-none hover:bg-white/8 hover:text-white focus-visible:ring-1 focus-visible:ring-neutral-400 disabled:opacity-45"
                          aria-label="Clonar prompt global para a empresa"
                          title="Clonar na nuvem"
                          disabled={isCloningThis || loading}
                          onClick={() => void onClone(card)}
                        >
                          {isCloningThis ? (
                            <Loader2 className="size-[15px] animate-spin" aria-hidden />
                          ) : (
                            <Copy className="size-[15px]" strokeWidth={2} aria-hidden />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="ai-option-info-text flex max-w-full items-start gap-1 rounded px-1 py-0.5 text-left hover:bg-white/6"
                    onClick={() => toggleExpanded(card.id)}
                    aria-expanded={expandedRow}
                  >
                    <p
                      className={[
                        'min-w-0 flex-1 text-[0.72rem] leading-relaxed text-slate-400',
                        expandedRow ? '' : 'line-clamp-3',
                      ].join(' ')}
                    >
                      {expandedRow ? card.body || '—' : card.excerpt || '—'}
                    </p>
                    <ChevronDown
                      strokeWidth={2}
                      className={[
                        'mt-px size-[14px] shrink-0 text-slate-600 transition-transform',
                        expandedRow ? 'rotate-180' : '',
                      ].join(' ')}
                      aria-hidden
                    />
                  </button>
                  <p className="sr-only">{card.body}</p>
                </div>
              </div>
            </div>
          );
        })}

        {loading ? (
          <div className="flex flex-col items-center gap-2 py-10 text-slate-500">
            <Loader2 className="size-6 animate-spin opacity-55" aria-hidden />
            <span className="text-[0.75rem]">Carregando prompts da nuvem…</span>
          </div>
        ) : null}
      </div>

      {/* Modal simples Cadastrar Prompt (`#modal-cadastrar-prompt` parity) */}
      {cadastrarOpen ? (
        <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/60 p-4" role="presentation">
          <div
            id="modal-cadastrar-prompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-cad-prompt-title"
            className="flex max-h-[90vh] w-full max-w-md flex-col gap-4 rounded-xl border border-[#3d3d3d] bg-[#1f1f1f] p-4 shadow-xl"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 id="modal-cad-prompt-title" className="text-sm font-bold text-white">
                Cadastrar prompt
              </h2>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-slate-500 hover:bg-white/10 hover:text-white"
                onClick={() => setCadastrarOpen(false)}
              >
                Fechar
              </button>
            </div>
            <label className="flex flex-col gap-1 text-[0.75rem] text-slate-300">
              Nome / título
              <input
                className="rounded-lg border border-[#454545] bg-[#2a2a2a] px-2 py-1.5 text-[0.8rem] text-white outline-none focus:border-neutral-400"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[0.75rem] text-slate-300">
              Texto do prompt
              <textarea
                className="scrollable-y min-h-[140px] resize-y rounded-lg border border-[#454545] bg-[#2a2a2a] px-2 py-1.5 text-[0.8rem] text-white outline-none focus:border-neutral-400"
                value={newPromptText}
                onChange={(e) => setNewPromptText(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={cadastrarSaving || !newTitle.trim() || !newPromptText.trim()}
              className="mt-1 rounded-lg bg-teal-700 px-4 py-2 text-[0.8rem] font-semibold text-white outline-none hover:bg-teal-600 disabled:opacity-35"
              onClick={() => void onSaveCadastro()}
            >
              {cadastrarSaving ? <Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden /> : null}
              Salvar na nuvem
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function filteredEmptySuffix(q: string) {
  return q.trim() ? ` com “${q.trim()}”` : '';
}

function trackSummaryLabel(raw: JsonObject): string {
  return strVal(raw.track_name ?? raw.music_name ?? raw.musicName ?? raw.track_title ?? '');
}

function MusicNoteIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={12} height={12} className="text-slate-500" aria-hidden>
      <path
        fill="currentColor"
        d="M12 3v13.55A4 4 0 007 21a4 4 0 004-4V7h8V5h-7V3h-5z"
      />
    </svg>
  );
}

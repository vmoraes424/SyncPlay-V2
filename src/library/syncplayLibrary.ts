import type { ExtraData, MixData, WaveformContent } from '../types';

/** Último segmento do caminho = nome do arquivo, com extensão */
export function fileBaseKey(fileName: string): string {
  return fileName.split(/[\\/]/).pop() ?? fileName;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Aceita mapa plano arquivo → meta ou estruturas aninhadas comuns */
export function findLibraryRow(
  lib: Record<string, unknown> | null | undefined,
  fileName: string
): Record<string, unknown> | null {
  if (!lib) return null;
  const base = fileBaseKey(fileName);
  const stem = base.replace(/\.[^/.]+$/, '');
  const slashNorm = fileName.replace(/\\/g, '/');
  const candidates = [
    fileName,
    slashNorm,
    base,
    stem,
    fileName.toLowerCase(),
    slashNorm.toLowerCase(),
    base.toLowerCase(),
    stem.toLowerCase(),
  ];
  for (const key of candidates) {
    const row = lib[key];
    const rec = asRecord(row);
    if (rec) return rec;
  }
  const nested = asRecord(lib.files) ?? asRecord(lib.data) ?? asRecord(lib.musics);
  if (nested) {
    for (const key of candidates) {
      const rec = asRecord(nested[key]);
      if (rec) return rec;
    }
  }
  return null;
}

export function pickStringMap(filters: Record<string, unknown> | null | undefined, ...sections: string[]): Record<string, string> {
  if (!filters) return {};
  for (const sec of sections) {
    const m = filters[sec];
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
      else if (v != null && typeof v !== 'object') out[k] = String(v);
    }
    if (Object.keys(out).length) return out;
  }
  return {};
}

export function resolveFilterLabel(
  filters: Record<string, unknown> | null | undefined,
  sections: string[],
  raw: unknown
): string | null {
  if (raw == null || raw === '') return null;
  const id = String(raw);
  const map = pickStringMap(filters, ...sections);
  return map[id] ?? id;
}

function normalizeCollectionIds(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return [String(raw)];
}

/** Linha no JSON do acervo: índice pode ser path completo ou só o nome do arquivo (legado SyncPlay). */
export function findLibraryRowForFile(
  lib: Record<string, unknown> | null | undefined,
  file: { path: string; name: string }
): Record<string, unknown> | null {
  return findLibraryRow(lib, file.path) ?? findLibraryRow(lib, file.name);
}

export function rowBelongsToCollectionId(row: Record<string, unknown>, collectionId: string): boolean {
  if (!collectionId) return false;
  const want = String(collectionId).trim();
  const ids = normalizeCollectionIds(row.collections ?? row.collection ?? row.collection_ids ?? row.colecoes);
  return ids.some((id) => String(id).trim() === want);
}

/** Filtro do select «Coleção - …» (value = id em music_filters / media_filters). */
export function fileBelongsToLibraryCollection(
  lib: Record<string, unknown> | null | undefined,
  file: { path: string; name: string },
  collectionId: string
): boolean {
  const row = findLibraryRowForFile(lib, file);
  if (!row) return false;
  return rowBelongsToCollectionId(row, collectionId);
}

/** Nomes de coleções (music_library + music_filters.collections) */
export function getMusicLibraryCollectionLabels(
  lib: Record<string, unknown> | null | undefined,
  filters: Record<string, unknown> | null | undefined,
  file: { path: string; name: string } | string
): string[] {
  const row =
    typeof file === 'string' ? findLibraryRow(lib, file) : findLibraryRowForFile(lib, file);
  if (!row) return [];
  const collMap = pickStringMap(filters, 'collections', 'collection');
  const ids = normalizeCollectionIds(row.collections ?? row.collection ?? row.collection_ids ?? row.colecoes);
  return ids.map((id) => collMap[id] ?? id).filter(Boolean);
}

/** Monta `extra` ao arrastar arquivo da biblioteca (IDs como no SyncPlay legado) */
export function buildMusicExtraFromLibraryRow(
  row: Record<string, unknown>,
  _filters: Record<string, unknown> | null | undefined
): ExtraData {
  const extra: ExtraData = {};
  const cat = row.category ?? row.categoria ?? row.id_category;
  const sty = row.style ?? row.estilo ?? row.id_style;
  const rhy = row.rhythm ?? row.ritmo ?? row.id_rhythm;
  const nat = row.nationality ?? row.nacionalidade ?? row.id_nationality;
  const rel = row.released ?? row.year ?? row.ano ?? row.release_year;
  if (cat != null) extra.category = cat as string | number;
  if (sty != null) extra.style = sty as string | number;
  if (rhy != null) extra.rhythm = rhy as string | number;
  if (nat != null) extra.nationality = nat as string | number;
  if (rel != null) extra.released = rel as string | number;
  if (row.favorite != null) extra.favorite = Boolean(row.favorite);
  if (row.fixed != null) extra.fixed = Boolean(row.fixed);
  if (row.fitting != null) extra.fitting = row.fitting as string | number | boolean;
  return extra;
}

export interface MediaAcervoLabels {
  mediaType?: string;
  tagBumper?: string;
  collections: string[];
  category?: string;
}

export function getMediaAcervoLabels(
  mediaLibrary: Record<string, unknown> | null | undefined,
  mediaFilters: Record<string, unknown> | null | undefined,
  filePath: string
): MediaAcervoLabels | null {
  if (!mediaLibrary || !filePath) return null;
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const row = findLibraryRow(mediaLibrary, fileName);
  if (!row) return null;

  const typesMap = pickStringMap(mediaFilters, 'medias_type', 'media_types', 'types');
  const tagsMap = pickStringMap(mediaFilters, 'tag_bumper', 'tags', 'bumpers');
  const collMap = pickStringMap(mediaFilters, 'collections', 'collection');
  const catMap = pickStringMap(mediaFilters, 'categories', 'category');

  const typeRaw = row.media_type ?? row.medias_type ?? row.tipo;
  const tagRaw = row.tag_bumper ?? row.tag ?? row.bumper;
  const catRaw = row.category ?? row.categoria;

  const collections = normalizeCollectionIds(row.collections ?? row.collection ?? row.collection_ids).map(
    (id) => collMap[id] ?? id
  );

  return {
    mediaType: typeRaw != null ? typesMap[String(typeRaw)] ?? String(typeRaw) : undefined,
    tagBumper: tagRaw != null ? tagsMap[String(tagRaw)] ?? String(tagRaw) : undefined,
    category: catRaw != null ? catMap[String(catRaw)] ?? String(catRaw) : undefined,
    collections: collections.filter(Boolean),
  };
}

export function findIdByLabel(map: Record<string, string>, label: string): string | null {
  const t = label.trim().toLowerCase();
  if (!t) return null;
  for (const [id, name] of Object.entries(map)) {
    if (name.trim().toLowerCase() === t) return id;
  }
  return null;
}

/**
 * Converte valor vindos do playlist/extra ou da linha do acervo (ID ou texto já resolvido)
 * para o mesmo ID usado nos selects (`music_filters`).
 */
export function resolveMusicFilterId(
  map: Record<string, string>,
  raw: unknown,
  displayLabel?: string | null
): string {
  if (raw != null && raw !== '') {
    const s = String(raw).trim();
    if (s !== '') {
      if (Object.prototype.hasOwnProperty.call(map, s)) return s;
      const idFromText = findIdByLabel(map, s);
      if (idFromText) return idFromText;
      return s;
    }
  }
  const lbl = displayLabel?.trim();
  return lbl ? findIdByLabel(map, lbl) ?? '' : '';
}

/** Remove tags HTML do legado para exibição segura */
export function stripHtmlToText(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function pickNonEmptyString(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = typeof v === 'string' ? v.trim() : String(v).trim();
  return s.length ? s : undefined;
}

function parseFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Mesma semântica do SyncPlay legado ao montar classe na playlist a partir do cadastro de mídia.
 * `playlist_type === 'tag'` + `vem` → `vem`; `'media'` ou tag sem vem → `media`; `'music'` → `music`.
 */
export function mapPlaylistTypeToMusicItemType(playlistType: unknown, vemRaw: unknown): string {
  const pt = String(playlistType ?? '')
    .trim()
    .toLowerCase();
  const vem =
    vemRaw === true ||
    vemRaw === 1 ||
    vemRaw === '1' ||
    String(vemRaw).toLowerCase() === 'true';
  if (pt === 'music') return 'music';
  if (pt === 'commercial') return 'commercial';
  if (pt === 'intro') return 'intro';
  if (pt === 'preview' || pt === 'bumper') return 'media';
  if (pt === 'media') return 'media';
  if (pt === 'tag') return vem ? 'vem' : 'media';
  return 'media';
}

/** Duração em segundos a partir da linha da biblioteca (API / JSON sync). */
export function extractLibraryRowDurationSeconds(row: Record<string, unknown>): number | undefined {
  const time = row.time;
  if (time && typeof time === 'object' && !Array.isArray(time)) {
    const t = time as Record<string, unknown>;
    const ms =
      parseFiniteNumber(t.milliseconds) ??
      parseFiniteNumber(t.millisecond) ??
      parseFiniteNumber(t.ms) ??
      parseFiniteNumber(t.total);
    if (ms !== undefined && ms > 0) return ms / 1000;
  }

  const mixRaw = row.mix;
  if (mixRaw && typeof mixRaw === 'object' && !Array.isArray(mixRaw)) {
    const m = mixRaw as Record<string, unknown>;
    const dr = parseFiniteNumber(m.duration_real) ?? parseFiniteNumber(m.duration_total);
    if (dr !== undefined && dr > 0) return dr / 1000;
  }

  const dur =
    parseFiniteNumber(row.duration) ??
    parseFiniteNumber(row.duracao) ??
    parseFiniteNumber(row.length);
  if (dur === undefined || dur <= 0) return undefined;
  // Acima de ~12 h em segundos ou valores enormes → provável ms
  if (dur > 48_000) return dur / 1000;
  return dur;
}

function waveformFromUnknown(raw: unknown): WaveformContent | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const w = raw as Record<string, unknown>;
  const pick = (k: string) => pickNonEmptyString(w[k]);
  const intro = pick('intro');
  const mix_init = pick('mix_init');
  const mix_end = pick('mix_end');
  const chorus_init = pick('chorus_init');
  const chorus_end = pick('chorus_end');
  const wc: WaveformContent = {};
  if (intro !== undefined) wc.intro = intro;
  if (mix_init !== undefined) wc.mix_init = mix_init;
  if (mix_end !== undefined) wc.mix_end = mix_end;
  if (chorus_init !== undefined) wc.chorus_init = chorus_init;
  if (chorus_end !== undefined) wc.chorus_end = chorus_end;
  return Object.keys(wc).length ? wc : undefined;
}

/** Copia objeto `mix` da biblioteca para `Music.extra.mix` (ms). */
export function normalizeMixDataFromUnknown(mixUnknown: unknown): MixData | undefined {
  if (!mixUnknown || typeof mixUnknown !== 'object' || Array.isArray(mixUnknown)) return undefined;
  const m = mixUnknown as Record<string, unknown>;
  const out: MixData = {};
  const mi = parseFiniteNumber(m.mix_init);
  const me = parseFiniteNumber(m.mix_end);
  const dr = parseFiniteNumber(m.duration_real);
  const dt = parseFiniteNumber(m.duration_total);
  const mtm = parseFiniteNumber(m.mix_total_milesecond ?? m.mix_total_millisecond);
  if (mi !== undefined) out.mix_init = mi;
  if (me !== undefined) out.mix_end = me;
  if (dr !== undefined) out.duration_real = dr;
  if (dt !== undefined) out.duration_total = dt;
  if (mtm !== undefined) out.mix_total_milesecond = mtm;
  const wc = waveformFromUnknown(m.waveform_content);
  if (wc) out.waveform_content = wc;
  return Object.keys(out).length ? out : undefined;
}

function isLikelyNumericIdString(s: string): boolean {
  return /^\d+$/.test(s.trim());
}

function nestedArtistName(raw: unknown): string | undefined {
  const o = asRecord(raw);
  if (!o) return undefined;
  return pickNonEmptyString(o.name ?? o.nome ?? o.title ?? o.label ?? o.description);
}

/**
 * Nome exibível do intérprete — evita usar ID numérico cru em `music.text` quando `artist` é só FK.
 */
export function resolveLibraryRowArtistLabel(
  row: Record<string, unknown>,
  musicFilters: Record<string, unknown> | null | undefined,
): string | undefined {
  const fromNested =
    nestedArtistName(row.artist) ??
    nestedArtistName(row.artista) ??
    nestedArtistName(row.interpreter) ??
    nestedArtistName(row.interprete);
  if (fromNested) return fromNested;

  const explicit = pickNonEmptyString(
    row.artist_name ??
      row.artistName ??
      row.artist_label ??
      row.artistLabel ??
      row.nome_artista ??
      row.nomeArtista ??
      row.artista_nome ??
      row.interpreter_name ??
      row.interpreterName ??
      row.singer_name,
  );
  if (explicit) return explicit;

  const idArtistRaw = row.id_artist ?? row.idArtist ?? row.artist_id ?? row.idInterpreter;
  const idArtist =
    idArtistRaw != null && String(idArtistRaw).trim() !== '' ? String(idArtistRaw).trim() : '';

  let scalarStr = '';
  for (const k of [row.artist, row.artista, row.author, row.autor]) {
    if (k == null || k === '') continue;
    const s = typeof k === 'string' ? k.trim() : String(k).trim();
    if (!s) continue;
    scalarStr = s;
    break;
  }

  const lookupKey = idArtist || scalarStr;
  if (lookupKey && musicFilters && isLikelyNumericIdString(lookupKey)) {
    const map = pickStringMap(
      musicFilters,
      'artists',
      'artist',
      'interpreters',
      'cantores',
      'singers',
    );
    const lbl = map[lookupKey];
    if (lbl) return lbl;
  }

  if (scalarStr && !isLikelyNumericIdString(scalarStr)) return scalarStr;

  return undefined;
}

export function libraryRowDisplayTitle(
  row: Record<string, unknown>,
  fileStemFallback: string,
  musicFilters?: Record<string, unknown> | null,
): string {
  const tituloDirect = pickNonEmptyString(
    row.titulo ??
      row.title ??
      row.track_name ??
      row.track ??
      row.music_name ??
      row.nome_musica ??
      row.nome_faixa,
  );

  const nameFallback = pickNonEmptyString(row.name ?? row.nome);
  const titulo =
    tituloDirect ??
    (nameFallback && !isLikelyNumericIdString(nameFallback) ? nameFallback : undefined);

  const artistLabel = resolveLibraryRowArtistLabel(row, musicFilters ?? null);

  if (artistLabel && titulo) return `${artistLabel} - ${titulo}`;
  if (titulo) return titulo;
  if (artistLabel) return artistLabel;
  if (nameFallback) return nameFallback;
  return fileStemFallback;
}

export function libraryRowCover(row: Record<string, unknown>): string | undefined {
  return pickNonEmptyString(
    row.cover ?? row.cover_url ?? row.coverUrl ?? row.thumbnail ?? row.thumb ?? row.image ?? row.poster,
  );
}

export function libraryRowPathStorage(row: Record<string, unknown>): string | undefined {
  return pickNonEmptyString(
    row.path_storage ?? row.pathStorage ?? row.audio_url ?? row.audioUrl ?? row.url ?? row.stream_url,
  );
}

export function libraryRowNumericId(row: Record<string, unknown>): number | undefined {
  const raw = row.id ?? row.id_music ?? row.id_media;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return parseInt(raw.trim(), 10);
  return undefined;
}

/** Metadados `extra` para linhas de `media_library.json` (IDs como no legado). */
export function buildMediaExtraFromLibraryRow(row: Record<string, unknown>): ExtraData {
  const extra: ExtraData = {};
  const mt = row.media_type ?? row.medias_type ?? row.tipo;
  const tb = row.tag_bumper ?? row.tag ?? row.bumper;
  const coll = row.collections ?? row.collection ?? row.collection_ids ?? row.colecoes;
  const cat = row.category ?? row.categoria;

  if (mt != null && mt !== '') extra.media_type = mt as string | number;
  if (tb != null && tb !== '') extra.tag_bumper = tb as string | number;
  if (cat != null && cat !== '') extra.category = cat as string | number;

  if (coll != null && coll !== '') {
    if (Array.isArray(coll)) extra.collection = coll.map((x) => String(x)).filter(Boolean);
    else extra.collection = coll as string | number | string[];
  }

  if (row.favorite != null) extra.favorite = Boolean(row.favorite);
  if (row.fixed != null) extra.fixed = Boolean(row.fixed);
  if (row.fitting != null) extra.fitting = row.fitting as string | number | boolean;

  return extra;
}

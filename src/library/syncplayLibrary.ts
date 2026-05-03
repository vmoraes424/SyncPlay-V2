import type { ExtraData } from '../types';

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

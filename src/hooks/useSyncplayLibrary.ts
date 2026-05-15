import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import type { PlaylistFilterClickPayload, PlaylistFilterVisibility } from '../components/playlist/PlaylistMusicItem';
import type { SyncplayLibraryMaps } from '../library/SyncplayLibraryContext';
import {
  fileBelongsToLibraryCollection,
  findLibraryRowForFile,
  getMusicLibraryCollectionLabels,
  pickStringMap,
  resolveAcervoItemStyleKey,
  resolveMusicFilterId,
} from '../library/syncplayLibrary';
import { getAppSetting } from '../settings/settingsStorage';
import type { DirFile, DirectoryOptionKind, MediaCategory } from '../types';

async function fetchLibraryConfig<T>(filename: string): Promise<T | null> {
  try {
    const data: string = await invoke('read_config', { filename });
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function cfgBool(v: unknown, defaultFalse = false): boolean {
  if (v === undefined || v === null) return defaultFalse;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['1', 'true', 'yes', 'sim'].includes(s)) return true;
    if (['0', 'false', 'no', 'nao', 'não'].includes(s)) return false;
  }
  return Boolean(v);
}

export interface LibMusicFiltersState {
  categoryId: string;
  styleId: string;
  rhythmId: string;
  nationalityId: string;
  yearMin: string;
  yearMax: string;
  collectionLabel: string;
}

export function emptyLibMusicFilters(): LibMusicFiltersState {
  return {
    categoryId: '',
    styleId: '',
    rhythmId: '',
    nationalityId: '',
    yearMin: '',
    yearMax: '',
    collectionLabel: '',
  };
}

export function hasAnyLibMusicFacet(f: LibMusicFiltersState): boolean {
  return !!(
    f.categoryId ||
    f.styleId ||
    f.rhythmId ||
    f.nationalityId ||
    f.yearMin ||
    f.yearMax ||
    f.collectionLabel
  );
}

function yearFacetMatchesSelection(year: number, f: LibMusicFiltersState, libraryYearDecade: boolean): boolean {
  if (!f.yearMin.trim() || !f.yearMax.trim()) return false;
  const yMin = parseInt(f.yearMin, 10);
  const yMax = parseInt(f.yearMax, 10);
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return false;
  if (libraryYearDecade) {
    const d = Math.floor(year / 10) * 10;
    return yMin === d && yMax === d + 9;
  }
  return yMin === yMax && yMin === year;
}

const defaultPlaylistFilterVis: PlaylistFilterVisibility = {
  playlistShowMusicFilterYear: false,
  playlistShowMusicFilterCategory: false,
  playlistShowMusicFilterCollection: false,
  playlistShowMusicFilterStyle: false,
  playlistShowMusicFilterRhythm: false,
  playlistShowMusicFilterNationality: false,
  playlistShowMediaFilterCollection: false,
  playlistShowMediaFilterTag: false,
  playlistShowMediaFilterMediaType: false,
};

export interface UseSyncplayLibraryArgs {
  dirFiles: DirFile[];
  searchQuery: string;
  mediaCategory: MediaCategory;
  directoryValue: string;
  directoryKind: DirectoryOptionKind;
  /** Incrementar após atualizar JSON em disco (reload manual do acervo). */
  libraryRefreshKey: number;
  setMediaCategory: React.Dispatch<React.SetStateAction<MediaCategory>>;
  setDirectoryValue: React.Dispatch<React.SetStateAction<string>>;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
}

export interface UseSyncplayLibraryResult {
  libraryMaps: SyncplayLibraryMaps;
  filteredFiles: DirFile[];
  libMusicFilterIds: LibMusicFiltersState;
  setLibMusicFilterIds: React.Dispatch<React.SetStateAction<LibMusicFiltersState>>;
  resetLibMusicFilters: () => void;
  playlistFilterVis: PlaylistFilterVisibility;
  libraryYearDecade: boolean;
  showNameMusicFiles: boolean;
  showNameCommercialFiles: boolean;
  showNameMediaFiles: boolean;
  applyPlaylistFilterClick: (p: PlaylistFilterClickPayload) => void;
  musicCategoryMap: Record<string, string>;
  musicStyleMap: Record<string, string>;
  musicRhythmMap: Record<string, string>;
  musicNationalityMap: Record<string, string>;
}

export function useSyncplayLibrary({
  dirFiles,
  searchQuery,
  mediaCategory,
  directoryValue,
  directoryKind,
  libraryRefreshKey,
  setMediaCategory,
  setDirectoryValue,
  setSearchQuery,
}: UseSyncplayLibraryArgs): UseSyncplayLibraryResult {
  const [libraryMaps, setLibraryMaps] = useState<SyncplayLibraryMaps>({
    musicLibrary: null,
    musicFilters: null,
    mediaLibrary: null,
    mediaFilters: null,
  });

  const [libMusicFilterIds, setLibMusicFilterIds] = useState<LibMusicFiltersState>(emptyLibMusicFilters);

  const [playlistFilterVis, setPlaylistFilterVis] =
    useState<PlaylistFilterVisibility>(defaultPlaylistFilterVis);
  const [libraryYearDecade, setLibraryYearDecade] = useState(false);
  const [showNameMusicFiles, setShowNameMusicFiles] = useState(false);
  const [showNameCommercialFiles, setShowNameCommercialFiles] = useState(false);
  const [showNameMediaFiles, setShowNameMediaFiles] = useState(false);
  const musicCategoryMap = useMemo(
    () => pickStringMap(libraryMaps.musicFilters, 'categories', 'category'),
    [libraryMaps.musicFilters]
  );
  const musicStyleMap = useMemo(
    () => pickStringMap(libraryMaps.musicFilters, 'styles', 'style', 'estilos'),
    [libraryMaps.musicFilters]
  );
  const musicRhythmMap = useMemo(
    () => pickStringMap(libraryMaps.musicFilters, 'rhythms', 'rhythm', 'ritmos'),
    [libraryMaps.musicFilters]
  );
  const musicNationalityMap = useMemo(
    () => pickStringMap(libraryMaps.musicFilters, 'nationalities', 'nationality', 'paises'),
    [libraryMaps.musicFilters]
  );

  const filteredFiles = useMemo(() => {
    let files = dirFiles.filter((f) =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const collectionIdFromSelect =
      directoryKind === 'collection' && directoryValue && directoryValue !== '0' ? directoryValue : '';

    if (mediaCategory === 'musics' && collectionIdFromSelect && libraryMaps.musicLibrary) {
      const mlib = libraryMaps.musicLibrary;
      files = files.filter((file) => fileBelongsToLibraryCollection(mlib, file, collectionIdFromSelect));
    } else if (mediaCategory === 'medias' && collectionIdFromSelect && libraryMaps.mediaLibrary) {
      const mdlib = libraryMaps.mediaLibrary;
      files = files.filter((file) => fileBelongsToLibraryCollection(mdlib, file, collectionIdFromSelect));
    }

    if (mediaCategory !== 'musics') {
      return files.map((file) => {
        const libraryPlaylistItemType = resolveAcervoItemStyleKey(mediaCategory, libraryMaps, file);
        return libraryPlaylistItemType !== undefined ? { ...file, libraryPlaylistItemType } : file;
      });
    }

    const f = libMusicFilterIds;
    const hasAdv =
      f.categoryId ||
      f.styleId ||
      f.rhythmId ||
      f.nationalityId ||
      f.yearMin ||
      f.yearMax ||
      f.collectionLabel;

    if (!hasAdv || !libraryMaps.musicLibrary) {
      return files.map((file) => {
        const libraryPlaylistItemType = resolveAcervoItemStyleKey(mediaCategory, libraryMaps, file);
        return libraryPlaylistItemType !== undefined ? { ...file, libraryPlaylistItemType } : file;
      });
    }

    const yMin = f.yearMin ? parseInt(f.yearMin, 10) : NaN;
    const yMax = f.yearMax ? parseInt(f.yearMax, 10) : NaN;

    const mf = libraryMaps.musicFilters;
    const catMapEq = pickStringMap(mf, 'categories', 'category');
    const styleMapEq = pickStringMap(mf, 'styles', 'style', 'estilos');
    const rhythmMapEq = pickStringMap(mf, 'rhythms', 'rhythm', 'ritmos');
    const nationalityMapEq = pickStringMap(mf, 'nationalities', 'nationality', 'paises');

    const rowMetaId = (rowVal: unknown, map: Record<string, string>) =>
      resolveMusicFilterId(map, rowVal, null);

    const filtered = files.filter((file) => {
      const row = findLibraryRowForFile(libraryMaps.musicLibrary, file);
      if (!row) return false;

      const wantCat = String(f.categoryId).trim();
      const wantStyle = String(f.styleId).trim();
      const wantRhy = String(f.rhythmId).trim();
      const wantNat = String(f.nationalityId).trim();

      if (wantCat && rowMetaId(row.category ?? row.categoria ?? row.id_category, catMapEq) !== wantCat)
        return false;
      if (wantStyle && rowMetaId(row.style ?? row.estilo ?? row.id_style, styleMapEq) !== wantStyle)
        return false;
      if (wantRhy && rowMetaId(row.rhythm ?? row.ritmo ?? row.id_rhythm, rhythmMapEq) !== wantRhy)
        return false;
      if (wantNat && rowMetaId(row.nationality ?? row.nacionalidade ?? row.id_nationality, nationalityMapEq) !== wantNat)
        return false;

      const yearRaw = row.released ?? row.year ?? row.ano ?? row.release_year;
      const year =
        typeof yearRaw === 'number' ? yearRaw : parseInt(String(yearRaw ?? '').replace(/\D/g, ''), 10);
      if (!Number.isNaN(yMin) && (Number.isNaN(year) || year < yMin)) return false;
      if (!Number.isNaN(yMax) && (Number.isNaN(year) || year > yMax)) return false;

      if (f.collectionLabel) {
        const labs = getMusicLibraryCollectionLabels(
          libraryMaps.musicLibrary,
          libraryMaps.musicFilters,
          file
        );
        const want = f.collectionLabel.trim().toLowerCase();
        if (!labs.some((l) => l.trim().toLowerCase() === want)) return false;
      }
      return true;
    });

    return filtered.map((file) => {
      const libraryPlaylistItemType = resolveAcervoItemStyleKey(mediaCategory, libraryMaps, file);
      return libraryPlaylistItemType !== undefined ? { ...file, libraryPlaylistItemType } : file;
    });
  }, [
    dirFiles,
    searchQuery,
    mediaCategory,
    directoryValue,
    directoryKind,
    libMusicFilterIds,
    libraryMaps.musicLibrary,
    libraryMaps.mediaLibrary,
    libraryMaps.musicFilters,
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [ml, mf, medl, medf] = await Promise.all([
        fetchLibraryConfig<unknown>('Library/music_library.json'),
        fetchLibraryConfig<unknown>('Library/music_filters.json'),
        fetchLibraryConfig<unknown>('Library/media_library.json'),
        fetchLibraryConfig<unknown>('Library/media_filters.json'),
      ]);
      if (cancelled) return;
      setLibraryMaps({
        musicLibrary: ml && typeof ml === 'object' ? (ml as Record<string, unknown>) : null,
        musicFilters: mf && typeof mf === 'object' ? (mf as Record<string, unknown>) : null,
        mediaLibrary: medl && typeof medl === 'object' ? (medl as Record<string, unknown>) : null,
        mediaFilters: medf && typeof medf === 'object' ? (medf as Record<string, unknown>) : null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const keys = [
        'playlistShowMusicFilterYear',
        'playlistShowMusicFilterCategory',
        'playlistShowMusicFilterCollection',
        'playlistShowMusicFilterStyle',
        'playlistShowMusicFilterRhythm',
        'playlistShowMusicFilterNationality',
        'playlistShowMediaFilterCollection',
        'playlistShowMediaFilterTag',
        'playlistShowMediaFilterMediaType',
        'libraryConfigYearDecade',
        'showNameMusicFiles',
        'showNameCommercialFiles',
        'showNameMediaFiles',
      ] as const;
      const vals = await Promise.all(keys.map((k) => getAppSetting(k)));
      if (cancelled) return;
      setPlaylistFilterVis({
        playlistShowMusicFilterYear: cfgBool(vals[0]),
        playlistShowMusicFilterCategory: cfgBool(vals[1]),
        playlistShowMusicFilterCollection: cfgBool(vals[2]),
        playlistShowMusicFilterStyle: cfgBool(vals[3]),
        playlistShowMusicFilterRhythm: cfgBool(vals[4]),
        playlistShowMusicFilterNationality: cfgBool(vals[5]),
        playlistShowMediaFilterCollection: cfgBool(vals[6]),
        playlistShowMediaFilterTag: cfgBool(vals[7]),
        playlistShowMediaFilterMediaType: cfgBool(vals[8]),
      });
      setLibraryYearDecade(cfgBool(vals[9]));
      setShowNameMusicFiles(cfgBool(vals[10]));
      setShowNameCommercialFiles(cfgBool(vals[11]));
      setShowNameMediaFiles(cfgBool(vals[12]));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetLibMusicFilters = useCallback(() => {
    setLibMusicFilterIds(emptyLibMusicFilters());
  }, []);

  const applyPlaylistFilterClick = useCallback(
    (p: PlaylistFilterClickPayload) => {
      if (p.kind === 'artist') {
        setMediaCategory('musics');
        setDirectoryValue('0');
        const artistNorm = p.artist.trim().toLowerCase();
        const searchNorm = searchQuery.trim().toLowerCase();
        if (searchNorm === artistNorm && !hasAnyLibMusicFacet(libMusicFilterIds)) {
          setSearchQuery('');
        } else {
          setSearchQuery(p.artist);
          setLibMusicFilterIds(emptyLibMusicFilters());
        }
        return;
      }
      if (p.kind === 'year') {
        setMediaCategory('musics');
        setDirectoryValue('0');
        setSearchQuery('');
        const y = p.year;
        setLibMusicFilterIds((prev) => {
          if (yearFacetMatchesSelection(y, prev, libraryYearDecade)) {
            return { ...prev, yearMin: '', yearMax: '' };
          }
          if (libraryYearDecade) {
            const d = Math.floor(y / 10) * 10;
            return { ...prev, yearMin: String(d), yearMax: String(d + 9) };
          }
          return { ...prev, yearMin: String(y), yearMax: String(y) };
        });
        return;
      }
      if (p.kind === 'collection') {
        setMediaCategory('musics');
        setDirectoryValue('0');
        setSearchQuery('');
        const want = p.label.trim().toLowerCase();
        setLibMusicFilterIds((prev) => {
          if (prev.collectionLabel.trim().toLowerCase() === want) {
            return { ...prev, collectionLabel: '' };
          }
          return { ...prev, collectionLabel: p.label };
        });
        return;
      }
      if (p.kind === 'mediaBrowse') {
        const labelNorm = p.label.trim().toLowerCase();
        const searchNorm = searchQuery.trim().toLowerCase();
        if (mediaCategory === 'medias' && directoryValue === '0' && searchNorm === labelNorm) {
          setSearchQuery('');
        } else {
          setMediaCategory('medias');
          setDirectoryValue('0');
          setSearchQuery(p.label);
          setLibMusicFilterIds(emptyLibMusicFilters());
        }
        return;
      }

      const map =
        p.field === 'category'
          ? musicCategoryMap
          : p.field === 'style'
            ? musicStyleMap
            : p.field === 'rhythm'
              ? musicRhythmMap
              : musicNationalityMap;
      const id = resolveMusicFilterId(map, p.raw, p.displayText);

      setMediaCategory('musics');
      setDirectoryValue('0');
      setSearchQuery('');
      setLibMusicFilterIds((prev) => {
        const key =
          p.field === 'category'
            ? 'categoryId'
            : p.field === 'style'
              ? 'styleId'
              : p.field === 'rhythm'
                ? 'rhythmId'
                : 'nationalityId';
        const cur = String(prev[key] ?? '').trim();
        const next = String(id).trim();
        if (cur !== '' && cur === next) {
          return { ...prev, [key]: '' };
        }
        return { ...prev, [key]: id };
      });
    },
    [
      directoryValue,
      libMusicFilterIds,
      libraryYearDecade,
      mediaCategory,
      musicCategoryMap,
      musicNationalityMap,
      musicRhythmMap,
      musicStyleMap,
      searchQuery,
      setDirectoryValue,
      setMediaCategory,
      setSearchQuery,
    ]
  );

  return {
    libraryMaps,
    filteredFiles,
    libMusicFilterIds,
    setLibMusicFilterIds,
    resetLibMusicFilters,
    playlistFilterVis,
    libraryYearDecade,
    showNameMusicFiles,
    showNameCommercialFiles,
    showNameMediaFiles,
    applyPlaylistFilterClick,
    musicCategoryMap,
    musicStyleMap,
    musicRhythmMap,
    musicNationalityMap,
  };
}

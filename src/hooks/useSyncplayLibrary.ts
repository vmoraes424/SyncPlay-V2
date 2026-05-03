import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import type { PlaylistFilterClickPayload, PlaylistFilterVisibility } from '../components/PlaylistMusicItem';
import type { SyncplayLibraryMaps } from '../library/SyncplayLibraryContext';
import {
  findIdByLabel,
  findLibraryRow,
  getMusicLibraryCollectionLabels,
  mergeExtraFromDroppedMusicFile,
  pickStringMap,
} from '../library/syncplayLibrary';
import { getAppSetting } from '../settings/settingsStorage';
import type { DirFile, MediaCategory, Music } from '../types';

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
  showNameMediaFiles: boolean;
  playlistFilterFocus: string | null;
  applyPlaylistFilterClick: (p: PlaylistFilterClickPayload) => void;
  musicCategoryMap: Record<string, string>;
  musicStyleMap: Record<string, string>;
  musicRhythmMap: Record<string, string>;
  musicNationalityMap: Record<string, string>;
  getDroppedMusicExtra: (fileName: string) => Music['extra'] | undefined;
}

export function useSyncplayLibrary({
  dirFiles,
  searchQuery,
  mediaCategory,
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
  const [showNameMediaFiles, setShowNameMediaFiles] = useState(false);
  const [playlistFilterFocus, setPlaylistFilterFocus] = useState<string | null>(null);

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
    if (mediaCategory !== 'musics') return files;

    const f = libMusicFilterIds;
    const hasAdv =
      f.categoryId ||
      f.styleId ||
      f.rhythmId ||
      f.nationalityId ||
      f.yearMin ||
      f.yearMax ||
      f.collectionLabel;

    if (!hasAdv || !libraryMaps.musicLibrary) return files;

    const yMin = f.yearMin ? parseInt(f.yearMin, 10) : NaN;
    const yMax = f.yearMax ? parseInt(f.yearMax, 10) : NaN;

    return files.filter((file) => {
      const row = findLibraryRow(libraryMaps.musicLibrary, file.name);
      if (!row) return false;
      if (f.categoryId && String(row.category ?? row.categoria ?? row.id_category ?? '') !== f.categoryId)
        return false;
      if (f.styleId && String(row.style ?? row.estilo ?? row.id_style ?? '') !== f.styleId)
        return false;
      if (f.rhythmId && String(row.rhythm ?? row.ritmo ?? row.id_rhythm ?? '') !== f.rhythmId)
        return false;
      if (
        f.nationalityId &&
        String(row.nationality ?? row.nacionalidade ?? row.id_nationality ?? '') !== f.nationalityId
      )
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
          file.name
        );
        const want = f.collectionLabel.trim().toLowerCase();
        if (!labs.some((l) => l.trim().toLowerCase() === want)) return false;
      }
      return true;
    });
  }, [
    dirFiles,
    searchQuery,
    mediaCategory,
    libMusicFilterIds,
    libraryMaps.musicLibrary,
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
  }, []);

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
      setShowNameMediaFiles(cfgBool(vals[11]));
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
        setPlaylistFilterFocus(`${p.itemUniqueId}:artist`);
        setMediaCategory('musics');
        setDirectoryValue('0');
        setSearchQuery(p.artist);
        setLibMusicFilterIds(emptyLibMusicFilters());
        return;
      }
      if (p.kind === 'year') {
        setPlaylistFilterFocus(`${p.itemUniqueId}:year`);
        setMediaCategory('musics');
        setDirectoryValue('0');
        const y = p.year;
        if (libraryYearDecade) {
          const d = Math.floor(y / 10) * 10;
          setLibMusicFilterIds({
            ...emptyLibMusicFilters(),
            yearMin: String(d),
            yearMax: String(d + 9),
          });
        } else {
          setLibMusicFilterIds({
            ...emptyLibMusicFilters(),
            yearMin: String(y),
            yearMax: String(y),
          });
        }
        setSearchQuery('');
        return;
      }
      if (p.kind === 'collection') {
        setPlaylistFilterFocus(`${p.itemUniqueId}:coll:${p.label}`);
        setMediaCategory('musics');
        setDirectoryValue('0');
        setLibMusicFilterIds({ ...emptyLibMusicFilters(), collectionLabel: p.label });
        setSearchQuery('');
        return;
      }
      if (p.kind === 'mediaBrowse') {
        setPlaylistFilterFocus(`${p.itemUniqueId}:mediaBrowse`);
        setMediaCategory('medias');
        setDirectoryValue('0');
        setSearchQuery(p.label);
        setLibMusicFilterIds(emptyLibMusicFilters());
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
      const id =
        p.raw != null && String(p.raw).trim() !== ''
          ? String(p.raw)
          : findIdByLabel(map, p.displayText) ?? '';

      setPlaylistFilterFocus(`${p.itemUniqueId}:${p.field}`);
      setMediaCategory('musics');
      setDirectoryValue('0');
      setSearchQuery('');
      setLibMusicFilterIds(() => {
        const base = emptyLibMusicFilters();
        if (p.field === 'category') base.categoryId = id;
        else if (p.field === 'style') base.styleId = id;
        else if (p.field === 'rhythm') base.rhythmId = id;
        else base.nationalityId = id;
        return base;
      });
    },
    [
      libraryYearDecade,
      musicCategoryMap,
      musicNationalityMap,
      musicRhythmMap,
      musicStyleMap,
      setDirectoryValue,
      setMediaCategory,
      setSearchQuery,
    ]
  );

  const getDroppedMusicExtra = useCallback(
    (fileName: string) => mergeExtraFromDroppedMusicFile(fileName, libraryMaps.musicLibrary),
    [libraryMaps.musicLibrary]
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
    showNameMediaFiles,
    playlistFilterFocus,
    applyPlaylistFilterClick,
    musicCategoryMap,
    musicStyleMap,
    musicRhythmMap,
    musicNationalityMap,
    getDroppedMusicExtra,
  };
}

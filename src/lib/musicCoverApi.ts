import { invoke } from '@tauri-apps/api/core';
import type { Dispatch, SetStateAction } from 'react';

import { legacyBool, patchMusicCoverInBlock } from '../playlist/playlistBlockHelpers';
import type { Music, SyncPlayData } from '../types';

/** Igual ao legado: `music` → Covers; demais buckets → MediaCovers. */
export function mapPlaylistMediaTypeToCoverApiType(mediaType: string | undefined): 'Covers' | 'MediaCovers' {
  const t = (mediaType ?? 'music').trim().toLowerCase();
  if (t === 'music') return 'Covers';
  return 'MediaCovers';
}

export function shouldFetchCatalogCoverArt(music: Music): boolean {
  if (legacyBool(music.manualType ?? music.manual_type)) return false;
  const id = music.id;
  if (id == null || !Number.isFinite(Number(id))) return false;
  const c = music.cover?.trim() ?? '';
  if (c !== '' && /^https?:\/\//i.test(c)) return false;
  return true;
}

/**
 * Fire-and-forget: insere com placeholder e depois preenche `cover` quando a API responder
 * (equiv. `updateCoverArtAsync` sem await).
 */
export function enqueuePlaylistCatalogCoverFetch(args: {
  setData: Dispatch<SetStateAction<SyncPlayData | null>>;
  syncPlaySn: string;
  bearerToken?: string;
  plKey: string;
  blockKey: string;
  musicKey: string;
  music: Music;
}): void {
  const { setData, syncPlaySn, bearerToken, plKey, blockKey, musicKey, music } = args;
  if (!syncPlaySn.trim() || !shouldFetchCatalogCoverArt(music)) return;

  const bucket = mapPlaylistMediaTypeToCoverApiType(music.type);
  const token = bearerToken?.trim() || null;

  void (async () => {
    try {
      const url = await invoke<string | null>('fetch_syncplay_music_cover', {
        mediaId: Number(music.id),
        coverBucket: bucket,
        syncPlaySn: syncPlaySn.trim(),
        bearerToken: token,
      });
      const trimmed = url?.trim();
      if (!trimmed) return;

      setData((prev) => {
        if (!prev) return prev;
        return patchMusicCoverInBlock(prev, plKey, blockKey, musicKey, trimmed) ?? prev;
      });
    } catch (e) {
      console.warn('[music-cover]', e);
    }
  })();
}

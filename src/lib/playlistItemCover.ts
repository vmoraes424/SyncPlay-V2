import type { MediaAcervoLabels } from '../library/syncplayLibrary';

import acervoImg from '../assets/associacoes/acervo.png';
import comercialImg from '../assets/associacoes/comercial.png';
import introImg from '../assets/associacoes/intro.png';
import jornalismoImg from '../assets/associacoes/jornalismo.png';
import locucoesImg from '../assets/associacoes/locucoes.png';
import midiasImg from '../assets/associacoes/midias.png';
import musicasImg from '../assets/associacoes/musicas.png';
import previewImg from '../assets/associacoes/preview.png';
import programetesImg from '../assets/associacoes/programetes.png';
import vemImg from '../assets/associacoes/vem.png';
import vhImg from '../assets/associacoes/vh.png';

/**
 * Caminho de capa padrão por tipo de mídia (playlist / SyncPlay).
 * Não há `capa_sem_foto` no repositório: tipos desconhecidos usam a arte genérica de mídias.
 */
export function getDefaultCoverByMediaType(mediaType: string | undefined): string {
  if (!mediaType?.trim()) {
    return midiasImg;
  }

  const normalizedType = mediaType.trim().toLowerCase();

  switch (normalizedType) {
    case 'music':
      return musicasImg;
    case 'commercial':
      return comercialImg;
    case 'vem':
      return vemImg;
    case 'acervo':
      return acervoImg;
    case 'media':
      return midiasImg;
    case 'preview':
    case 'bumper':
      return previewImg;
    case 'intro':
      return introImg;
    default:
      return midiasImg;
  }
}

function norm(s: string | undefined): string {
  return (s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Bumper / preview pela tag do acervo ou pelo rótulo de tipo de mídia */
function mediaAssociationFromLabels(mediaAcervo: MediaAcervoLabels | null): string {
  const tag = norm(mediaAcervo?.tagBumper);
  if (tag.includes('preview') || tag.includes('bumper')) {
    return previewImg;
  }

  const mt = norm(mediaAcervo?.mediaType);
  if (mt.includes('jornalismo')) return jornalismoImg;
  if (mt.includes('locuc') || mt.includes('locu')) return locucoesImg;
  if (mt.includes('programete')) return programetesImg;
  if (mt === 'vh' || mt.includes('video hora') || /\bvh\b/.test(mt)) return vhImg;
  if (mt.includes('preview') || mt.includes('bumper')) return previewImg;
  if (mt.includes('acervo')) return acervoImg;

  return midiasImg;
}

/**
 * Capa exibida quando o item não tem `music.cover` (ou capa inválida tratada no `onError` do `<img>`).
 */
export function getPlaylistItemFallbackCover(
  playlistItemType: string | undefined,
  mediaAcervo: MediaAcervoLabels | null
): string {
  const t = (playlistItemType ?? 'music').trim().toLowerCase();

  if (t === 'media') {
    return mediaAssociationFromLabels(mediaAcervo);
  }

  return getDefaultCoverByMediaType(t);
}

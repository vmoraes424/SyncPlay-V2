/** Gradientes e bordas por tipo de mídia (playlist e acervo). */

export const TYPE_BG: Record<string, string> = {
  music: 'linear-gradient(270deg, #007113 25%, #161616, #161616)',
  vem: 'linear-gradient(270deg, #716c06 25%, #161616, #161616)',
  commercial: 'linear-gradient(270deg, #1c3684 25%, #161616, #161616)',
  media: 'linear-gradient(270deg, #84581c 25%, #161616, #161616)',
  intro: 'linear-gradient(270deg, #4f729c 25%, #161616, #161616)',
  command: 'linear-gradient(180deg, #9b0000, transparent)',
};

export const TYPE_ACERVO_BG: Record<string, string> = {
  music: '#007113',
  vem: '#716c06',
  commercial: '#1c3684',
  media: '#84581c',
  intro: '#4f729c',
  command: '#9b0000',
};

export const TYPE_BORDER: Record<string, string> = {
  music: 'rgba(0,113,19,0.55)',
  vem: 'rgba(113,108,6,0.55)',
  commercial: '#2b7fff',
  media: 'rgba(132,88,28,0.55)',
  intro: 'rgba(79,114,156,0.55)',
  command: 'rgba(155,0,0,0.55)',
};

export const TYPE_ACERVO_BORDER: Record<string, string> = {
  music: 'rgba(0,113,19,0.55)',
  vem: 'rgba(113,108,6,0.55)',
  commercial: '#2b7fff',
  media: 'rgba(132,88,28,0.55)',
  intro: 'rgba(79,114,156,0.55)',
  command: 'rgba(155,0,0,0.55)',
};
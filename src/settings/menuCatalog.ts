import type { SettingsMenu } from './types';
import audioIcon from '../assets/config/audio.png';
import shortcutsIcon from '../assets/config/atalhos.png';
import updatesIcon from '../assets/config/atualizar.png';
import triggerIcon from '../assets/config/disparo.png';
import foldersIcon from '../assets/config/pastas.png';
import generalIcon from '../assets/config/geral.png';
import mixerIcon from '../assets/config/mixer.png';
import playlistIcon from '../assets/config/playlist.png';
import rdsIcon from '../assets/config/rds.png';

export const SETTINGS_MENUS: SettingsMenu[] = [
  {
    id: 'general',
    title: 'Geral',
    iconLabel: 'GER',
    iconSrc: generalIcon,
    accent: '#2f8cff',
    submenus: [
      { id: 'appearance', title: 'Aparência', description: 'Tema, densidade e preferências visuais.' },
      { id: 'startup', title: 'Inicialização', description: 'Comportamento ao abrir o SyncPlay.' },
      { id: 'language', title: 'Idioma', description: 'Textos e localização da interface.' },
    ],
  },
  {
    id: 'updates',
    title: 'Atualizações',
    iconLabel: 'UPD',
    iconSrc: updatesIcon,
    accent: '#3f67d7',
    submenus: [
      { id: 'check', title: 'Verificação', description: 'Busca e instalação de novas versões.' },
      { id: 'channel', title: 'Canal', description: 'Canal estável, beta ou interno.' },
      { id: 'history', title: 'Histórico', description: 'Registro das últimas atualizações.' },
    ],
  },
  {
    id: 'playlist',
    title: 'Playlist',
    iconLabel: 'PLY',
    iconSrc: playlistIcon,
    accent: '#18a979',
    submenus: [
      { id: 'behavior', title: 'Comportamento', description: 'Regras de fila, blocos e avanço.' },
      { id: 'display', title: 'Exibição', description: 'Colunas, indicadores e agrupamentos.' },
      { id: 'rules', title: 'Regras', description: 'Critérios de descarte e seleção.' },
    ],
  },
  {
    id: 'audio',
    title: 'Áudio',
    iconLabel: 'AUD',
    iconSrc: audioIcon,
    accent: '#f07b18',
    submenus: [
      { id: 'output', title: 'Saída', description: 'Dispositivo e roteamento de áudio.' },
      { id: 'crossfade', title: 'Crossfade', description: 'Tempos de entrada, saída e mixagem.' },
      { id: 'cue', title: 'CUE', description: 'Pré-escuta e monitoramento.' },
    ],
  },
  {
    id: 'trigger',
    title: 'Disparo',
    iconLabel: 'DSP',
    iconSrc: triggerIcon,
    accent: '#7c3aed',
    submenus: [
      { id: 'triggers', title: 'Gatilhos', description: 'Eventos que iniciam ações automáticas.' },
      { id: 'automation', title: 'Automação', description: 'Fluxos automáticos do player.' },
      { id: 'timing', title: 'Temporização', description: 'Janelas e tolerâncias de disparo.' },
    ],
  },
  {
    id: 'folders',
    title: 'Pastas',
    iconLabel: 'DIR',
    iconSrc: foldersIcon,
    accent: '#c43b3b',
    submenus: [
      { id: 'directories', title: 'Diretórios', description: 'Pastas monitoradas pelo SyncPlay.' },
      { id: 'sync', title: 'Sincronização', description: 'Leitura e atualização de acervos.' },
      { id: 'validation', title: 'Validação', description: 'Arquivos ausentes, inválidos ou duplicados.' },
    ],
  },
  {
    id: 'rds',
    title: 'RDS',
    iconLabel: 'RDS',
    iconSrc: rdsIcon,
    accent: '#7aa313',
    submenus: [
      { id: 'connection', title: 'Conexão', description: 'Dados de conexão com o encoder RDS.' },
      { id: 'metadata', title: 'Metadados', description: 'Campos enviados para rádio texto.' },
      { id: 'templates', title: 'Templates', description: 'Modelos de mensagens dinâmicas.' },
    ],
  },
  {
    id: 'registration',
    title: 'Cadastro',
    iconLabel: 'CAD',
    accent: '#c5429f',
    submenus: [
      { id: 'users', title: 'Usuários', description: 'Cadastros e perfis locais.' },
      { id: 'permissions', title: 'Permissões', description: 'Acessos por recurso do sistema.' },
      { id: 'records', title: 'Dados', description: 'Bases auxiliares e registros.' },
    ],
  },
  {
    id: 'ai',
    title: 'IA',
    iconLabel: 'IA',
    accent: '#2783a7',
    submenus: [
      { id: 'providers', title: 'Provedores', description: 'Modelos, chaves e endpoints.' },
      { id: 'prompts', title: 'Prompts', description: 'Instruções reutilizáveis.' },
      { id: 'assistants', title: 'Assistentes', description: 'Ações inteligentes do SyncPlay.' },
    ],
  },
  {
    id: 'shortcuts',
    title: 'Atalhos de Teclado',
    iconLabel: 'KEY',
    iconSrc: shortcutsIcon,
    accent: '#365bd6',
    submenus: [
      { id: 'playback', title: 'Reprodução', description: 'Atalhos para tocar, pausar e avançar.' },
      { id: 'navigation', title: 'Navegação', description: 'Atalhos para mover foco e seleção.' },
      { id: 'library', title: 'Biblioteca', description: 'Atalhos da lista de mídias.' },
    ],
  },
  {
    id: 'mixer',
    title: 'Mixer',
    iconLabel: 'MIX',
    iconSrc: mixerIcon,
    accent: '#bf3f4a',
    submenus: [
      { id: 'channels', title: 'Canais', description: 'Canais, buses e grupos.' },
      { id: 'gain', title: 'Ganhos', description: 'Volumes, trims e limites.' },
      { id: 'monitoring', title: 'Monitoramento', description: 'Pré-escuta e medidores.' },
    ],
  },
];

export function findSettingsMenu(id: string | null) {
  return SETTINGS_MENUS.find(menu => menu.id === id) ?? null;
}

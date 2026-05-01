import type { SettingsItem, SettingsMenuContent, SettingsMenuId, SettingsStorageTarget } from './types';

const cfg = (
  id: string,
  label: string,
  control: SettingsItem['control'],
  config: string,
  note?: string,
  options?: string[]
): SettingsItem => ({ id, label, control, config, note, options });

const target = (
  id: string,
  label: string,
  control: SettingsItem['control'],
  storageTarget: SettingsStorageTarget,
  note?: string
): SettingsItem => ({ id, label, control, target: storageTarget, note });

const ui = (id: string, label: string, control: SettingsItem['control'], note?: string): SettingsItem =>
  ({ id, label, control, target: 'ui', note });

export const SETTINGS_CONTENT: Record<SettingsMenuId, SettingsMenuContent> = {
  general: {
    menuId: 'general',
    templateId: 'config-geral',
    title: 'Geral',
    sections: [
      {
        id: 'exhibition-proof',
        title: 'Comprovante de exibição',
        items: [
          cfg('exhibitionProof', 'Habilitar comprovante de exibição local', 'toggle', 'exhibitionProof'),
          cfg('exhibitionProofPath', 'Local do comprovante de exibição', 'readonly', 'exhibitionProofPath'),
        ],
      },
      {
        id: 'general-main',
        title: 'Geral',
        items: [
          cfg('startOnStartUp', 'Iniciar com o Windows', 'toggle', 'startOnStartUp'),
          cfg('operationMode', 'Modo de operação padrão', 'select', 'operationMode', undefined, ['Rede', 'Local']),
          cfg('streamingInEncoderReconnectionTries', 'Tempo de reconexão da transmissão via Encoder', 'text', 'streamingInEncoderReconnectionTries'),
          cfg('reloadCommercialTime', 'Tempo máximo (em segundos) para o reload comercial', 'text', 'reloadCommercialTime'),
          cfg('hideFaders', 'Ocultar faders (mixer)', 'toggle', 'hideFaders'),
          cfg('disableWaveform', 'Desativar Waveform (Economia de CPU/RAM em PCs fracos)', 'toggle', 'disableWaveform'),
        ],
      },
      {
        id: 'drag-and-drop',
        title: 'Drag and Drop',
        items: [
          cfg('enableDragAndDrop', 'Desabilitar Drag and Drop externo', 'toggle', 'enableDragAndDrop'),
        ],
      },
      {
        id: 'search',
        title: 'Busca',
        items: [
          cfg('libraryConfigYearDecade', 'Filtro de Músicas (Ano): Buscar Década', 'toggle', 'libraryConfigYearDecade'),
        ],
      },
    ],
  },
  updates: {
    menuId: 'updates',
    templateId: 'config-atualizar',
    title: 'Atualizações',
    sections: [
      {
        id: 'updates',
        title: 'Atualizações',
        items: [
          ui('loading', 'Busca em andamento', 'status'),
          ui('error', 'Erro', 'status'),
          ui('success', 'Sucesso', 'status'),
          ui('latestVersion', 'Última versão disponível', 'readonly'),
          ui('actualVersion', 'Versão atual', 'readonly'),
          ui('statusVersion', 'Estado atual', 'readonly'),
          ui('configs-check-for-updates', 'Verificar atualizações', 'button'),
          ui('configs-download-updates', 'Baixar atualização', 'button'),
          ui('configs-install-updates', 'Instalar atualização', 'button'),
        ],
      },
    ],
  },
  playlist: {
    menuId: 'playlist',
    templateId: 'config-playlist',
    title: 'Playlist',
    sections: [
      {
        id: 'playlist',
        title: 'Playlist',
        items: [
          cfg('automaticPlay', 'Iniciar reprodução automaticamente', 'toggle', 'automaticPlay'),
          cfg('selectMidia', 'Selecionar mídia inicial com base no horário', 'toggle', 'selectMidia'),
          cfg('detectConflicts', 'Detectar conflito de música, acervo e comercial', 'toggle', 'detectConflicts'),
          cfg('showNameCommercialFiles', 'Mostrar nome dos arquivos comerciais na playlist', 'toggle', 'showNameCommercialFiles'),
          cfg('showNameMusicFiles', 'Mostrar nome dos arquivos músicais na playlist', 'toggle', 'showNameMusicFiles'),
          cfg('showNameMediaFiles', 'Mostrar nome dos arquivos de mídia na playlist', 'toggle', 'showNameMediaFiles'),
          cfg('loadBlocks', 'Número de blocos a carregar', 'text', 'loadBlocks'),
          cfg('keepBlocks', 'Números de blocos a manter', 'text', 'keepBlocks'),
          cfg('adjustTimesInterval', 'Tempo em segundos para recálculo de tempos quando parado', 'number', 'adjustTimesInterval'),
        ],
      },
      {
        id: 'playlist-music-filters',
        title: 'Mostrar na Playlist - Música',
        items: [
          cfg('playlistShowMusicFilterYear', 'Ano', 'toggle', 'playlistShowMusicFilterYear'),
          cfg('playlistShowMusicFilterCategory', 'Categoria', 'toggle', 'playlistShowMusicFilterCategory'),
          cfg('playlistShowMusicFilterCollection', 'Coleção', 'toggle', 'playlistShowMusicFilterCollection'),
          cfg('playlistShowMusicFilterStyle', 'Estilo', 'toggle', 'playlistShowMusicFilterStyle'),
          cfg('playlistShowMusicFilterRhythm', 'Ritmo', 'toggle', 'playlistShowMusicFilterRhythm'),
          cfg('playlistShowMusicFilterNationality', 'Nacionalidade', 'toggle', 'playlistShowMusicFilterNationality'),
        ],
      },
      {
        id: 'playlist-media-filters',
        title: 'Mostrar na Playlist - Mídias',
        items: [
          cfg('playlistShowMediaFilterCollection', 'Coleção', 'toggle', 'playlistShowMediaFilterCollection'),
          cfg('playlistShowMediaFilterTag', 'Tag', 'toggle', 'playlistShowMediaFilterTag'),
          cfg('playlistShowMediaFilterMediaType', 'Tipo de Mídia', 'toggle', 'playlistShowMediaFilterMediaType'),
        ],
      },
      {
        id: 'mixing',
        title: 'Mixagem',
        items: [
          cfg('automaticMix', 'Detecção automática do ponto de mixagem em músicas', 'toggle', 'automaticMix'),
          cfg('musicMixSensitivity', 'Sensibilidade mixagem de músicas', 'text', 'musicMixSensitivity', 'Máscara percentual'),
          cfg('automaticMixMedia', 'Detecção automática do ponto de mixagem em mídias', 'toggle', 'automaticMixMedia'),
          cfg('mediaMixSensitivity', 'Sensibilidade mixagem de mídias', 'text', 'mediaMixSensitivity'),
          cfg('mixType', 'Tipo de detecção', 'select', 'mixType', undefined, ['Básica', 'Avançada']),
        ],
      },
      {
        id: 'discard',
        title: 'Descarte',
        items: [
          cfg('musicDiscard', 'Habilitar o descarte de músicas', 'toggle', 'musicDiscard'),
          cfg('discardType', 'Tipo de descarte', 'select', 'discardType', undefined, ['Básica', 'Avançada']),
          cfg('musicDiscardTime', 'Exceder tempo do bloco musical em até', 'text', 'musicDiscardTime', 'Máscara MM:SS, salvo em segundos'),
          cfg('removeMidiaOnStreamingIn', 'Durante a execução do Streaming In, remover músicas e mídias com horário ultrapassado', 'toggle', 'removeMidiaOnStreamingIn'),
          cfg('removeMidiaOnPause', 'Durante a pause, remover músicas e mídias com horário ultrapassado', 'toggle', 'removeMidiaOnPause'),
        ],
      },
      {
        id: 'reload-fixed',
        title: 'Reload em horário fixo',
        items: [
          cfg('reloadFixed', 'Habilitar reload da playlist em horários fixos', 'toggle', 'reloadFixed'),
          target('reload-fixed-schedule', 'Agenda reloadF01 a reloadF62', 'table', 'reloadFixedSchedule.json', 'Chaves = id de cada campo'),
        ],
      },
    ],
  },
  audio: {
    menuId: 'audio',
    templateId: 'config-audio',
    title: 'Áudio',
    sections: [
      {
        id: 'audio-devices',
        title: 'Placas de áudio',
        sections: [
          { id: 'audio-inputs', title: 'Entradas de áudio', level: 5, items: [cfg('lineInAudioDevice', 'Line In', 'select', 'lineInAudioDevice')] },
          {
            id: 'audio-returns',
            title: 'Retornos de áudio',
            level: 5,
            items: [
              cfg('masterAudioDevice', 'Master', 'select', 'masterAudioDevice'),
              cfg('monitorAudioDevice', 'Monitoramento', 'select', 'monitorAudioDevice'),
              cfg('foneAudioDevice', 'Retorno', 'select', 'foneAudioDevice'),
            ],
          },
          { id: 'audio-cue', title: 'CUE', level: 5, items: [cfg('cueAudioDevice', 'CUE', 'select', 'cueAudioDevice')] },
          {
            id: 'audio-outputs',
            title: 'Saídas de áudio',
            level: 5,
            items: [
              ui('allOutAudioDevice', 'Alterar todas', 'select', 'Propaga para vários canais de saída'),
              cfg('lineOutAudioDevice', 'Line Out', 'select', 'lineOutAudioDevice'),
              cfg('playlistAudioDevice', 'Playlist', 'select', 'playlistAudioDevice'),
              cfg('introChorusAudioDevice', 'Intro/Refrão', 'select', 'introChorusAudioDevice'),
              cfg('rightTimeAudioDevice', 'Hora certa', 'select', 'rightTimeAudioDevice'),
              cfg('streamingInAudioDevice', 'Streaming in', 'select', 'streamingInAudioDevice'),
              cfg('vemAudioDevice', 'VEM', 'select', 'vemAudioDevice'),
              cfg('instantPlayAudioDevice', 'Botoneira', 'select', 'instantPlayAudioDevice'),
            ],
          },
        ],
      },
      {
        id: 'volumes',
        title: 'Controle de volumes',
        items: [
          cfg('volumeMaster', 'Volume Master', 'range', 'volumeMaster', 'Espelho: defaultVolumeMaster'),
          cfg('volumeMicrofone', 'Volume Microfone', 'range', 'volumeMicrofone', 'Espelho: defaultVolumeMicrofone'),
          cfg('volumeLineIn', 'Volume Line In', 'range', 'volumeLineIn', 'Espelho: defaultVolumeLineIn'),
          cfg('volumePlaylist', 'Volume Playlist', 'range', 'volumePlaylist', 'Espelho: defaultVolumePlaylist'),
          cfg('volumeIntroChorus', 'Volume Intro/Refrão', 'range', 'volumeIntroChorus', 'Espelho: defaultVolumeIntroChorus'),
          cfg('volumeRightTime', 'Volume Hora Certa', 'range', 'volumeRightTime', 'Espelho: defaultVolumeRightTime'),
          cfg('volumeStreamingIn', 'Volume Streaming In', 'range', 'volumeStreamingIn', 'Espelho: defaultVolumeStreamingIn'),
          cfg('volumeVEM', 'Volume VEM', 'range', 'volumeVEM', 'Espelho: defaultVolumeVEM'),
          cfg('volumeCUE', 'Volume CUE', 'range', 'volumeCUE', 'Espelho: defaultVolumeCUE'),
          cfg('volumeInstantPlay', 'Volume Botoneira', 'range', 'volumeInstantPlay', 'Espelho: defaultVolumeInstantPlay'),
          cfg('volumeMonitor', 'Volume Monitor', 'range', 'volumeMonitor', 'Espelho: defaultVolumeMonitor'),
          cfg('volumeFone', 'Volume Retorno', 'range', 'volumeFone', 'Espelho: defaultVolumeFone'),
        ],
      },
      {
        id: 'monitoring-sound',
        title: 'Som de monitoramento',
        items: [
          cfg('automaticMonitor', 'Controlar automaticamente som de monitoramento', 'toggle', 'automaticMonitor'),
          target('monitor-schedule', 'Agenda monEnable0 a monDisable6', 'table', 'monitorSchedule.json', 'Chaves = id de cada campo'),
        ],
      },
    ],
  },
  trigger: {
    menuId: 'trigger',
    templateId: 'config-disparo',
    title: 'Disparo',
    sections: [
      {
        id: 'trigger',
        title: 'Disparo',
        items: [
          cfg('stopInstantPlayOnPlaylist', 'Parar botões ao executar a playlist', 'toggle', 'stopInstantPlayOnPlaylist'),
          cfg('stopOnlyLoopingInstantPlayOnPlaylist', 'Ativar função somente nos botões com LOOPING ligado', 'toggle', 'stopOnlyLoopingInstantPlayOnPlaylist'),
          cfg('stopSequenceInstantPlayOnPlaylist', 'Parar sequência de botões ao executar a playlist', 'toggle', 'stopSequenceInstantPlayOnPlaylist'),
          cfg('buttonsPerLine', 'Número de botões por linha', 'select', 'buttonsPerLine'),
          cfg('showInstantPlayCoverArtMusics', 'Mostrar capa do álbum dos botões de músicas', 'toggle', 'showInstantPlayCoverArtMusics'),
          cfg('showInstantPlayCoverArtMedias', 'Mostrar capa do álbum dos botões de mídias', 'toggle', 'showInstantPlayCoverArtMedias'),
        ],
        sections: [
          {
            id: 'download-upload',
            title: 'Download e Upload',
            level: 5,
            items: [
              cfg('instantPlayAutoDownloadMidias', 'Baixar automaticamente áudios da nuvem (HTTPS) para C:\\SyncPlay\\Midias', 'toggle', 'instantPlayAutoDownloadMidias'),
              cfg('instantPlayAutoUploadMidias', 'Enviar automaticamente áudios locais para a nuvem (conta API)', 'toggle', 'instantPlayAutoUploadMidias'),
            ],
          },
        ],
      },
    ],
  },
  folders: {
    menuId: 'folders',
    templateId: 'config-pastas',
    title: 'Pastas',
    sections: [
      {
        id: 'manual-folders',
        title: 'Adicionar pastas manualmente',
        items: [
          target('manualDirectories', 'Adicionar pasta', 'button', 'directoriesManualConfig.json', 'Estrutura por linha: name e path'),
        ],
      },
      {
        id: 'sync-folders',
        title: 'Quais pastas deseja habilitar exibir? (Via Sync)',
        items: [
          target('directories', 'Lista de pastas Via Sync', 'toggle', 'directoriesConfig.json', 'Chave = data-ref do rótulo da pasta'),
        ],
      },
    ],
  },
  rds: {
    menuId: 'rds',
    templateId: 'config-rds',
    title: 'RDS',
    sections: [
      {
        id: 'rds',
        title: 'Configurações RDS',
        items: [
          cfg('rdsEncoding', 'Codificação do arquivo RDS', 'select', 'rdsEncoding'),
          cfg('rdsPath', 'Local do arquivo RDS', 'readonly', 'rdsPath'),
          cfg('rdsMusic', 'Habilitar Músicas no RDS', 'toggle', 'rdsMusic'),
          cfg('rdsMedias', 'Habilitar Mídias no RDS', 'toggle', 'rdsMedias'),
          cfg('rdsCommercial', 'Habilitar Comercial no RDS', 'toggle', 'rdsCommercial'),
          cfg('rdsPrompt', 'Habilitar Prompts de IA no RDS', 'toggle', 'rdsPrompt'),
          cfg('rdsProgram', 'Habilitar Nome do Programa no RDS', 'toggle', 'rdsProgram'),
          cfg('rdsRightTime', 'Habilitar Hora Certa no RDS', 'toggle', 'rdsRightTime'),
          cfg('apiControla', 'Habilitar API Controla para RDS e ECAD', 'toggle', 'apiControla'),
        ],
      },
    ],
  },
  registration: {
    menuId: 'registration',
    templateId: 'config-informacoes-pessoais',
    title: 'Cadastro',
    sections: [
      {
        id: 'registration',
        title: 'Cadastro',
        items: [
          cfg('personalInfoRadio', 'Rádio', 'text', 'personalInfo.radio'),
          cfg('personalInfoAreaCode', 'Código de Área', 'text', 'personalInfo.areaCode'),
          cfg('personalInfoPhone', 'Telefone', 'text', 'personalInfo.phone'),
          cfg('personalInfoEmail', 'Email', 'text', 'personalInfo.email'),
          cfg('personalInfoCity', 'Cidade', 'text', 'personalInfo.city'),
          cfg('personalInfoState', 'Estado', 'text', 'personalInfo.state'),
          cfg('personalInfoCountry', 'País', 'text', 'personalInfo.country'),
          cfg('personalInfoSlogan', 'Slogan', 'text', 'personalInfo.slogan'),
          cfg('personalInfoCia', 'CIA', 'text', 'personalInfo.cia'),
        ],
      },
    ],
  },
  ai: {
    menuId: 'ai',
    templateId: 'config-ia',
    title: 'IA',
    sections: [
      {
        id: 'ai-config',
        title: 'Configurações de IA',
        items: [
          cfg('enableCloudTokensFromApi', 'Habilitar tokens vindos da nuvem', 'toggle', 'enableCloudTokensFromApi'),
        ],
        sections: [
          {
            id: 'default-api-tokens',
            title: 'Tokens de API Padrão',
            level: 5,
            items: [
              cfg('defaultTextTokenSelect', 'Token de TEXTO padrão', 'select', 'defaultTextTokenId'),
              cfg('defaultVoiceTokenSelect', 'Token de VOZ padrão', 'select', 'defaultVoiceTokenId'),
              cfg('ttsReloadTimeout', 'Intervalo de tentativas para recarregar TTS (xx Min após erro)', 'number', 'ttsReloadTimeout', 'Runtime; confirmar persistência no JSON'),
              cfg('getLocalPromptData', 'Usar dados de prompt locais na playlist', 'toggle', 'getLocalPromptData'),
              cfg('enablePromptDownload', 'Habilitar botão de download do prompt', 'toggle', 'enablePromptDownload'),
              cfg('musicInfoPrompt', 'Prompt para Informações da Música', 'textarea', 'musicInfoPrompt'),
              cfg('artistInfoPrompt', 'Prompt para Informações do Artista', 'textarea', 'artistInfoPrompt'),
              cfg('horaVarInstructions', 'Instruções para a variável {hora}', 'textarea', 'horaVarInstructions'),
              cfg('temperaturaVarInstructions', 'Instruções para a temperatura', 'textarea', 'temperaturaVarInstructions'),
            ],
          },
        ],
      },
      {
        id: 'tts-config',
        title: 'Configurações de TTS',
        sections: [
          {
            id: 'tts-voice',
            title: 'Voz do Text-to-Speech',
            level: 5,
            items: [
              cfg('ttsVoiceSelect', 'Voz TTS', 'select', 'ttsVoice'),
              cfg('ttsOutputChannel', 'Canal de Saída da Voz TTS', 'select', 'ttsOutputChannel'),
              cfg('configsDefaultVoiceVelocityConfigSelect', 'Velocidade da Fala', 'select', 'defaultVoiceVelocityConfigId', 'Também ajusta ttsSpeed conforme API'),
              cfg('ttsVolume', 'Volume da Voz', 'range', 'ttsVolume'),
              cfg('ttsStyleInstructions', 'Instruções de Estilo', 'textarea', 'ttsStyleInstructions'),
            ],
          },
          {
            id: 'tts-preview',
            title: 'Testar Voz (Preview)',
            level: 5,
            items: [
              ui('ttsPreviewText', 'Texto para Preview', 'textarea'),
              ui('ttsPreviewButton', 'Ouvir em CUE', 'button'),
              ui('ttsPreviewStatus', 'Status do preview', 'status'),
            ],
          },
          {
            id: 'default-track',
            title: 'Trilha Padrão',
            level: 5,
            items: [
              cfg('defaultTrackPath', 'Arquivo de Trilha', 'readonly', 'defaultTrackPath', 'Pode gravar defaultTrackMediaId e defaultTrackMediaTypeId'),
            ],
            sections: [
              {
                id: 'track-times',
                title: 'Tempos de Entrada e Saída',
                level: 6,
                items: [
                  cfg('trackStartTime', 'Tempo de Entrada (segundos)', 'range', 'defaultTrackStartTime', 'Milissegundos no JSON'),
                  cfg('trackEndTime', 'Tempo de Saída (segundos)', 'range', 'defaultTrackEndTime', 'Milissegundos no JSON'),
                ],
              },
              {
                id: 'track-volume',
                title: 'Volume da Trilha Padrão',
                level: 6,
                items: [
                  cfg('defaultTrackVolume', 'Volume da Trilha (%)', 'range', 'defaultTrackVolume'),
                  cfg('defaultTrackLoop', 'Repetir trilha em loop', 'checkbox', 'defaultTrackLoop'),
                ],
              },
            ],
          },
          {
            id: 'queue-config',
            title: 'Configurações de Fila',
            level: 5,
            items: [
              cfg('promptQueuePositionLimit', 'Limite de posições à frente para carregamento de prompts', 'number', 'promptQueuePositionLimit'),
              ui('trackStatus', 'Status da trilha', 'status'),
            ],
          },
        ],
      },
    ],
  },
  shortcuts: {
    menuId: 'shortcuts',
    templateId: 'config-atalhos',
    title: 'Atalhos de Teclado',
    sections: [
      {
        id: 'keyboard-shortcuts',
        title: 'Atalhos do Teclado',
        sections: [
          {
            id: 'shortcuts-playlist',
            title: 'Playlist',
            level: 6,
            items: [
              cfg('shortcut-advanceTrack', 'Avançar Faixa', 'text', 'shortcuts.advanceTrack'),
              cfg('shortcut-scrollToPlaying', 'Levar até a Faixa Tocando', 'text', 'shortcuts.scrollToPlaying'),
              cfg('shortcut-deleteNext', 'Deletar Próxima Faixa Selecionada', 'text', 'shortcuts.deleteNext'),
              cfg('shortcut-reloadPlaylist', 'Reload direto da Playlist', 'text', 'shortcuts.reloadPlaylist'),
              cfg('shortcut-pauseNextPosition', 'Pausa na próxima posição da playlist', 'text', 'shortcuts.pauseNextPosition'),
            ],
          },
          {
            id: 'shortcuts-vem',
            title: 'VEM',
            level: 6,
            items: [
              cfg('shortcut-playVem', 'Reproduzir próxima VEM', 'text', 'shortcuts.playVem'),
              cfg('shortcut-reactivateNextVem', 'Reativar próxima Vem', 'text', 'shortcuts.reactivateNextVem'),
              cfg('shortcut-reloadNextVem', 'Reload próxima Vem', 'text', 'shortcuts.reloadNextVem'),
            ],
          },
          {
            id: 'shortcuts-intro-chorus',
            title: 'Intro/Refrão',
            level: 6,
            items: [
              cfg('shortcut-playNextIntro', 'Reproduzir a próxima intro', 'text', 'shortcuts.playNextIntro'),
              cfg('shortcut-playNextChorus', 'Reproduzir o próximo refrão', 'text', 'shortcuts.playNextChorus'),
            ],
          },
          {
            id: 'shortcuts-instant-play',
            title: 'Botoneira',
            level: 6,
            items: [
              cfg('shortcut-toggleSequenceMode', 'Ativar/Desativar Modo de Sequência de Botões', 'text', 'shortcuts.toggleSequenceMode'),
              cfg('shortcut-playFirstSequenceItem', 'Tocar Próximo Item da Sequência de Botões', 'text', 'shortcuts.playFirstSequenceItem'),
            ],
          },
          {
            id: 'shortcuts-system',
            title: 'Sistema',
            level: 6,
            items: [
              cfg('shortcut-toggleMic', 'Ligar/Desligar Microfone', 'text', 'shortcuts.toggleMic'),
              cfg('shortcut-toggleMonitor', 'Ativar / Desativar Monitor', 'text', 'shortcuts.toggleMonitor'),
              cfg('shortcut-openSearchMenu', 'Abrir Menu de Busca', 'text', 'shortcuts.openSearchMenu'),
            ],
          },
        ],
      },
    ],
  },
  mixer: {
    menuId: 'mixer',
    templateId: 'config-mixer',
    title: 'Mixer',
    sections: [
      {
        id: 'mixer',
        title: 'Mixer',
        items: [
          ui('mixer-description', 'Texto explicativo', 'status'),
          target('open-mixer-layout-modal-from-config', 'Configurar layout do mixer', 'button', 'localStorage', 'Chave: syncplay_mixer_layout_v1'),
        ],
      },
    ],
  },
};

export function getSettingsContent(menuId: SettingsMenuId | null) {
  return menuId ? SETTINGS_CONTENT[menuId] : null;
}

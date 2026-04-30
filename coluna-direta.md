# Documentação: Migração da Lista de Mídias (`.files .list`) para Tauri

## 1. Visão Geral do Componente
O contêiner `#midias .files .list` é a interface principal onde o usuário visualiza, filtra, ouve a prévia (CUE) e insere arquivos de áudio (músicas, mídias, vinhetas, comerciais) ou comandos (Streaming In) na playlist principal. 

No Electron, essa lista lidava com milhares de arquivos locais. Para manter a performance, ela não renderiza todos os elementos no DOM de uma vez, mas utiliza uma técnica de **Virtualização** aliada a **Web Workers** para leitura de disco.

## 2. Arquitetura Atual (O que a IA precisa saber)

### A. Virtualização de Lista (`virtualList.js`)
* **Problema original:** Inserir 10.000 divs no DOM trava a aplicação.
* **Solução atual:** O arquivo `virtualList.js` gerencia o scroll. Ele calcula quais itens estão visíveis na tela (baseado no `scrollTop` e `itemHeight`) e renderiza apenas um pequeno *buffer* de itens (ex: os 10 visíveis + 10 acima + 10 abaixo).
* **Ação para o Tauri:** O frontend (provavelmente React, Vue ou Vanilla JS moderno) DEVE implementar ou utilizar uma biblioteca de Virtual List / Windowing (ex: `@tanstack/react-virtual`, `vue-virtual-scroller`, ou manter uma classe JS nativa semelhante ao `virtualList.js`).

### B. Leitura de Disco Assíncrona (Workers)
* **Como era:** Ao selecionar uma pasta no `#directoryCollection`, a função `getDirFiles()` acionava o `dirFilesWorker.postMessage([directoryPath, type])`. O Web Worker lia a pasta no background usando `fs.readdir` e devolvia o array para a Virtual List.
* **Ação para o Tauri:** No Tauri, a leitura pesada de disco **não deve ser feita no frontend**. A IA deve criar um `Command` em **Rust** (backend do Tauri) que lê o diretório, extrai os metadados básicos e retorna um Array/Vetor JSON para o frontend. Não há necessidade de Web Workers no JS se o Rust fizer o trabalho pesado de forma assíncrona.

### C. Tipos de Exibição
A lista renderiza dois tipos de dados:
1.  **Arquivos de Áudio Físicos:** Músicas, comerciais, mídias lidas do disco.
2.  **Comandos de Streaming In:** Quando o diretório selecionado é `#st`, a lista muda seu layout (adiciona a classe `.commands`) e renderiza botões de comando (JSON puro contendo durações e metadados de stream), pulando a leitura de disco.

## 3. Fontes de Dados e Metadados

Para que a lista exiba os metadados corretos (Categorias, Artistas, Ritmo, Tags), ela cruza o nome do arquivo com os bancos de dados em JSON carregados em cache (`library.js`):
* `music_filters.json` e `musicLibraryPath` (para Músicas)
* `media_filters.json` e `mediaLibraryPath` (para Mídias/Vinhetas)

A função `getMusicLibraryData(fileName)` ou `getMediaLibraryData(fileName)` é chamada para popular as propriedades avançadas do arquivo.

## 4. Sistema de Filtros Avançados (`directories.js`)

A lista possui um motor de busca e filtros em tempo real.
A IA deve notar a função `applyLibraryFilters()`, que itera sobre o array da Virtual List e aplica as seguintes regras lógicas (Condição `AND`):
* **Busca por texto:** Lida pelo `#buscaMidia` (ignora acentos via `removerAcentos()`).
* **Filtros de Música:** Nacionalidade, Estilo, Ritmo, Categoria, Artista.
* **Filtros de Mídia:** TagBumper.
* **Filtro de Ano:** Lida com um range `filterYearInitial` e `filterYearFinal` (às vezes tratado por décadas se `configs.libraryConfigYearDecade` for true).

Ao alterar qualquer filtro (via cliques ou selects unificados pelo handler `genericSelectors`), a lista virtual é atualizada e renderiza os novos itens filtrados, mostrando a contagem em `#filterResultCount`.

## 5. Eventos e Interações do Usuário (Crucial para a UI)

A IA deve recriar exatamente as seguintes interações para cada item `.midia` dentro da `.list`:

### A. Seleção Simples (Click no corpo)
* **Ação:** Seleciona o item, adicionando a classe `.selected` e guardando o nome em `window.selectedVirtualListMidiaRef`.
* **Comportamento:** Remove a seleção de qualquer outro item. Para o Player CUE se estiver tocando outro item diferente.

### B. Inserção na Playlist (Double Click)
* **Ação:** Insere a mídia clicada logo abaixo da mídia que está tocando no momento (`.playing` ou `.next`).
* **Fluxo interno:**
    1. Resgata o nome/path do localStorage/atributos.
    2. Busca os metadados na library (`getMusicLibraryData`).
    3. Chama a função `createAndInsertMidia()` passando o ponto de inserção (`afterElement`).
    4. Chama `findInPlaylist()` para verificar se há conflito (mídia repetida no bloco).

### C. Prévia / Player CUE (Click no botão `.play`)
* **Ação:** Toca o áudio diretamente no fone de ouvido do locutor (preview) sem jogar no ar.
* **Lógica (`directories.js`):**
    * Usa o objeto `cuePlayer` (um `new Audio()` do HTML5).
    * Se estiver tocando, pausa (`stopAllCue`).
    * Muda o ícone para um GIF (`play_stopping.gif` ou de reprodução).
    * Chama `playLibraryItemInCue(name, fullPath)`.
    * Existe uma barra de progresso do CUE atrelada ao evento `ontimeupdate` do player.
    * *Nota Tauri:* O áudio no frontend web do Tauri pode ter bloqueios de autoplay. O caminho físico precisa ser convertido usando a API do Tauri `convertFileSrc` (antigo `tauri://localhost`), pois o WebView de segurança do Tauri bloqueia caminhos como `C:\pasta\audio.mp3`.

### D. Exclusão de Arquivo Físico (Botão `.delete-midia-file-btn`)
* **Ação:** Deleta permanentemente o arquivo do HD e remove o elemento da DOM.
* **Como era:** Usava `fs.existsSync` e `fs.unlinkSync` nativo do Node.js disparando alertas IPC (`show-message-box`).
* **Ação para o Tauri:** O frontend deve invocar o `dialog.ask` do `@tauri-apps/plugin-dialog` para confirmação, e depois invocar o `removeFile` do `@tauri-apps/plugin-fs` ou criar um Command Rust dedicado para deletar a mídia de forma segura.

## 6. Diretrizes Técnicas Resumidas para a IA Implementadora

1.  **Fim do `fs` Node.js no Frontend:** Substitua todos os `fs.readFileSync`, `fs.readdir` e `fs.unlinkSync` por chamadas ao backend Rust via `invoke('nome_do_comando')` ou utilize os plugins oficiais do Tauri V2 (`@tauri-apps/plugin-fs`).
2.  **Fim dos Web Workers nativos JS para arquivos:** A leitura dos diretórios `.json` e listagem de pastas pesadas deve ocorrer via Threads no Rust, retornando os objetos prontos para a interface Web.
3.  **Caminhos de Arquivos no Tauri (Asset Protocol):** Para que a tag `<audio src="...">` (o `cuePlayer`) funcione no Tauri, é estritamente necessário converter caminhos absolutos locais do sistema (ex: `C:\SyncPlay\Músicas\a.mp3`) usando a API apropriada (ex: `convertFileSrc` do `@tauri-apps/api/core`).
4.  **Manter Virtualização:** Nunca renderize a lista completa. A lógica do `VirtualList` deve ser portada (ou substituída por uma lib reativa moderna) mantendo a variável `buffer` e `itemHeight`.
5.  **Single Source of Truth (SSOT):** O Electron usava variáveis globais no `window` (como `window.musicLibraryPath`) e manipulação direta de DOM (`$('.midia')`). No novo projeto, consolide o estado dos filtros e da lista carregada em um State Manager (Pinia no Vue, Zustand no React, ou Signals).
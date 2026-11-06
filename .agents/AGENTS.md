# ANOTADO — Contexto e instruções para agentes de programação

> Leia este arquivo antes de implementar mudanças. Use-o como orientação inicial, mas confirme todos os detalhes no código atual. O código e o schema real são a fonte da verdade. Atualize este documento quando uma alteração mudar a arquitetura, regras de negócio, modelos, rotas ou fluxos importantes.

## 1. Para que serve este documento

Este arquivo permite que uma IA que acabou de abrir o repositório entenda o ANOTADO sem depender do histórico de conversas. Ele reúne visão arquitetural, responsabilidades dos módulos, persistência, sincronização, editor, Diário, segurança e validação.

Não conclua que uma funcionalidade existe apenas porque foi discutida ou desejada anteriormente. Confirme sua existência nos arquivos, rotas e schema atuais.

## 2. Instruções obrigatórias para qualquer mudança

1. Leia este arquivo e depois examine os arquivos diretamente relacionados à tarefa. Não edite apenas com base no nome de um arquivo ou no histórico da conversa.
2. Identifique o fluxo completo: interação visual, estado React, handler, API, persistência local, SyncQueue, SyncEngine, Supabase e retorno ao estado da UI.
3. Faça a menor mudança segura que resolva o pedido. Preserve comportamentos existentes fora do escopo.
4. Não reescreva um módulo grande nem troque a arquitetura por conveniência. Não introduza refatorações sem relação com o pedido.
5. Não adicione coluna, tabela, bucket, pacote, serviço externo ou variável de ambiente sem necessidade real.
6. Antes de alterar uma interface, tipo, evento, nome de atributo, URI de mídia ou função pública, procure todos os seus consumidores.
7. Não exponha secrets. Não inclua tokens, chaves reais, credenciais nem service-role keys em código, documentação ou logs.
8. Não execute operações destrutivas no banco nem descarte dados locais. Não assuma que IndexedDB pode ser apagado sem consequência: pode conter conteúdo e anexos ainda não sincronizados.
9. Teste o que for possível. Build, lint e testes são verificações diferentes. Informe resultados reais e diga explicitamente o que não foi possível testar.
10. Um commit no GitHub não prova que houve deploy. Não declare o aplicativo funcional em produção sem uma verificação da implantação e do comportamento.
11. Se uma alteração afetar arquitetura, banco, evento, rota, persistência ou regra de negócio, atualize este arquivo canônico: .agents/AGENTS.md. Atualize também os arquivos-ponte GEMINI.md e AGENTS.md se a forma de carregamento das instruções mudar.
12. Quando o código contradisser este documento, examine a implementação e corrija a documentação ou o código de forma explícita. Não esconda a divergência.

## 3. Visão geral do produto

ANOTADO é um aplicativo de anotações em português baseado em Next.js, React, TypeScript, Tiptap/ProseMirror, IndexedDB e Supabase. É também um PWA instalável. O princípio arquitetural central é **local-first/offline-first**: a edição deve persistir no dispositivo sem depender de uma chamada remota imediata; a sincronização acontece em segundo plano.

Existem três workspaces distintos:

- **Notas**: notas Markdown em pastas e subpastas, pesquisa, tags, Favoritos, Arquivadas, pastas inteligentes, drag-and-drop, seleção múltipla, abas, tela dividida e editor rico.
- **Diário**: entradas em hierarquia Ano → doze Meses → Dias virtuais. As notas dos dias só são criadas quando o usuário escolhe o dia.
- **Diário compartilhado**: visualização do Diário de outro usuário, acessível por compartilhamento aceito. A interface deve ser somente leitura e a restrição também deve ser aplicada no banco por RLS.

O editor é compartilhado entre Notas e Diário. Há extensões para títulos, parágrafos, listas, links, tarefas, destaques, cores de texto, imagens, YouTube, documentos/PDF, blocos recolhíveis, grupos de mídia e referências internas.

**Não presuma que recursos discutidos mas ausentes no código estejam implementados.** Por exemplo, um mapa de conhecimento ou uma funcionalidade de IA só existem se a rota, os componentes e a integração estiverem presentes na versão atual do repositório.

## 4. Stack e configuração

- **Next.js 15 / App Router**: rotas, shell e build.
- **React 19 + TypeScript**: interface e contratos.
- **Tiptap 3 / ProseMirror**: editor, schema do documento, seleções e transações.
- **tiptap-markdown**: intercâmbio entre documento rico e Markdown.
- **Supabase JS + @supabase/ssr**: Auth, Postgres/RLS, Storage e Realtime.
- **IndexedDB nativo**: cópia local durável, isolada por usuário.
- **Tailwind CSS 4 e CSS global**: apresentação visual.
- **lucide-react**: ícones.
- **@dnd-kit**: drag-and-drop em áreas que usam esse pacote; movimento de nós dentro do editor também usa extensões ProseMirror próprias.
- **JSZip**: exportação ZIP.
- **PWA/Service Worker**: instalação e atualização.
- **@google/genai** está listado como dependência; confirme usos e rotas no código atual antes de assumir que existe uma integração de IA ativa.

O arquivo **.env.example** documenta variáveis principais: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, GEMINI_API_KEY e APP_URL. Use somente placeholders em arquivos versionados. O aplicativo tem caminhos de fallback local/demo quando o Supabase não está configurado; não elimine esse modo sem definir o comportamento substituto.

Comandos do projeto:
- Desenvolvimento: **npm run dev**
- Build: **npm run build**
- Servidor de produção local: **npm run start**
- Lint: **npm run lint**
- Limpeza de build: **npm run clean**

A configuração atual do Next ignora ESLint durante o build, mas não ignora erros de TypeScript. Execute lint separadamente sempre que possível.

## 5. Rotas e shell

- **app/layout.tsx**: layout raiz, metadata, viewport, CSS, aplicação do tema inicial e providers ThemeProvider/PwaProvider.
- **app/page.tsx**: rota inicial, renderiza MainLayout.
- **app/notes/page.tsx**: rota explícita de Notas, também renderiza MainLayout.
- **app/diary/page.tsx**: renderiza DiaryLayout.
- **app/shared-diary/[shareId]/page.tsx**: rota dinâmica da visualização compartilhada.
- **app/login/page.tsx**: renderiza LoginForm.
- **app/globals.css**: estilos globais e do editor, paleta e modo escuro.
- **app/manifest.ts** e **public/manifest.json**: configurações do PWA.
- **app/not-found.tsx**: página não encontrada.
- **middleware.ts**: atualiza/valida cookies de sessão Supabase e redireciona acessos conforme a configuração. Ignora recursos estáticos e APIs; possui fluxo especial para login e Diário compartilhado.
- **next.config.ts**: configuração Next, imagens remotas e tratamento específico de HMR.
- **package.json / package-lock.json**: scripts e dependências.
- **tsconfig.json**, **eslint.config.mjs**, **.eslintrc.json**, **postcss.config.mjs**: configuração de linguagem, lint e CSS; verifique qual configuração é efetiva antes de mudar.
- **bun.lock**: lockfile de Bun presente no repositório; não o regenere se o gerenciador do deploy não for Bun.
- **metadata.json**, **context7.json**, **lib/utils.ts**, **scripts/generate-icons.js**, **.gitignore**, **next-env.d.ts**, **tsconfig.tsbuildinfo** e **assets/.aistudio/.gitignore**: configuração, utilitários ou arquivos auxiliares. Confirme o uso antes de removê-los.

A rota inicial e /notes compartilham MainLayout. Não duplique nelas o estado do editor ou do workspace.

## 6. Arquitetura de persistência

### 6.1 Fluxo de edição

O fluxo esperado de conteúdo é:

1. O usuário altera o documento no NoteEditor.
2. NoteCanvas controla o debounce/flush e chama o handler do layout.
3. notes-api.ts encaminha a mudança ao SaveQueueManager.
4. SaveQueue grava conteúdo/tag no IndexedDB e consolida a operação na SyncQueue local.
5. SyncEngine processa a fila quando há rede, sessão válida e quota remota disponível.
6. Metadados são gravados no Postgres e Markdown no Supabase Storage; os anexos obedecem à ordem segura documentada adiante.
7. Mudanças remotas chegam por Supabase Realtime ou PULL incremental; SyncEngine reconcilia o IndexedDB e avisa os layouts inscritos.

**SaveQueue não deve virar um cliente de rede.** É responsabilidade do SyncEngine executar as operações remotas. A UI deve continuar responsiva e preservar a alteração local mesmo quando o envio remoto falhar.

### 6.2 IndexedDB

**src/features/notes/db/indexed-db.ts** define o banco local. O nome segue o padrão anotado_db_<userId>, isolando os dados por usuário. A versão atual do schema IndexedDB no código é **5**.

Stores principais:
- **notes**: registros de nota, Markdown em cache, metadados e status local.
- **folders**: pastas, pai/filho, posição, cor e workspace/Diário.
- **tags** e **note_tags**: etiquetas locais e associações normalizadas.
- **attachments**: Blob binário, metadados locais e status de upload.
- **sync_queue**: operações remotas pendentes, payload, tentativas, revisão e erros.
- **metadata**: checkpoints e valores locais, incluindo última sincronização.

Campos como syncRequired, syncStatus e alguns campos legados de compatibilidade representam o estado local. A própria arquitetura do código declara que o estado “precisa sincronizar” é exclusivo do IndexedDB do dispositivo; não o transforme numa fonte remota de verdade.

Ao criar/mudar stores ou índices, leia getDB/onupgradeneeded, incremente DB_VERSION quando necessário e faça a migração de forma compatível. Não “resolva” problema de persistência apagando o banco do usuário.

### 6.3 Modelos TypeScript

**src/features/notes/types/index.ts** contém:
- **Folder**: id, user_id, name, parent_id, position, color, is_smart, smart_tags, workspace_type, diary_year/diary_month e timestamps.
- **Note**: id, user_id, folder_id, title, content, position, tags, workspace_type, entry_date/diary_year/diary_month/diary_day, is_archived, is_favorite, previous_folder_id, revision e timestamps.
- **TreeFolderNode / TreeNodeItem / TreeItem**: formatos de apresentação da árvore; não são tabelas de banco.
- **NoteAttachment** e **SyncTombstone**: contratos de metadados de anexos e exclusões.

**src/features/notes/db/indexed-db.ts** amplia os modelos locais com estado de sincronização, Blob e campos temporários de conflito. Não envie esses campos automaticamente ao Postgres.

### 6.4 Tabelas remotas

**src/features/notes/db/schema.sql** é a referência principal do Supabase. Entre as tabelas presentes:
- **public.folders**: hierarquia de pastas.
- **public.notes**: metadados de notas e dados de workspace/Diário.
- **public.tags**: tags normalizadas por usuário/workspace.
- **public.note_tags**: associações entre nota e tag.
- **public.note_attachments**: metadados de anexos.
- **public.diary_shares**: convites e permissões do Diário.
- **public.sync_tombstones**, criada por migration: registro de exclusões usado pela sincronização.

Existem índices por usuário, pasta, posição, revisão, arquivamento, favoritos, tags, anexos, data de Diário e full-text. RLS isola dados do proprietário e cria regras limitadas de leitura do Diário compartilhado aceito.

### 6.5 Markdown e metadados

**src/features/notes/api/notes-storage-api.ts** define o bucket de conteúdo **notes**. O caminho canônico do arquivo é userId/noteId.md. Esse arquivo guarda o Markdown da nota; o Postgres guarda metadados. O IndexedDB guarda a cópia local para leitura rápida e uso offline.

Antes de mudar onde o conteúdo é gravado, entenda os caminhos de readNoteMarkdown/writeNoteMarkdown, fetchNoteContent, notas novas, conflitos, tags e anexos. Não mova conteúdo do Storage para o Postgres sem migrar todos esses caminhos.

### 6.6 Anexos e mídia

**src/features/notes/api/storage-constants.ts** define o bucket de arquivos como **note-attachments**. **storage-api.ts** implementa conversão base64/Blob, caminhos, upload, validação, migração de anexos antigos e resolução de referências do documento.

Durante edição, mídia pode ser referenciada por URIs locais/canônicas attachment://ID ou local-attachment://ID. Isso permite que a nota exista localmente antes de o upload acabar.

Regras obrigatórias:
- Guardar o Blob no IndexedDB antes de depender do upload remoto.
- Não persistir referências temporárias não resolvidas no Markdown remoto.
- Não criar metadados note_attachments antes de a nota-pai existir remotamente.
- A ordem segura é criar/sincronizar a nota, enviar o binário, gravar metadados do anexo e persistir o conteúdo final com referências resolvidas.
- Preservar idempotência e lidar com sessão vencida, RLS, quota, arquivo já existente e Blob ausente.
- Ao excluir anexo, limpar referências no documento quando o fluxo de exclusão atual assim exigir.

Não trate URL como identidade do anexo. Preserve ID, note_id, storage_path, nome, tamanho e MIME type.

## 7. Sincronização local-first

### 7.1 Responsabilidade dos módulos

- **notes-api.ts**: operações de alto nível para notas, pastas, tags e conteúdo.
- **save-queue.ts**: serializa gravações locais por nota, consolida digitação rápida, normaliza tags e agenda o envio após debounce.
- **sync-engine.ts**: único motor das operações remotas; processa a fila, reconcilia conteúdo, trata conflitos/tombstones, conecta Realtime e notifica subscribers.
- **network-monitor.ts**: navigator.onLine + verificação real do backend, estado de rede, contagem de pendências e quota.
- **remote-operation-guard.ts**: deduplica chamadas remotas concorrentes/repetidas.
- **egress-guard.ts**: proteção de operações associadas a consumo remoto; verificar a implementação antes de mudar restrições de tráfego.
- **SyncStatusIndicator.tsx** e **SyncPendingModal.tsx**: exibição de status e pendências.

### 7.2 Fila, revisão e conflitos

A SyncQueue fica no IndexedDB e usa IDs determinísticos para consolidar operações da mesma entidade. As ações atuais cobrem criação/atualização/movimento/exclusão de notas e pastas, arquivo, restauração, favoritos, tags, upload e exclusão de anexos.

Preserve estes invariantes:
- A fila sobrevive à sessão e à falta de rede.
- Uma atualização antiga não pode sobrescrever a edição local mais recente.
- Respeite dependências de ordem: pasta-pai antes de filha e nota-pai antes do metadata de anexos.
- Tombstones devem impedir ressuscitar entidades apagadas durante PULL/Realtime.
- Erros permanentes, como RLS/403, autorização, schema/bucket inexistente e certos dados inválidos, não devem gerar retries infinitos.
- Falhas transitórias devem usar backoff.
- Conflitos precisam preservar conteúdo do usuário; não descarte edição local pendente silenciosamente.

### 7.3 Realtime, PULL e consumo de egress

SyncEngine mantém um canal Realtime por usuário ativo. Eventos de notes, folders e sync_tombstones são mesclados ao estado local sem substituir edição pendente/salvamento local.

O padrão atual privilegia o WebSocket Realtime saudável. PULL incremental é usado na inicialização/reconciliação e quando o canal Realtime não está saudável. Há watchdog local para verificar a fila e reconciliação remota de segurança de baixa frequência quando Realtime está desconectado.

Não adicione polling remoto constante, PULL completo por render ou download de todos os Markdown/anexos sem necessidade. Prefira consultas incrementais, projeções de colunas, filtro por usuário/workspace e deduplicação via remote-operation-guard.

### 7.4 Quota do Supabase

network-monitor reconhece respostas HTTP 402/exceed_egress_quota e informa estado de quota excedida. Nessa situação a sincronização remota deve respeitar as guardas existentes, enquanto dados locais e fila permanecem protegidos.

Evite tempestade de retries, múltiplos canais Realtime, downloads repetidos do mesmo conteúdo ou requisições a cada render. Não remova proteções de quota para apenas esconder um erro de rede.

## 8. Notas, sidebar, Favoritos e Arquivadas

**src/features/notes/api/notes-api.ts** é a API de alto nível usada pela UI. Ela carrega pastas/notas preferencialmente do IndexedDB, carrega conteúdo sob demanda, cria/renomeia/colore/configura pastas, cria/atualiza/exclui/move notas, lida com tags e controla arquivo/favorito.

**src/features/notes/utils/tree-builder.ts** transforma os dados em árvore recursiva e aplica cores efetivas, pastas inteligentes e views virtuais de Favoritos/Arquivadas. **path-builder.ts** monta caminho de pasta e remove referências a anexos. **hashtag-extractor.ts** normaliza tags e extrai hashtags. **markdown-tags.ts** faz o intercâmbio entre Markdown e tags.

**SidebarNavigation.tsx** é um dos componentes mais críticos e grandes. É responsável por árvore, busca, tags, abrir/fechar pastas, menus de contexto, edição inline de nome, criar itens, cores, pastas inteligentes, favoritos, arquivo, exclusão, drag-and-drop, seleção múltipla, seleção por área, movimento em lote, configurações e status de sincronização. Faça mudanças pequenas e localizadas; não substitua o componente inteiro para alterar um botão.

Componentes auxiliares da sidebar: **SidebarContextMenu.tsx**, **SidebarDeleteModals.tsx**, **BatchMoveModal.tsx**, **SmartFolderModal.tsx**, **FolderCustomColorModal.tsx**, **TagsModal.tsx** e **NoteTagsBar.tsx**. Confira se o fluxo já possui um componente específico antes de implementar outro.

**Favoritos** é uma propriedade da nota, não uma cópia. A pasta Favoritos é uma visualização virtual. Favoritar/desfavoritar não deve mudar o folder_id nem duplicar a entidade.

**Arquivamento** deve preservar conteúdo e permitir restauração à pasta anterior quando ela ainda existir. Confira previous_folder_id e as funções archive/unarchive.

## 9. Tags

**hashtag-extractor.ts** normaliza nomes, evita duplicatas por comparação sem diferenciar maiúsculas/minúsculas, remove o prefixo # para comparação e extrai hashtags do conteúdo sem interpretar partes de URLs como tags. Tags explícitas e hashtags do texto podem ser combinadas. **NoteTagsBar.tsx** controla criação, edição e exclusão de tags.

Tags de Notas e Diário são isoladas por workspace. Não remova workspace_type das consultas nem misture associações de note_tags entre workspaces. O projeto possui rotinas/migration para limpeza de tags automáticas antigas no Diário; não volte a gerar tags automáticas de data/dia. Preserve todas as tags manuais.

## 10. Diário: regras de negócio essenciais

O Diário é lazy e tem hierarquia própria:

- Um ano canônico por ano.
- Doze pastas de mês por ano.
- Dias aparecem virtualmente na sidebar; não crie notas vazias para todos os dias.
- Ao clicar em dia existente, abra a nota existente; em dia sem nota, crie uma entrada só por ação explícita do usuário.
- No máximo uma entrada por usuário/data.
- Abrir Diário destaca o dia atual e abre seu conteúdo somente se a entrada existir; não crie uma nota diária automaticamente.
- Não inserir tags automáticas de data/dia.
- Deduplicar preservando conteúdo, anexos e tags manuais.

Arquivos principais:
- **diary-date.ts**: datas locais, strings YYYY-MM-DD, títulos Dia XX, meses/dias da semana e formatação.
- **diary-hierarchy.ts**: reconhece ano/mês/nota diária pela hierarquia real.
- **diary-api.ts**: garante ano e doze meses, usa IDs determinísticos, cria ou reutiliza entrada e reconcilia duplicatas.
- **diary-tags-cleaner.ts**: remove tags automáticas antigas.
- **CreateDiaryEntryModal.tsx** e **CreateDiaryYearModal.tsx**: modais de criação.
- **DiaryLayout.tsx**: autenticação, carga e estado do Diário, handlers, assinaturas Realtime e editor.
- **DiarySidebarNavigation.tsx**: Ano → Mês → Dias virtuais, filtros, seleção, menus e movimento de entrada.

Se alterar IDs determinísticos ou regras de criação, procure todas as rotinas de reconciliação e as restrições únicas no SQL.

## 11. Diário compartilhado e segurança

O compartilhamento usa convites. O usuário proprietário convida um e-mail; RPC segura procura o UUID real no Supabase Auth; o compartilhamento registra owner/viewer. O convidado deve aceitar. Na UI, o Diário compartilhado é somente leitura.

Arquivos:
- **src/features/diary/api/diary-sharing-api.ts**: criar/aceitar/rejeitar/revogar convites e carregar dados/Markdown compartilhados.
- **ShareDiaryModal.tsx**: interface de convite.
- **PendingInvitationModal.tsx**: convite recebido.
- **SettingsSharingTab.tsx**: configuração de compartilhamento.
- **SharedDiaryLayout.tsx**: dados e Realtime da visualização compartilhada.
- **SharedDiarySidebarNavigation.tsx**: navegação do Diário compartilhado.
- **migration_diary_sharing.sql** e **migration_find_user_by_email.sql**: estrutura e RPC.
- **schema.sql**: policies e funções de acesso.

Não confie apenas em esconder botões de edição: RLS precisa continuar limitando leitura/acesso. Nunca exponha service-role key no cliente. Não masque erro de rede/RLS como “usuário não encontrado”, pois são situações diferentes.

## 12. Editor Tiptap: componentes e conteúdo

Componentes principais:
- **NoteCanvas.tsx**: tela do editor, estado de aba/divisão/zoom e navegação por referência.
- **NoteEditorPanel.tsx**: título, tags, folha/painel e componente editor.
- **NoteEditor.tsx**: instancia Tiptap, recebe conteúdo inicial, persiste alterações via callbacks, lida com colagem, anexos, seleção e eventos.
- **NoteTabs.tsx**: abas, fechar/nova aba, menu de contexto, dividir, desagrupar e trocar de lado.
- **EditorToolbar.tsx**: toolbar de formatação/inserção.
- **VoiceDictationControls.tsx**: ditado por voz nativo via Web Speech API (`pt-BR`, continuous, interimResults). Suporta início, pausa para edição manual livre, retomada na nova posição do cursor sem duplicar nem apagar texto prévio, encerramento e transações pontuais no ProseMirror integradas ao SaveQueue/IndexedDB.
- **FloatingBubbleToolbar.tsx**: toolbar contextual.
- **TextLevelDropdown.tsx**: níveis de texto.
- **InternalNoteReferenceModal.tsx**: escolha do destino de referência.
- **MediaResizeHandles.tsx** e **MediaToolbarControls.tsx**: controls de mídia.

**editor-config.ts** define a lista final de extensões do editor. Importar uma extensão sem registrá-la na lista pode não ativar sua funcionalidade.

Extensões customizadas presentes:
- **custom-highlight.ts**: highlight multicolorido e cálculo de tom para modo escuro.
- **custom-image.ts**, **ImageNodeView.tsx**, **use-media-resize.ts**: imagem/redimensionamento.
- **document-attachment.ts**, **DocumentNodeView.tsx**: documentos e anexos.
- **custom-youtube.ts**, **YoutubeNodeView.tsx**: vídeos do YouTube.
- **custom-task-item.ts**: checklist, quebra de item e foco.
- **toggle-details.ts**: bloco recolhível.
- **media-group.ts**: agrupamento de mídia.
- **pdf-drag-drop.ts** e **smart-media-drag-drop.ts**: movimentação de PDF, mídia e texto no documento.
- **double-dash-bullet-list.ts**: listas customizadas.
- **font-size.ts**: tamanho de fonte.
- **internal-note-link.ts**: referência interna.
- **node-movement.ts**, **media-common.ts**, **media-optimizer.ts** e **url-helper.ts**: utilitários de movimento, identificação, URLs e desempenho.

Documento Tiptap é estado ProseMirror com posições mutáveis. Não mova elementos só no DOM: a transação do documento precisa refletir o movimento para que a persistência seja correta. Para drag-and-drop, valide também que o nó não foi duplicado e que continua na posição correta ao reabrir.

Alterar atributos, nome de nó ou URI pode afetar HTML, Markdown, conteúdo já salvo, seleção, NodeViews, anexos e sync. Procure todos os caminhos de parse, render, serialize, migration e resolução de mídia.

### Referências internas

**src/features/notes/utils/internal-note-navigation.ts** guarda contexto de ida/volta em sessionStorage, não no Supabase. O contexto inclui workspace, nota de origem, pasta/data e nota de destino. A extensão cria a referência no documento e NoteCanvas recebe o evento, determina se o destino está em Notas ou Diário e oferece retorno. Não confunda o contexto de navegação com uma relação persistida no banco.

### Pastas e criação de notas
- **Pasta "Notas Rápidas"**: provisionada de forma determinística por usuário (`ensureQuickNotesFolder` em `notes-api.ts`), verificando IndexedDB local e Supabase remoto para evitar duplicatas entre dispositivos. O botão principal da sidebar ("Criar nota") cria notas automaticamente dentro de "Notas Rápidas", auto-expandindo a pasta. O menu contextual de pastas mantém a criação na pasta de destino clicada com o botão direito.
- **Criar subpasta**: opção exclusiva no menu contextual de pastas da sidebar (`SidebarContextMenu.tsx`). Cria pasta com `parent_id` da pasta selecionada, expande o nó pai e aciona imediatamente o modo de renomeação inline.

### Indentação de listas e hierarquia de marcadores
- **Indentação por Tab / Shift+Tab**: `ParagraphTabIndentExtension` em `editor-config.ts` detecta se a seleção atual está em um `listItem` ou `taskItem`. Caso positivo, repassa o comando para `sinkListItem` / `liftListItem`, permitindo aninhamento hierárquico correto de listas sem interferir no recuo de parágrafos padrão.
- **Hierarquia visual de marcadores**: configurada em `app/globals.css` para `ul:not([data-type="taskList"])` com sequência cíclica: Nível 0 (`disc`), Nível 1 (`circle`), Nível 2 (`square`) e repetição nos níveis subsequentes, com recuo visual padronizado de 1.25rem por nível. Listas ordenadas mantêm numeração e recuo consistente em todos os níveis.

### Cópia para área de transferência em texto limpo
- Configuração `transformCopiedText: false` na extensão `Markdown` (`editor-config.ts`) combinada com `clipboardTextSerializer` no `NoteEditor.tsx`.
- Ao copiar trechos do editor (Ctrl+C / Cmd+C), `text/plain` exporta texto limpo e legível sem marcadores Markdown crus (`**`, `*`, `~~`, `[]()`, `#`, `-`), enquanto `text/html` preserva a formatação rica para destinos compatíveis (Google Docs, Word).
- O armazenamento interno do documento, JSON e Markdown persistidos no IndexedDB e Supabase permanecem 100% inalterados.

### Visualizador de imagens (Lightbox) e navegação por teclado
- **Navegação com setas**: dentro do Lightbox em `ImageNodeView.tsx`, teclas `ArrowRight` (próxima imagem) e `ArrowLeft` (imagem anterior) percorrem as imagens da nota ativa na ordem vertical em que surgem no documento.
- Ao navegar entre imagens, o estado de zoom e pan é restaurado para 100% e centralizado, e a legenda ativa (`caption`) é atualizada de forma sincronizada.
### Visualizador e Editor de PDF integrado
- **Abertura em aba interna do Anotado**: cards PDF em `DocumentNodeView.tsx` disparam `anotado:open-pdf` com `attachmentId` e nome do arquivo. `MainLayout.tsx` adiciona/ativa uma aba do tipo `pdf` no mesmo estado de `NoteTabItem`; o PDF não abre uma nova aba do navegador e não navega para uma página independente.
- **Composição do workspace**: `NoteTabs.tsx` exibe abas de notas e PDFs na mesma barra. `NoteCanvas.tsx` mantém a barra de abas e renderiza `PdfViewerPageWrapper`/ `PdfEditor` no espaço de trabalho quando a aba PDF está ativa. O PDF pode ser selecionado e fechado como uma nota; não pode participar de tela dividida. Ao voltar para uma aba de nota, o editor Tiptap dessa nota volta a ser exibido sem alterar seu conteúdo.
- **Compatibilidade de rota**: `app/pdf/[attachmentId]/page.tsx` permanece como ponto de entrada legado/direto, mas a abertura normal a partir de uma nota não usa essa rota nem `window.open`.
- **Resolução dos bytes do PDF**: ao abrir, `DocumentNodeView.tsx` também resolve a origem por `resolveAttachmentSource` e envia a URL assinada/remota ou Blob URL junto do evento `anotado:open-pdf`. A URL é mantida no `NoteTabItem` PDF e repassada por `NoteCanvas`/`PdfViewerPageWrapper` ao `PdfEditor`. O loader tenta, nesta ordem: Blob do IndexedDB, URL já resolvida, download dos buckets `bucket_id`/`note-attachments`/`attachments`, e URL assinada recém-gerada. Se falhar, mantém os detalhes da última falha para diagnóstico.
- **Recuperação de PDF sem metadados e IDs legados**: `replaceNoteAttachment` recebe `sourceUrl` e `fileName`. Sempre tenta resolver o registro remoto por `user_id + storage_path` quando o ID do cartão não aponta para a linha canônica, mesmo que exista uma cópia local pelo ID legado. Se o registro remoto revelar outro ID, esse ID canônico é usado para a fila e o Blob local; o ID original do card fica em `requestedAttachmentId`. Na reabertura, `PdfEditor` procura primeiro por ID no IndexedDB e, em seguida, pelo `storage_path` extraído da URL do Storage; no fallback remoto faz a mesma consulta por caminho. Isso impede reabrir uma URL antiga quando o anexo canônico está salvo com outro ID. Se for um objeto legítimo na pasta do usuário sem linha metadata, reconstrói um `LocalAttachment` com o mesmo ID e caminho original. Nunca criar novo UUID nem novo caminho quando a URL já identifica o objeto existente.
- **RLS de Storage para anexos órfãos**: além de vincular operações a `note_attachments`, SELECT e UPDATE em `storage.objects` devem aceitar objetos em que o primeiro segmento do caminho seja `auth.uid()`. Isso é necessário para sobrescrever o objeto existente quando sua linha `note_attachments` está ausente e está sendo reconstruída. O prefixo continua limitado à pasta do usuário. Migration incremental: `supabase/migrations/20261104001000_allow_owner_to_replace_orphan_pdf_objects.sql`.
- **Substituição e sincronização de PDF no Supabase**: `replaceNoteAttachment` grava o Blob editado no IndexedDB e enfileira `REPLACE_ATTACHMENT`; isso é somente confirmação local, não confirmação da nuvem. A rotina também chama `syncEngine.setActiveUser(userId)` antes de agendar, pois `scheduleSync` processa a fila somente com `activeUserId` definido. O SyncEngine usa `item.payload.bucketId`/`attachment.bucket_id`, preserva o `storage_path`, exige que o retorno do Storage confirme o mesmo `path` e depois confirma em `note_attachments` `id`, `file_size`, `storage_path` e, quando disponível, `bucket_id`. Somente depois marca o IndexedDB como synced e dispara `attachment:replace-complete`.
- **RLS para upsert de PDF**: Supabase Storage `upload(..., { upsert: true })` exige políticas `SELECT`, `INSERT` e `UPDATE` em `storage.objects`. A migration `supabase/migrations/20261104000000_fix_pdf_attachment_upsert_rls.sql` adiciona policies restritas ao proprietário, vinculando objetos por `storage_path` e `user_id`, e garante SELECT/UPDATE/INSERT/DELETE proprietário em `public.note_attachments`. A migration deve ser aplicada no projeto Supabase (CLI ou SQL Editor); um deploy da Vercel não executa SQL automaticamente.
- **Status de salvar PDF**: sucesso de `replaceNoteAttachment` significa apenas que o Blob e a tarefa foram persistidos localmente. Quando a rede está disponível, `PdfEditor` aguarda até 20s pelo evento `attachment:replace-complete` antes de mostrar `Salvo na nuvem`; timeout/sem rede mantém o estado `Salvo localmente` com aviso explícito. O SyncEngine dispara `attachment:replace-failed` com mensagem/código/etapa e mantém o retry na SyncQueue. Não inferir envio remoto pelo retorno local da função nem pelo desaparecimento do estado dirty.
- **Seleção de texto e marcação contínua**: `PdfCanvasPage.tsx` mantém o canvas visual e monta uma camada HTML transparente (`.pdf-text-layer`) a partir de `page.getTextContent()`. A camada recebe ponteiros e cursor de texto nos modos `select`, `highlight`, `underline` e `strikethrough`, permitindo seleção nativa do navegador e Ctrl+C. Quando uma ferramenta de marcação de texto está ativa, ao soltar o mouse (`mouseup`) a seleção é convertida imediatamente em anotações no PDF agrupadas por página e gravadas no histórico, mantendo a ferramenta ativa para marcações sucessivas. Se o usuário estiver em `select` e ativar marca-texto/sublinhado/tachado com texto previamente selecionado, a marcação é aplicada imediatamente.
- **Exclusão de marcações e caixas de texto**: ao selecionar uma marcação de texto (`highlight`, `underline`, `strikethrough`), ela exibe um botão de lixeira flutuante discreto no canto superior direito de sua bounding box para exclusão direta (com histórico Undo/Redo); o botão de exclusão da barra inferior é ocultado para marcações de texto e mantido para outros tipos. Caixas de texto (`text`) são criadas por arrasto diagonal com preview tracejado ao vivo, gerando exatamente uma caixa por ativação e retornando para `select`. Caixas e notas adesivas possuem data-attributes (`data-pdf-annotation`, `data-pdf-text-editor`) e isolamento de propagação de eventos, prevenindo criação acidental de novas caixas ao clicar ou editar elementos existentes.
- **Coordenadas e exportação**: desenhos, formas, caixas de texto e retângulos de seleção usam coordenadas em pontos PDF (origem superior esquerda no estado da UI). `pdf-exporter.ts` converte para a origem inferior esquerda exigida pelo pdf-lib e grava os tipos `drawing`, `highlight`, `underline`, `strikethrough`, `text`, `shape` e `sticky_note` no conteúdo do arquivo PDF. Ao abrir o arquivo, faça uma cópia do ArrayBuffer antes de passá-lo ao PDF.js worker, para preservar os bytes originais usados por `pdf-lib` no salvamento.
- **PDFs grandes e miniaturas**: `PdfCanvasPage.tsx` usa IntersectionObserver com margem para renderizar somente páginas próximas da viewport; limita o DPR/pixels do canvas e libera buffers fora da área próxima. A camada de texto só é construída nas páginas renderizadas. `PdfThumbnailSidebar.tsx` também renderiza miniaturas sob demanda e mantém a miniatura ativa centralizada quando a página principal muda; a centralização automática pausa durante rolagem manual do painel lateral.
- **Interface e Ferramentas**: a interface do editor (`src/features/pdf/PdfEditor.tsx`) dispõe de cabeçalho com status de salvamento/sincronização, download e alternância de miniaturas; barra lateral retrátil com miniaturas de páginas (`PdfThumbnailSidebar.tsx`); e dock flutuante inferior (`PdfEditorToolbar.tsx`) com ferramentas de:
  - Seleção e movimentação de anotações (`select`);
  - Navegação e arraste de página (`hand`);
  - Destaque com seletor de paleta de cores (`highlight`);
  - Sublinhado (`underline`) e tachado (`strikethrough`);
  - Caneta / desenho livre com espessura e cores configuráveis (`pen`);
  - Borracha (`eraser`);
  - Caixas de texto livres e editáveis (`text`);
  - Formas geométricas: retângulos, círculos, linhas e setas (`shape`);
  - Notas adesivas e comentários com balão popover (`sticky_note`);
  - Histórico de desfazer/refazer (Undo/Redo) e atalhos de teclado (Ctrl+S, Ctrl+Z, Ctrl+Y, Esc, Del);
  - Controles de zoom (in, out, ajustar à largura e página inteira).
- **Exportação e Queima de Anotações**: `exportPdfWithAnnotations` em `pdf-exporter.ts` utiliza `pdf-lib` para embutir de forma vetorial todas as anotações diretamente nas páginas do PDF original, gerando um novo Blob PDF válido (`application/pdf`).
- **Sobrescrita exata no Supabase Storage**:
  - `replaceNoteAttachment` em `storage-api.ts` e o handler `REPLACE_ATTACHMENT` no `SyncEngine` (`sync-engine.ts`) executam `supabase.storage.from('note-attachments').upload(storagePath, blob, { upsert: true })` mantendo rigorosamente o mesmo `attachmentId`, mesmo `file_name` e mesmo `storage_path`.
  - A tabela `public.note_attachments` tem seus campos `file_size` e `updated_at` atualizados sem criar registros duplicados e sem alterar o conteúdo Markdown da nota.
  - O cache de URLs em memória (`invalidateAttachmentCache`) e o Blob no IndexedDB são atualizados imediatamente (local-first).
- **Rascunhos, salvamento e troca de abas**: como o `PdfEditor` é desmontado ao ativar outra aba interna, as anotações ainda não salvas são preservadas no metadata do IndexedDB com chave `pdf-editor-draft:<attachmentId>`. Ao reabrir a aba, restaura anotações e estado dirty. No salvamento, exporta sempre a base binária original da abertura + o snapshot mais recente de `annotationsRef.current`, grava o Blob no IndexedDB e enfileira `REPLACE_ATTACHMENT`. Não recarrega o PDF.js nem limpa a lista de anotações após salvar: os overlays continuam visíveis durante a sessão. Isso também evita duplicação em salvamentos repetidos, pois `rawPdfBytes` permanece como base original e o estado de anotações contém o conjunto completo da sessão. Ao reabrir o PDF, a nova base binária já contém as anotações incorporadas. O rascunho é removido somente depois da confirmação local. A confirmação "Salvo na nuvem" depende exclusivamente do evento `attachment:replace-complete`.
- **Marca-texto atrás do conteúdo original**: na tela, os grifos ficam na camada SVG própria sobre o canvas do PDF. Na exportação, `pdf-exporter.ts` normaliza a página com o pdf-lib, captura a quantidade de streams originais, cria um stream exclusivo de retângulos com opacidade normal (sem BlendMode Multiply), e o reposiciona imediatamente após o stream inicial `q` e antes dos streams originais de texto/imagem. O stream original não é reescrito; o cache interno `contentStream/contentStreamRef` é limpo para que as demais anotações sejam criadas em foreground. Manter o texto do PDF original intacto e não aplicar opacidade/clareamento ao texto.
- **Notas adesivas**: `PdfCanvasPage.tsx` exibe uma prévia do comentário no hover, abre o popover em clique, permite editar o textarea, excluir pelo botão de lixeira e mover pelo ícone via Pointer Events. O preview de arraste é apenas visual; `onUpdateAnnotation` é chamado uma única vez no pointerup para gerar um único ponto no histórico.
- **Menus de ferramentas**: os menus de cores/espessura das ferramentas highlight, pen e shape precisam abrir já no primeiro clique. O contêiner da toolbar mantém `overflow-visible` (não usar `overflow-x-auto`, que corta os popovers posicionados acima) e flex-wrap em viewports estreitas. Formas usam `penColor`/`penWidth` como cor e espessura do contorno.
- **Última página lida**: `PdfEditor.tsx` persiste a página atual no IndexedDB sob `pdf-editor-view:<attachmentId>` (version 1, pageIndex, updatedAt), com debounce durante a leitura, flush ao desmontar e gravação explícita em Salvar. Ao reabrir o mesmo anexo, valida/clampa a página pelo número total e restaura a rolagem sem alterar o arquivo PDF nem o conteúdo da nota.
- **Permissões**: diários compartilhados acessados por terceiros permanecem em modo estritamente somente leitura (`isReadOnly`), desativando ferramentas de edição e o botão de salvar.

### Abas

Abas e divisão são estado de interface, não duplicação de notas. Fechar aba não exclui nota; excluir nota precisa limpar as abas associadas; trocar de lado não deve mudar folder_id. Salve/flush conteúdo pendente antes das trocas quando o fluxo atual exigir. Respeite workspace e seleção ao navegar por links internos.

## 13. Drag-and-drop por contexto

Existem fluxos distintos:
- Sidebar de Notas: reorganiza nota/pasta e hierarquia.
- Sidebar do Diário: move entrada entre meses.
- Editor: move texto, PDF e outros nós dentro do mesmo documento.

Não compartilhe handlers entre esses contextos sem verificar contratos. Nas extensões ProseMirror, posição e tamanho dos nós mudam em uma transação. Uma linha visual de drop não prova que o documento foi atualizado; valide o estado, a persistência e a ausência de cópias duplicadas.

## 14. Tema e aparência

**theme-context.tsx** controla light/dark e persiste a opção na chave localStorage anotado_theme. **ThemeToggle.tsx** fornece o botão. app/layout.tsx aplica o tema antes da hidratação para reduzir flash.

Regras visuais:
- O tema claro é a referência; não o altere ao trabalhar apenas no modo escuro.
- O modo escuro usa preto/preto quase absoluto e exige contraste consistente em painéis, menus, popovers, inputs, texto, placeholders e editor.
- Use a arquitetura já existente de classe dark/tokens. Não use invert global nem filtros que afetem imagem/PDF.
- Não mude geometria/layout no tema claro acidentalmente ao adicionar estilos dark.
- Ao tocar no editor, confira títulos, texto normal/negrito, links, highlight colorido, seleções e placeholders.
- Preserve a paleta bege/marrom no claro e as decisões visuais existentes no escuro.

**app/globals.css** é transversal e de risco. Prefira regras escopadas e verifique consumidores antes de apagar estilos globais.

## 15. PWA e mobile

- **PwaProvider.tsx** fornece o estado PWA e modais/toasts.
- **usePwaInstall.ts** detecta instalação, iOS, Service Worker e atualização.
- **PwaInstallModal.tsx** trata instalação.
- **PwaUpdateToast.tsx** avisa de atualização.
- **public/sw.js**, manifestos e ícones sustentam o PWA.
- **useMobileKeyboardViewport.ts** adapta a UI ao teclado virtual.

Não coloque conteúdo privado em cache compartilhado. Mudanças no Service Worker devem respeitar isolamento de usuário e estratégia local-first.

## 16. Schema SQL e migrations

**src/features/notes/db/schema.sql** é a referência de tabelas, índices, functions e RLS. Não é necessariamente seguro executar o arquivo inteiro em uma base já utilizada: políticas ou objetos podem existir e provocar conflito. Prefira migrations incrementais.

Migrations versionadas:
- **migration_workspace_diary.sql**: colunas workspace/Diário, índices e unicidade da entrada diária.
- **migration_canonical_sync_tombstones.sql**: tombstones, publicação Realtime e canonicalização de workspace/Diário.
- **migration_cleanup_diary_duplicates.sql**: merge de anos/meses/entradas duplicados preservando conteúdo/anexos.
- **migration_cleanup_diary_automatic_tags.sql**: remove tags automáticas antigas, preservando tags manuais.
- **migration_diary_sharing.sql**: tabela de shares, funções de acesso, policies e Realtime.
- **migration_find_user_by_email.sql**: RPC segura para localizar usuário por e-mail.
- **migration_fix_attachments_rls.sql**: políticas para anexos e Storage.
- **migration_note_attachments_storage_policies.sql**: estrutura e policies de note_attachments/Storage.
- **migration_notes_favorite.sql**: is_favorite e índice.
- **migration_remove_needs_sync.sql**: remove campo legado remoto needs_sync, preservando revision.
- **migration_sync_guard.sql**: migration histórica de needs_sync/revision; leia junto de migration_remove_needs_sync antes de reutilizar.
- **migration_tags_persistence.sql**: persistência e tabelas normalizadas para tags.
- **migration_tags_workspace_isolation.sql**: separa tags por workspace.

Para SQL:
1. Confirme se objeto/policy/coluna já existe.
2. Leia schema e migrations relacionadas.
3. Faça migração incremental, idempotente e compatível com dados existentes.
4. Não mande executar o schema completo quando for necessária apenas uma migração.
5. Não crie policy duplicada ou permissiva para “resolver” erro rápido.
6. Verifique RLS para as quatro operações quando necessário.
7. Diferencie schema IndexedDB do schema Supabase: um não atualiza o outro.
8. Para regras de unicidade do Diário, coordene código, migração, IDs determinísticos e reconciliação.

## 17. Autenticação

- **src/features/auth/api/supabase-client.ts**: cliente browser/server e verificação de configuração.
- **src/features/auth/ui/LoginForm.tsx**: cadastro, login e estados de formulário.
- **src/features/auth/utils/auth-errors.ts**: validação e mensagens amigáveis.
- **middleware.ts**: sessão/cookies e redirecionamento.
- Supabase RLS delimita acesso usando auth.uid() e regras específicas para Diário compartilhado.

Não confie apenas em userId fornecido pela UI. Não use service-role key no cliente. Não transforme erro RLS, rede ou RPC em falso “não encontrado”.

## 18. Testes e validação

Arquivos de teste presentes:
- **src/features/notes/tests/attachment-linking-tests.ts**
- **src/features/notes/tests/attachment-reconciliation-tests.ts**
- **src/features/notes/tests/attachment-ref-migration-tests.ts**
- **src/features/notes/tests/base64-migration-tests.ts**

Confira se existe configuração/harness de execução antes de afirmar que esses arquivos rodam automaticamente. Um arquivo chamado test não necessariamente está ligado a um script npm.

Checklist final:
- TypeScript/build passam.
- Lint separado foi executado quando possível.
- Rota/componente alterado foi verificado.
- Dados locais sobrevivem offline.
- Quando a rede volta, a fila sincroniza sem duplicar entidades/anexos.
- Mudança remota não elimina edição local pendente.
- Notas e Diário permanecem isolados.
- Diário continua lazy, com anos/12 meses e uma entrada por dia.
- Referências internas, retorno, abas e divisão continuam coerentes.
- Mídias e documentos continuam visíveis depois de salvar e reabrir.
- Tema claro não foi alterado fora do pedido; tema escuro mantém contraste.
- Diário compartilhado continua somente leitura e protegido por RLS.
- Diff contém apenas mudanças relacionadas à tarefa.

Informe quais arquivos foram alterados, por quê, quais testes foram executados e seus resultados. Não declare “100% funcional” se não houve validação correspondente.

## 19. Inventário dos arquivos por módulo

Esta seção é um mapa rápido da base. Antes de alterar um item, leia o seu código e seus consumidores.

### Auth
- **supabase-client.ts**: clientes Supabase browser/server.
- **LoginForm.tsx**: login/cadastro.
- **auth-errors.ts**: validação e mensagens de auth.

### Layouts/workspaces
- **MainLayout.tsx**: estado de Notas, carregamento, handlers CRUD e integração sidebar/editor/sync.
- **WorkspaceSwitch.tsx**: alternância Notas/Diário.
- **DiaryLayout.tsx**: estado/carregamento e handlers do Diário.
- **SharedDiaryLayout.tsx**: carregamento e eventos da visualização compartilhada.
- **DiarySidebarNavigation.tsx**: árvore de ano/mês/dia, filtros, menus e movimento.
- **SharedDiarySidebarNavigation.tsx**: navegação compartilhada.

### Notas API e dados
- **notes-api.ts**: operações principais de notas/pastas/tags.
- **save-queue.ts**: gravação local serializada.
- **sync-engine.ts**: SyncQueue, Realtime, PULL, conflitos, tombstones.
- **network-monitor.ts**: rede/backend/quota.
- **egress-guard.ts**: guardas de tráfego remoto.
- **remote-operation-guard.ts**: deduplicação de chamadas remotas.
- **notes-storage-api.ts**: Markdown no Storage.
- **storage-api.ts**: anexos, Blob, uploads e referências locais/remotas.
- **storage-constants.ts**: nome de bucket de anexos.
- **attachment-linker.ts**: ligação entre anexos e referências.
- **attachment-reconciler.ts**: reconciliação de anexos.
- **attachment-ref-migrator.ts**: formato legado de referências.
- **base64-attachment-migrator.ts**: migração de base64.
- **diary-api.ts**: hierarquia e entradas do Diário.
- **diary-tags-cleaner.ts**: limpeza de tags automáticas.

### Banco e tipos
- **indexed-db.ts**: stores/índices locais e SyncQueue.
- **schema.sql**: schema Supabase, functions, índices e RLS.
- **migration_*.sql**: alterações incrementais descritas na seção 16.
- **types/index.ts**: tipos de modelos e árvore.
- **uuid.ts**: geração de IDs.

### UI Notas
- **SidebarNavigation.tsx**: árvore, busca, tags, menus, favorito, arquivo, drag-and-drop, seleção e ações em lote.
- **NoteCanvas.tsx**: editor, abas/divisão, zoom e navegação de referência.
- **NoteEditorPanel.tsx**: título, tags e painel de conteúdo.
- **NoteEditor.tsx**: Tiptap, colagem, conteúdo e anexos.
- **NoteTabs.tsx**: abas e divisão/troca de painéis.
- **EditorToolbar.tsx**: ferramentas de formatação e inserção.
- **FloatingBubbleToolbar.tsx**: toolbar sobre seleção.
- **TextLevelDropdown.tsx**: nível do texto.
- **NoteTagsBar.tsx**: editar tags.
- **InternalNoteReferenceModal.tsx**: seleção da nota destino.
- **SidebarContextMenu.tsx**: menu de contexto.
- **SidebarDeleteModals.tsx**: confirmações de exclusão.
- **BatchMoveModal.tsx**: movimento em lote.
- **FolderCustomColorModal.tsx**: cor customizada.
- **SmartFolderModal.tsx**: pasta inteligente.
- **TagsModal.tsx**: gestão de tags.
- **SettingsModal.tsx**: configurações de conta, exportação, aparência, instalação e compartilhamento.
- **SyncStatusIndicator.tsx** e **SyncPendingModal.tsx**: estado e pendências de sincronização.
- **CreateDiaryEntryModal.tsx** e **CreateDiaryYearModal.tsx**: criação de itens do Diário.
- **sidebar-constants.ts**: constantes da sidebar.

### Editor e mídia
- **editor-config.ts**: registry das extensões Tiptap.
- **custom-highlight.ts**: highlight e tema escuro.
- **custom-image.ts** / **ImageNodeView.tsx** / **use-media-resize.ts**: imagem e redimensionamento.
- **document-attachment.ts** / **DocumentNodeView.tsx**: anexos/documentos.
- **custom-youtube.ts** / **YoutubeNodeView.tsx**: YouTube.
- **custom-task-item.ts**: checklist.
- **toggle-details.ts**: blocos recolhíveis.
- **media-group.ts**: agrupamento.
- **pdf-drag-drop.ts**: movimento de PDF.
- **smart-media-drag-drop.ts**: movimento de texto/mídia.
- **double-dash-bullet-list.ts**: listas personalizadas.
- **font-size.ts**: tamanhos.
- **internal-note-link.ts**: referência interna.
- **MediaResizeHandles.tsx** / **MediaToolbarControls.tsx**: controles de mídia.
- **media-common.ts**, **media-optimizer.ts**, **node-movement.ts**, **url-helper.ts**: utilitários do editor.
- **useMobileKeyboardViewport.ts**: comportamento com teclado móvel.

### Editor e Visualizador de PDF (Biblioteca e Grifo Definitivo)
- **PdfEditor.tsx**: workspace completo do editor de PDF com miniaturas, paginação contínua, zoom e ferramentas.
- **PdfCanvasPage.tsx**: renderização isolada de cada página com `<canvas>` do PDF, camada de texto `.pdf-text-layer` para seleção e camada SVG dedicada para grifos. As miniaturas são fechadas por padrão na abertura do PDF (`isSidebarOpen=false`) e aparecem somente quando o usuário ativa o botão de miniaturas.
- **PdfEditorToolbar.tsx**: barra de ferramentas do PDF (marca-texto, caneta livre, sublinhado, tachado, caixas de texto, notas adesivas, formas geométricas, seleção, zoom, desfazer/refazer, download e exclusão).
- **pdf-exporter.ts**: exportação e salvamento vetorial de PDFs anotados via `pdf-lib`. Os grifos são renderizados em um content stream exclusivo, colocado após o `q` inicial de proteção gráfica e antes dos streams originais da página, com opacidade normal e sem blend mode. Sublinhados, tachados, desenhos, formas, textos e notas são adicionados em streams posteriores.
- **AddPdfModal.tsx**: modal acessado pelo botão "Adicionar PDF" no rodapé de ações da sidebar (`#sidebar-add-pdf-btn`, posicionado na mesma área visual dos botões "Pasta" e "Nota", com ícone de PDF e identificação discreta em vermelho `#e11d48`). Permite selecionar arquivos PDF locais exibindo nome e tamanho formatado (KB/MB) com duas possibilidades: Opção A (Biblioteca de PDFs como item independente na árvore lateral, com seleção de pasta de destino ou raiz) e Opção B (Anexar a uma nota existente, injetando o cartão no conteúdo da nota selecionada).
- **20261104010000_add_pdf_library_items.sql**: migration que adiciona `is_library_item`, `folder_id` e `position` à tabela `note_attachments`, tornando `note_id` opcional para itens da biblioteca. Suportado na SyncQueue via `UPDATE_ATTACHMENT_METADATA` e `DELETE_ATTACHMENT`.

### Utilitários e testes
- **diary-date.ts**: funções de data.
- **diary-hierarchy.ts**: classificação da hierarquia do Diário.
- **export-notes.ts**: ZIP de notas não arquivadas.
- **hashtag-extractor.ts**: extração/normalização de tags.
- **internal-note-navigation.ts**: contexto de referência/retorno.
- **markdown-tags.ts**: Markdown e tags.
- **path-builder.ts**: caminhos e limpeza de referência de anexo.
- **tree-builder.ts**: árvore/filtragem.
- **attachment-linking-tests.ts**, **attachment-reconciliation-tests.ts**, **attachment-ref-migration-tests.ts**, **base64-migration-tests.ts**: testes focados no ciclo de anexos.

### Tema e PWA
- **theme-context.tsx** / **ThemeToggle.tsx**: estado e botão de tema.
- **PwaProvider.tsx**: provider.
- **usePwaInstall.ts**: instalação, SW e atualização.
- **PwaInstallModal.tsx** / **PwaUpdateToast.tsx**: UI de PWA.
- **public/sw.js**, manifestos e ícones: recursos instaláveis.
- **scripts/generate-icons.js**: geração de ícones.

### Recomendações práticas para tarefas futuras
1. Entenda o pedido e localize os arquivos relevantes.
2. Siga o fluxo completo da UI até a persistência e volta dos dados.
3. Leia os tipos, consumers, schema/migrations e testes pertinentes.
4. Implemente uma mudança pequena, com tratamento de offline/erro se for pertinente.
5. Valide o comportamento e o diff.
6. Atualize esta documentação quando a arquitetura mudar.
7. Relate apenas o que foi realmente alterado/testado.

Princípio final: ANOTADO é um sistema local-first com sincronização eventual, anexos referenciados, workspaces isolados e Diário lazy. Uma solução visualmente correta que quebra IndexedDB, SyncQueue, anexos, RLS, isolamento de workspace ou reconciliação remota não é válida.


## 21. Padrão de instruções e carregamento por agentes

Este projeto mantém a documentação canônica em **.agents/AGENTS.md** para ser descoberta pelo ambiente de agentes do Google AI Studio. Os arquivos da raiz **GEMINI.md** e **AGENTS.md** são pontos de entrada compatíveis com ferramentas que procuram nomes diferentes; eles direcionam a IA para este contexto canônico.

Referências oficiais usadas para definir o padrão:
- Google AI Studio — Agents: https://ai.google.dev/gemini-api/docs/aistudio-agents
- Google AI Studio — Build mode: https://ai.google.dev/gemini-api/docs/aistudio-build-mode
- Gemini CLI — GEMINI.md: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/configuration.md
- GitHub Copilot — Custom instructions: https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot

Ao iniciar uma tarefa, a IA deve ler este arquivo canônico antes de editar. Se a ferramenta só carregar GEMINI.md ou AGENTS.md automaticamente, deve seguir o arquivo-ponte e abrir .agents/AGENTS.md. Não manter versões divergentes do contexto: a documentação completa oficial do projeto fica em .agents/AGENTS.md.

## PDF — persistência nativa de grifos e comentários

- Grifos do marca-texto não devem ser achatados em retângulos de foreground nem depender de reordenação privada de content streams. `pdf-exporter.ts` grava cada grifo como anotação nativa `/Subtype /Highlight` dentro de `/Annots`, usando `/QuadPoints`, `/C`, `/CA`, `/T = ANOTADO` e `/NM = ANOTADO:<id>`. PDF.js 4.10.38 reconhece esse subtipo e gera aparência padrão com blend mode Multiply, preservando a legibilidade dos glifos.
- Notas adesivas/comentários devem ser gravadas como anotações nativas `/Subtype /Text`, com o comentário no campo `/Contents`, autor `/T = ANOTADO` e identificador `/NM = ANOTADO:<id>`. Nunca desenhar o ícone '?' nem imprimir o conteúdo do comentário ao lado do ícone no conteúdo da página.
- Antes de exportar, remover somente entradas de `/Annots` cujo `/NM` comece com `ANOTADO:`; preservar anotações pertencentes a outros autores/leitores. Depois recriar grifos e notas a partir do estado atual, evitando duplicação em salvamentos sucessivos.
- Ao abrir um PDF, `PdfEditor.tsx` percorre `page.getAnnotations({ intent: 'display' })`, identifica `titleObj.str === 'ANOTADO'` e reconstrói `HighlightAnnotation` a partir de `quadPoints` e `StickyNoteAnnotation` a partir de `rect/contentsObj`. Rascunhos locais não salvos continuam tendo precedência sobre as anotações persistidas no arquivo.
- `PdfCanvasPage.tsx` usa `annotationMode: 0` ao renderizar o canvas: as anotações nativas são lidas pelo PDF.js, mas a visualização do editor é desenhada uma única vez pelas camadas SVG/HTML do ANOTADO. Não voltar a desenhar a camada nativa e a camada customizada simultaneamente.
- Antes de chamar `replaceNoteAttachment`, `PdfEditor.tsx` reabre o Blob exportado com PDF.js e valida que o número de anotações nativas `/Highlight` e `/Text` do autor ANOTADO é pelo menos igual ao esperado no estado atual. Se a validação falhar, não gravar no IndexedDB/SyncQueue nem enviar ao Supabase.
- As anotações ficam incorporadas no próprio binário PDF armazenado em Supabase Storage; não exigem tabela ou migration específica para coordenadas de grifos/notas. A tabela `note_attachments` continua guardando metadados do arquivo e o Storage guarda o PDF completo.

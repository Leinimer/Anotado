'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarNavigation } from '@/src/features/notes/ui/SidebarNavigation';
import { NoteCanvas } from '@/src/features/notes/ui/NoteCanvas';
import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { Folder, Note } from '@/src/features/notes/types';
import {
  fetchFoldersAndNotes,
  fetchNoteContent,
  createFolder,
  renameFolder,
  updateFolderColor,
  updateFolderSmartConfig,
  deleteFolder,
  createNote,
  updateNoteTitle,
  updateNoteContent,
  updateNoteTags,
  deleteNote,
  archiveNote,
  unarchiveNote,
  archiveFolderNotes,
  toggleNoteFavorite,
  moveItem,
  reorderNotesBatch,
  flushNoteSaves,
  flushAllPendingSaves,
  ensureQuickNotesFolder,
  isQuickNotesFolder,
} from '@/src/features/notes/api/notes-api';
import { syncEngine } from '@/src/features/notes/api/sync-engine';
import { saveQueue } from '@/src/features/notes/api/save-queue';
import { perfProfiler } from '@/src/features/notes/editor/utils/media-optimizer';
import { WorkspaceType } from '@/src/features/notes/types';
import { NoteTabItem } from '@/src/features/notes/ui/NoteTabs';
import {
  fetchLibraryPdfs,
  createLibraryPdf,
  renameLibraryPdf,
  moveLibraryPdf,
  deleteLibraryPdf,
  attachPdfToNote,
} from '@/src/features/notes/api/storage-api';
import { indexedDBStorage } from '@/src/features/notes/db/indexed-db';

export function MainLayout() {
  const router = useRouter();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [libraryPdfs, setLibraryPdfs] = useState<any[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isNewNoteJustCreated, setIsNewNoteJustCreated] = useState(false);

  // Estado do Sistema de Abas (Apenas interface/memória do cliente)
  const [tabs, setTabs] = useState<NoteTabItem[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('anotado_active_notes_id');
      if (saved) {
        return [{ id: `tab-${saved}`, noteId: saved }];
      }
    }
    return [];
  });
  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('anotado_active_notes_id');
      if (saved) {
        return `tab-${saved}`;
      }
    }
    return null;
  });

  // Estado de Divisão de Tela (Apenas interface/memória do cliente)
  const [isSplit, setIsSplit] = useState(false);
  const [leftNoteId, setLeftNoteId] = useState<string | null>(null);
  const [rightNoteId, setRightNoteId] = useState<string | null>(null);
  const [activeSplitPane, setActiveSplitPane] = useState<'left' | 'right'>('left');

  const activeNoteIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeNoteIdRef.current = activeNoteId;
    if (typeof window === 'undefined') return;

    // A chave só representa a última nota realmente selecionada.
    // Quando o workspace está vazio, remove o valor antigo para não reabrir
    // uma nota anterior em uma próxima sessão.
    if (activeNoteId) {
      sessionStorage.setItem('anotado_active_notes_id', activeNoteId);
    } else {
      sessionStorage.removeItem('anotado_active_notes_id');
    }
  }, [activeNoteId]);

  // 1. Carregamento inicial do Supabase, ouvintes de autenticação e reatividade do SyncEngine
  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();

    // Inscrição reativa para atualizações provenientes do SyncEngine e Supabase Realtime
    const unsubscribeSync = syncEngine.subscribeToData(({ folders: rawSyncFolders, notes: rawSyncNotes }) => {
      if (!isMounted) return;

      // Isolamento rigoroso: A página Notas NÃO deve exibir pastas ou notas pertencentes ao Diário
      const diaryYearIds = new Set(
        rawSyncFolders
          .filter((f) => !f.parent_id && (f.workspace_type === 'diary' || f.diary_year || /^\d{4}$/.test(f.name.trim())))
          .map((f) => f.id)
      );
      const isDiaryFolder = (f: any) => {
        if (f.workspace_type === 'diary') return true;
        if (f.diary_year || f.diary_month) return true;
        if (!f.parent_id && /^\d{4}$/.test(String(f.name || '').trim())) return true;
        if (f.parent_id && diaryYearIds.has(f.parent_id)) return true;
        return false;
      };

      const newFolders = rawSyncFolders.filter((f) => !isDiaryFolder(f));
      const diaryFolderIds = new Set([
        ...Array.from(diaryYearIds),
        ...rawSyncFolders.filter((f) => f.parent_id && diaryYearIds.has(f.parent_id)).map((f) => f.id),
      ]);
      const newNotes = rawSyncNotes.filter(
        (n) =>
          !(
            n.workspace_type === 'diary' ||
            Boolean(n.entry_date) ||
            Boolean(n.diary_year) ||
            (n.folder_id && diaryFolderIds.has(n.folder_id))
          )
      );

      setFolders((prevFolders) => {
        const pendingFolderMap = new Map(
          prevFolders.filter((f: any) => f.syncRequired || f.needs_sync).map((f) => [f.id, f])
        );
        const merged = newFolders.map((nf) => pendingFolderMap.get(nf.id) || nf);
        for (const [id, pf] of pendingFolderMap.entries()) {
          if (!merged.some((f) => f.id === id)) {
            merged.push(pf);
          }
        }
        return merged.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      });

      setNotes((prevNotes) => {
        const currentActiveId = activeNoteIdRef.current;
        const prevNotesMap = new Map(prevNotes.map((n) => [n.id, n]));

        const merged = newNotes.map((n) => {
          const currentInState = prevNotesMap.get(n.id);
          if (!currentInState) return n;

          // Se é a nota ativa aberta no Canvas
          if (n.id === currentActiveId) {
            const isPending = (currentInState as any).syncRequired || (currentInState as any).needs_sync;
            const isSaving = saveQueue.hasPendingSaveForNote(n.id);

            // Se o usuário está ativamente editando, preserva o conteúdo do editor; se ocioso, aceita conteúdo resolvido
            const chosenContent = (isPending || isSaving)
              ? (currentInState.content !== undefined ? currentInState.content : n.content)
              : (n.content !== undefined ? n.content : currentInState.content);

            const chosenTags = currentInState.tags && currentInState.tags.length > 0 ? currentInState.tags : n.tags;

            // Preserva a referência de objeto se não houve mudança substancial para evitar re-renders no Canvas
            if (
              currentInState.title === n.title &&
              currentInState.content === chosenContent &&
              currentInState.folder_id === n.folder_id &&
              currentInState.position === n.position &&
              JSON.stringify(currentInState.tags || []) === JSON.stringify(chosenTags || [])
            ) {
              return currentInState;
            }

            return {
              ...n,
              content: chosenContent,
              tags: chosenTags,
            };
          }

          // Se a nota local possui alterações pendentes ou revisão superior, preserva o estado local
          const isPending = (currentInState as any).syncRequired || (currentInState as any).needs_sync;
          const isSaving = saveQueue.hasPendingSaveForNote(n.id);
          if (isPending || isSaving || (currentInState.revision || 0) > (n.revision || 0)) {
            return currentInState;
          }

          return {
            ...n,
            content: n.content !== undefined ? n.content : currentInState.content,
          };
        });

        // Preserva notas criadas localmente que ainda estejam em processamento ou com pendências
        for (const [id, pn] of prevNotesMap.entries()) {
          const isPending = (pn as any).syncRequired || (pn as any).needs_sync;
          const isSaving = saveQueue.hasPendingSaveForNote(id);
          if ((isPending || isSaving) && !merged.some((n) => n.id === id)) {
            merged.push(pn);
          }
        }

        // Se a nota ativa foi excluída remotamente e não possui pendências locais, limpa a visualização
        if (currentActiveId && !merged.some((n) => n.id === currentActiveId)) {
          setTimeout(() => setActiveNoteId(null), 0);
        }

        return merged.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      });
    });

    // Obtém o usuário autenticado atual com suporte robusto a inicialização offline
    const resolveUserAndLoad = async () => {
      let currentUserId = 'demo-user';

      // 1. Tenta getSession (lê do armazenamento local/cache do Supabase sem requisição de rede)
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user?.id) {
          currentUserId = sessionData.session.user.id;
        }
      } catch (e) {
        console.warn('[MainLayout] Aviso ao obter sessão local:', e);
      }

      // 2. Se não encontrou e estiver online, tenta getUser
      if (currentUserId === 'demo-user' && navigator.onLine) {
        try {
          const { data: userData } = await supabase.auth.getUser();
          if (userData?.user?.id) {
            currentUserId = userData.user.id;
          }
        } catch (e) {
          console.warn('[MainLayout] Aviso ao verificar usuário online:', e);
        }
      }

      // 3. Fallback para último userId autenticado gravado localmente
      if (currentUserId === 'demo-user' && typeof window !== 'undefined') {
        const cachedId = localStorage.getItem('anotado_last_auth_user_id');
        if (cachedId && cachedId !== 'demo-user') {
          currentUserId = cachedId;
        }
      }

      if (!isMounted) return;

      if (currentUserId !== 'demo-user' && typeof window !== 'undefined') {
        localStorage.setItem('anotado_last_auth_user_id', currentUserId);
      }

      currentUserIdRef.current = currentUserId;
      setUserId(currentUserId);
      syncEngine.setActiveUser(currentUserId);

      // Carrega pastas e notas reais diretamente do Supabase/IndexedDB
      try {
        const { folders: fetchedFolders, notes: fetchedNotes } = await fetchFoldersAndNotes(currentUserId, 'notes');
        if (!isMounted) return;

        let allFolders = fetchedFolders;
        try {
          const quickFolder = await ensureQuickNotesFolder(currentUserId);
          if (!allFolders.some((f) => f.id === quickFolder.id)) {
            allFolders = [quickFolder, ...allFolders];
          }
        } catch (qErr) {
          console.warn('[MainLayout] Aviso ao provisionar Notas Rápidas na inicialização:', qErr);
        }

        setFolders(allFolders);
        setNotes(fetchedNotes);

        try {
          const fetchedPdfs = await fetchLibraryPdfs(currentUserId);
          if (isMounted) {
            setLibraryPdfs(fetchedPdfs);
          }
        } catch (pdfErr) {
          console.warn('[MainLayout] Aviso ao carregar PDFs da biblioteca:', pdfErr);
        }

        const savedActiveId =
          typeof window !== 'undefined'
            ? sessionStorage.getItem('anotado_active_notes_id')
            : null;

        // O workspace inicia vazio quando não existe uma seleção válida salva.
        // A nota só é aberta após clique explícito na árvore ou em um link.
        if (savedActiveId && fetchedNotes.some((n) => n.id === savedActiveId)) {
          setActiveNoteId(savedActiveId);
          const initialTabId = `tab-${savedActiveId}`;
          setTabs([{ id: initialTabId, noteId: savedActiveId }]);
          setActiveTabId(initialTabId);
        } else {
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem('anotado_active_notes_id');
          }
          setActiveNoteId(null);
          setTabs([]);
          setActiveTabId(null);
        }

        // Apenas verifica se há mutações pendentes locais na fila (sem disparar PULL desnecessário)
        syncEngine.checkWatchdog(currentUserId);
      } catch (err) {
        console.error('[MainLayout] Erro ao carregar dados do Supabase:', err);
      }
    };

    resolveUserAndLoad();

    let authUnsubscribe: (() => void) | undefined;
    if (isSupabaseConfigured()) {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event: any, session: any) => {
        if (event === 'SIGNED_OUT') {
          if (typeof window !== 'undefined') {
            localStorage.removeItem('anotado_last_auth_user_id');
          }
          currentUserIdRef.current = null;
          syncEngine.cleanup();
          if (typeof window !== 'undefined') {
            window.location.replace('/login');
          }
        } else if (event === 'SIGNED_IN') {
          // Ignora TOKEN_REFRESHED e não duplica inicialização se for o mesmo usuário já carregado
          if (session?.user?.id && session.user.id !== currentUserIdRef.current) {
            const newUid = session.user.id;
            currentUserIdRef.current = newUid;
            if (typeof window !== 'undefined') {
              localStorage.setItem('anotado_last_auth_user_id', newUid);
            }
            setUserId(newUid);
            syncEngine.setActiveUser(newUid);
            syncEngine.checkWatchdog(newUid);
          }
        }
      });
      authUnsubscribe = () => subscription.unsubscribe();
    }

    return () => {
      isMounted = false;
      unsubscribeSync();
      syncEngine.cleanup();
      if (authUnsubscribe) authUnsubscribe();
    };
  }, []);

  // Carrega o conteúdo do arquivo Markdown no Storage ao selecionar uma nota
    // Abre/seleciona uma nota na aba ativa ou em uma aba nova.
  // Atualiza o estado da interface antes do fetch para a nota aparecer
  // imediatamente; erros de Storage não devem desfazer a seleção visual.
  const handleSelectNote = useCallback(
    async (noteId: string, openInNewTab: boolean = false) => {
      const targetNote = notes.find((note) => note.id === noteId);
      if (!targetNote || targetNote.is_archived) return;

      perfProfiler.start(noteId);
      setIsNewNoteJustCreated(false);

      if (activeNoteId && activeNoteId !== noteId) {
        try {
          await flushNoteSaves(activeNoteId);
        } catch (error) {
          console.warn('[MainLayout] Não foi possível finalizar o save anterior antes de trocar de nota:', error);
        }
      }

      let selectedTabId: string | null = null;

      if (isSplit) {
        if (noteId === leftNoteId) {
          setActiveSplitPane('left');
          selectedTabId = tabs.find((tab) => tab.type !== 'pdf' && tab.noteId === noteId)?.id || null;
        } else if (noteId === rightNoteId) {
          setActiveSplitPane('right');
          selectedTabId = tabs.find((tab) => tab.type !== 'pdf' && tab.noteId === noteId)?.id || null;
        } else {
          const existingTab = tabs.find((tab) => tab.type !== 'pdf' && tab.noteId === noteId);
          selectedTabId = existingTab?.id || `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

          if (!existingTab) {
            setTabs((previous) => [...previous, { id: selectedTabId!, noteId }]);
          }

          if (activeSplitPane === 'right') {
            setRightNoteId(noteId);
          } else {
            setLeftNoteId(noteId);
          }
        }
      } else {
        const existingTab = tabs.find((tab) => tab.type !== 'pdf' && tab.noteId === noteId);

        if (existingTab) {
          selectedTabId = existingTab.id;
        } else if (
          openInNewTab ||
          tabs.length === 0 ||
          !activeTabId ||
          tabs.some((tab) => tab.id === activeTabId && tab.type === 'pdf')
        ) {
          selectedTabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          setTabs((previous) => [...previous, { id: selectedTabId!, noteId }]);
        } else {
          selectedTabId = activeTabId;
          setTabs((previous) =>
            previous.map((tab) =>
              tab.id === activeTabId ? { ...tab, noteId } : tab
            )
          );
        }
      }

      if (selectedTabId) setActiveTabId(selectedTabId);
      setActiveNoteId(noteId);

      try {
        const { content, tags } = await fetchNoteContent(userId, targetNote);
        setNotes((previous) =>
          previous.map((note) =>
            note.id === noteId
              ? {
                  ...note,
                  content: content !== undefined ? content : note.content,
                  tags: tags && tags.length > 0 ? tags : note.tags,
                }
              : note
          )
        );
        perfProfiler.mark(noteId, 'Markdown carregado');
      } catch (error) {
        console.error('[MainLayout] Erro ao carregar conteúdo da nota:', noteId, error);
        // A seleção/aba permanece aberta; a cópia local não é descartada.
      }
    },
    [
      activeNoteId,
      activeTabId,
      isSplit,
      leftNoteId,
      rightNoteId,
      activeSplitPane,
      tabs,
      notes,
      userId,
    ]
  );

  // Abre/ativa um PDF como aba interna do mesmo workspace de notas.
  const handleOpenPdfTab = useCallback(
    async (detail: { attachmentId?: string; fileName?: string; sourceUrl?: string }) => {
      const attachmentId = detail.attachmentId?.trim();
      if (!attachmentId) return;

      const noteIdsToFlush = new Set([activeNoteId, leftNoteId, rightNoteId].filter(Boolean) as string[]);
      await Promise.all(
        Array.from(noteIdsToFlush).map((id) =>
          flushNoteSaves(id).catch((error) =>
            console.warn('[MainLayout] Falha ao finalizar nota antes de abrir PDF:', error)
          )
        )
      );

      const existingTab = tabs.find(
        (tab) => tab.type === 'pdf' && tab.attachmentId === attachmentId
      );
      const pdfTab: NoteTabItem = existingTab
        ? {
            ...existingTab,
            sourceUrl: existingTab.sourceUrl || detail.sourceUrl,
            title: detail.fileName || existingTab.title || 'Documento PDF',
          }
        : {
            id: `pdf-tab-${attachmentId}`,
            type: 'pdf',
            noteId: '',
            attachmentId,
            sourceUrl: detail.sourceUrl,
            title: detail.fileName || 'Documento PDF',
          };

      setTabs((previous) => {
        const alreadyOpen = previous.some(
          (tab) => tab.type === 'pdf' && tab.attachmentId === attachmentId
        );
        return alreadyOpen
          ? previous.map((tab) =>
              tab.type === 'pdf' && tab.attachmentId === attachmentId ? pdfTab : tab
            )
          : [...previous, pdfTab];
      });

      setIsSplit(false);
      setLeftNoteId(null);
      setRightNoteId(null);
      setActiveTabId(pdfTab.id);
      setActiveNoteId(null);
      setIsNewNoteJustCreated(false);
      setMobileSidebarOpen(false);
    },
    [activeNoteId, leftNoteId, rightNoteId, tabs]
  );

  // Abre a nota ou PDF selecionado no botão direito em uma nova aba sem reutilizar a aba ativa.
  const handleOpenNoteInNewTab = useCallback(
    async (noteId: string) => {
      // Se for um PDF da biblioteca
      const pdfTarget = libraryPdfs.find((p) => p.id === noteId);
      if (pdfTarget) {
        await handleOpenPdfTab({
          attachmentId: pdfTarget.id,
          fileName: pdfTarget.file_name,
          sourceUrl: (pdfTarget as any).public_url || (pdfTarget as any).remote_url || undefined,
        });
        return;
      }

      const target = notes.find((note) => note.id === noteId);
      if (!target || target.is_archived) return;

      if (activeNoteId && activeNoteId !== noteId) {
        try {
          await flushNoteSaves(activeNoteId);
        } catch (error) {
          console.warn('[MainLayout] Falha ao finalizar o salvamento antes de abrir nova aba:', error);
        }
      }

      const existingTab = tabs.find((tab) => tab.type !== 'pdf' && tab.noteId === noteId);
      let newTabId = existingTab?.id || null;

      if (!newTabId) {
        newTabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setTabs((previous) => [...previous, { id: newTabId!, noteId }]);
      }

      setActiveTabId(newTabId);
      setActiveNoteId(noteId);
      setIsNewNoteJustCreated(false);

      try {
        const { content, tags } = await fetchNoteContent(userId, target);
        setNotes((previous) =>
          previous.map((note) =>
            note.id === noteId
              ? {
                  ...note,
                  content: content !== undefined ? content : note.content,
                  tags: tags && tags.length > 0 ? tags : note.tags,
                }
              : note
          )
        );
      } catch (error) {
        console.error('[MainLayout] Erro ao carregar nota aberta em nova aba:', noteId, error);
      }
    },
    [notes, libraryPdfs, activeNoteId, tabs, userId, handleOpenPdfTab]
  );

  // Seleciona uma aba existente pelo seu ID
  const handleSelectTab = useCallback(
    async (tabId: string) => {
      const targetTab = tabs.find((t) => t.id === tabId);
      if (!targetTab) return;

      if (targetTab.type === 'pdf') {
        const noteIdsToFlush = new Set([activeNoteId, leftNoteId, rightNoteId].filter(Boolean) as string[]);
        await Promise.all(
          Array.from(noteIdsToFlush).map((id) =>
            flushNoteSaves(id).catch((error) =>
              console.warn('[MainLayout] Falha ao finalizar nota antes de abrir PDF:', error)
            )
          )
        );
        setIsSplit(false);
        setLeftNoteId(null);
        setRightNoteId(null);
        setActiveTabId(tabId);
        setActiveNoteId(null);
        setIsNewNoteJustCreated(false);
        return;
      }

      if (isSplit) {
        if (targetTab.noteId === leftNoteId) {
          setActiveSplitPane('left');
          setActiveTabId(tabId);
          setActiveNoteId(leftNoteId);
          return;
        }
        if (targetTab.noteId === rightNoteId) {
          setActiveSplitPane('right');
          setActiveTabId(tabId);
          setActiveNoteId(rightNoteId);
          return;
        }

        // Abre na partição ativa
        if (activeSplitPane === 'right') {
          setRightNoteId(targetTab.noteId);
        } else {
          setLeftNoteId(targetTab.noteId);
        }
        setActiveTabId(tabId);
        setActiveNoteId(targetTab.noteId);
      } else {
        if (targetTab.id === activeTabId) return;

        if (activeNoteId && activeNoteId !== targetTab.noteId) {
          await flushNoteSaves(activeNoteId);
        }

        setActiveTabId(tabId);
        setActiveNoteId(targetTab.noteId);
      }

      const targetNote = notes.find((n) => n.id === targetTab.noteId);
      if (targetNote && targetNote.content === undefined) {
        const { content, tags } = await fetchNoteContent(userId, targetNote);
        setNotes((prev) =>
          prev.map((n) =>
            n.id === targetTab.noteId
              ? {
                  ...n,
                  content: content !== undefined ? content : n.content,
                  tags: tags && tags.length > 0 ? tags : n.tags,
                }
              : n
          )
        );
      }
    },
    [tabs, isSplit, leftNoteId, rightNoteId, activeSplitPane, activeTabId, activeNoteId, notes, userId]
  );

  // Divide a tela verticalmente entre a nota ativa e a aba selecionada
  const handleSplitTab = useCallback(
    async (clickedTabId: string) => {
      if (tabs.length < 2) return;

      const currentActiveTab = tabs.find((t) => t.id === activeTabId);
      const clickedTab = tabs.find((t) => t.id === clickedTabId);
      if (!clickedTab || clickedTab.type === 'pdf') return;

      // A nota que estava aberta/ativa antes da ação deve ficar no PAINEL ESQUERDO.
      // A aba sobre a qual cliquei com botão direito deve ficar no PAINEL DIREITO.
      let leftId = currentActiveTab && currentActiveTab.type !== 'pdf'
        ? currentActiveTab.noteId
        : activeNoteId || tabs.find((tab) => tab.type !== 'pdf' && tab.id !== clickedTabId)?.noteId || null;
      let rightId = clickedTab.noteId;

      if (leftId === rightId) {
        const otherTab = tabs.find((t) => t.id !== clickedTabId && t.type !== 'pdf');
        if (otherTab) {
          rightId = otherTab.noteId;
        } else {
          return;
        }
      }

      if (!leftId || !rightId) return;

      // Garante que o conteúdo de ambas as notas esteja baixado do Storage
      const rightNote = notes.find((n) => n.id === rightId);
      if (rightNote && rightNote.content === undefined) {
        const { content, tags } = await fetchNoteContent(userId, rightNote);
        setNotes((prev) =>
          prev.map((n) =>
            n.id === rightId
              ? {
                  ...n,
                  content: content !== undefined ? content : n.content,
                  tags: tags && tags.length > 0 ? tags : n.tags,
                }
              : n
          )
        );
      }

      const leftNote = notes.find((n) => n.id === leftId);
      if (leftNote && leftNote.content === undefined) {
        const { content, tags } = await fetchNoteContent(userId, leftNote);
        setNotes((prev) =>
          prev.map((n) =>
            n.id === leftId
              ? {
                  ...n,
                  content: content !== undefined ? content : n.content,
                  tags: tags && tags.length > 0 ? tags : n.tags,
                }
              : n
          )
        );
      }

      setLeftNoteId(leftId);
      setRightNoteId(rightId);
      setIsSplit(true);
      setActiveSplitPane('left');
    },
    [tabs, activeTabId, activeNoteId, notes, userId]
  );

  // Desagrupa a tela e retorna a painel único com a nota do painel/aba clicado
  const handleUnsplitTab = useCallback(
    (clickedTabId?: string) => {
      let targetNoteId: string | null = null;
      let targetTabId: string | null = null;

      if (clickedTabId) {
        const clickedTab = tabs.find((t) => t.id === clickedTabId);
        if (clickedTab && clickedTab.type !== 'pdf') {
          targetNoteId = clickedTab.noteId;
          targetTabId = clickedTab.id;
        }
      }

      if (!targetNoteId) {
        targetNoteId = activeSplitPane === 'right' ? rightNoteId : leftNoteId;
        if (!targetNoteId) targetNoteId = leftNoteId || rightNoteId;
        const tab = tabs.find((t) => t.noteId === targetNoteId);
        if (tab) targetTabId = tab.id;
      }

      setIsSplit(false);
      setLeftNoteId(null);
      setRightNoteId(null);

      if (targetNoteId) {
        setActiveNoteId(targetNoteId);
      }
      if (targetTabId) {
        setActiveTabId(targetTabId);
      }
    },
    [tabs, activeSplitPane, rightNoteId, leftNoteId]
  );

  // Troca a posição das notas na tela dividida: ESQUERDA <-> DIREITA imediatamente
  const handleSwapSplitPanes = useCallback(() => {
    if (!isSplit || !leftNoteId || !rightNoteId) return;
    const prevLeft = leftNoteId;
    const prevRight = rightNoteId;
    setLeftNoteId(prevRight);
    setRightNoteId(prevLeft);
    const newActiveId = activeSplitPane === 'left' ? prevRight : prevLeft;
    setActiveNoteId(newActiveId);
    const newTab = tabs.find((t) => t.noteId === newActiveId);
    if (newTab) {
      setActiveTabId(newTab.id);
    }
  }, [isSplit, leftNoteId, rightNoteId, activeSplitPane, tabs]);

  // Divide a tela a partir do menu contextual da nota na Sidebar
  const handleSplitFromSidebar = useCallback(
    async (targetNoteId: string) => {
      const targetNote = notes.find((n) => n.id === targetNoteId);
      if (!targetNote) return;

      // A nota que está atualmente aberta/ativa permanece no PAINEL ESQUERDO
      let leftId = activeNoteId;
      if (!leftId || leftId === targetNoteId) {
        leftId = isSplit && leftNoteId && leftNoteId !== targetNoteId ? leftNoteId : null;
      }
      if (!leftId || leftId === targetNoteId) {
        const otherTab = tabs.find((t) => t.type !== 'pdf' && t.noteId !== targetNoteId);
        if (otherTab) {
          leftId = otherTab.noteId;
        } else {
          const otherNote = notes.find((n) => n.id !== targetNoteId);
          if (otherNote) {
            leftId = otherNote.id;
          } else {
            handleSelectNote(targetNoteId);
            return;
          }
        }
      }

      const rightId = targetNoteId;

      // Garante que ambas as notas estejam abertas nas abas
      setTabs((prevTabs) => {
        const nextTabs = [...prevTabs];
        if (!nextTabs.some((t) => t.noteId === leftId)) {
          nextTabs.push({ id: `tab-${leftId}`, noteId: leftId });
        }
        if (!nextTabs.some((t) => t.noteId === rightId)) {
          nextTabs.push({ id: `tab-${rightId}`, noteId: rightId });
        }
        return nextTabs;
      });

      // Baixa o conteúdo caso ainda não carregado
      const leftNoteObj = notes.find((n) => n.id === leftId);
      if (leftNoteObj && leftNoteObj.content === undefined) {
        const { content, tags } = await fetchNoteContent(userId, leftNoteObj);
        setNotes((prev) =>
          prev.map((n) =>
            n.id === leftId
              ? {
                  ...n,
                  content: content !== undefined ? content : n.content,
                  tags: tags && tags.length > 0 ? tags : n.tags,
                }
              : n
          )
        );
      }

      if (targetNote.content === undefined) {
        const { content, tags } = await fetchNoteContent(userId, targetNote);
        setNotes((prev) =>
          prev.map((n) =>
            n.id === rightId
              ? {
                  ...n,
                  content: content !== undefined ? content : n.content,
                  tags: tags && tags.length > 0 ? tags : n.tags,
                }
              : n
          )
        );
      }

      setLeftNoteId(leftId);
      setRightNoteId(rightId);
      setIsSplit(true);
      setActiveSplitPane('left');
      setActiveNoteId(leftId);
      const leftTabObj = tabs.find((t) => t.noteId === leftId);
      if (leftTabObj) {
        setActiveTabId(leftTabObj.id);
      } else {
        setActiveTabId(`tab-${leftId}`);
      }
    },
    [isSplit, leftNoteId, activeNoteId, notes, tabs, userId, handleSelectNote]
  );

  // Fecha uma aba pelo seu ID e ativa outra disponível automaticamente
  const handleCloseTab = useCallback(
    async (tabIdToClose: string) => {
      const tabIndex = tabs.findIndex((t) => t.id === tabIdToClose);
      if (tabIndex === -1) return;

      const closingTab = tabs[tabIndex];
      const closingNoteId = closingTab.type === 'pdf' ? null : closingTab.noteId;
      const remainingTabs = tabs.filter((t) => t.id !== tabIdToClose);

      if (closingNoteId) {
        await flushNoteSaves(closingNoteId);
      }

      // Ao fechar uma das notas divididas, reorganizar automaticamente o layout para não deixar um painel vazio.
      if (isSplit) {
        if (closingNoteId === leftNoteId) {
          setIsSplit(false);
          setLeftNoteId(null);
          setRightNoteId(null);
          setTabs(remainingTabs);

          if (rightNoteId && remainingTabs.some((t) => t.noteId === rightNoteId)) {
            setActiveNoteId(rightNoteId);
            const rTab = remainingTabs.find((t) => t.noteId === rightNoteId);
            if (rTab) setActiveTabId(rTab.id);
          } else if (remainingTabs.length > 0) {
            const nextTab = remainingTabs[0];
            setActiveTabId(nextTab.id);
            if (nextTab.type === 'pdf') {
              if (activeNoteId === closingNoteId) setActiveNoteId(null);
            } else {
              setActiveNoteId(nextTab.noteId);
            }
          } else {
            setActiveNoteId(null);
            setActiveTabId(null);
          }
          return;
        }

        if (closingNoteId === rightNoteId) {
          setIsSplit(false);
          setLeftNoteId(null);
          setRightNoteId(null);
          setTabs(remainingTabs);

          if (leftNoteId && remainingTabs.some((t) => t.noteId === leftNoteId)) {
            setActiveNoteId(leftNoteId);
            const lTab = remainingTabs.find((t) => t.noteId === leftNoteId);
            if (lTab) setActiveTabId(lTab.id);
          } else if (remainingTabs.length > 0) {
            const nextTab = remainingTabs[0];
            setActiveTabId(nextTab.id);
            if (nextTab.type === 'pdf') {
              if (activeNoteId === closingNoteId) setActiveNoteId(null);
            } else {
              setActiveNoteId(nextTab.noteId);
            }
          } else {
            setActiveNoteId(null);
            setActiveTabId(null);
          }
          return;
        }

        setTabs(remainingTabs);
        return;
      }

      if (activeTabId === tabIdToClose) {
        if (remainingTabs.length > 0) {
          const nextIndex = Math.min(tabIndex, remainingTabs.length - 1);
          const nextTab = remainingTabs[nextIndex];
          setTabs(remainingTabs);
          setActiveTabId(nextTab.id);
          if (nextTab.type === 'pdf') {
            if (activeNoteId === closingNoteId) setActiveNoteId(null);
          } else {
            setActiveNoteId(nextTab.noteId);
          }

          const targetNote = nextTab.type === 'pdf'
            ? null
            : notes.find((n) => n.id === nextTab.noteId);
          if (targetNote && targetNote.content === undefined) {
            const { content, tags } = await fetchNoteContent(userId, targetNote);
            setNotes((prev) =>
              prev.map((n) =>
                n.id === nextTab.noteId
                  ? {
                      ...n,
                      content: content !== undefined ? content : n.content,
                      tags: tags && tags.length > 0 ? tags : n.tags,
                    }
                  : n
              )
            );
          }
        } else {
          setTabs([]);
          setActiveTabId(null);
          setActiveNoteId(null);
        }
      } else {
        setTabs(remainingTabs);
      }
    },
    [tabs, isSplit, leftNoteId, rightNoteId, activeTabId, activeNoteId, notes, userId]
  );

  const handleSelectPdf = useCallback(
    async (pdfId: string, openInNewTab = false) => {
      const targetPdf = libraryPdfs.find((p) => p.id === pdfId);
      if (!targetPdf) return;
      await handleOpenPdfTab({
        attachmentId: targetPdf.id,
        fileName: targetPdf.file_name,
        sourceUrl: (targetPdf as any).public_url || (targetPdf as any).remote_url || undefined,
      });
    },
    [libraryPdfs, handleOpenPdfTab]
  );

  const handleAddIndependentPdf = useCallback(
    async (file: File, folderId: string | null) => {
      try {
        const newPdf = await createLibraryPdf(userId, file, folderId);
        setLibraryPdfs((prev) => [newPdf, ...prev]);
        await handleOpenPdfTab({
          attachmentId: newPdf.id,
          fileName: newPdf.file_name,
          sourceUrl: (newPdf as any).public_url || (newPdf as any).remote_url || undefined,
        });
      } catch (err) {
        console.error('[MainLayout] Erro ao criar PDF na biblioteca:', err);
      }
    },
    [userId, handleOpenPdfTab]
  );

  const handleAttachPdfToNote = useCallback(
    async (file: File, noteId: string) => {
      try {
        await attachPdfToNote(userId, noteId, file);
        const updated = await indexedDBStorage.getNoteById(userId, noteId);
        if (updated) {
          setNotes((prev) =>
            prev.map((n) =>
              n.id === noteId ? { ...n, content: updated.content, updated_at: updated.updated_at } : n
            )
          );
        }
        handleSelectNote(noteId, false);
      } catch (err) {
        console.error('[MainLayout] Erro ao anexar PDF à nota:', err);
      }
    },
    [userId, handleSelectNote]
  );

  const handleRenamePdf = useCallback(
    async (pdfId: string, newTitle: string) => {
      setLibraryPdfs((prev) =>
        prev.map((p) => (p.id === pdfId ? { ...p, file_name: newTitle } : p))
      );
      setTabs((prev) =>
        prev.map((t) => (t.type === 'pdf' && t.attachmentId === pdfId ? { ...t, title: newTitle } : t))
      );
      await renameLibraryPdf(userId, pdfId, newTitle);
    },
    [userId]
  );

  const handleDeletePdf = useCallback(
    async (pdfId: string) => {
      const pdfTab = tabs.find((t) => t.type === 'pdf' && t.attachmentId === pdfId);
      if (pdfTab) {
        await handleCloseTab(pdfTab.id);
      }
      setLibraryPdfs((prev) => prev.filter((p) => p.id !== pdfId));
      await deleteLibraryPdf(userId, pdfId);
    },
    [userId, tabs, handleCloseTab]
  );

  const handleMovePdf = useCallback(
    async (pdfId: string, targetFolderId: string | null, targetPosition: number) => {
      setLibraryPdfs((prev) =>
        prev.map((p) =>
          p.id === pdfId ? { ...p, folder_id: targetFolderId, position: targetPosition } : p
        )
      );
      await moveLibraryPdf(userId, pdfId, targetFolderId, targetPosition);
    },
    [userId]
  );

  useEffect(() => {
    const handleOpenPdfEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ attachmentId?: string; fileName?: string; sourceUrl?: string }>;
      void handleOpenPdfTab(customEvent.detail || {});
    };

    window.addEventListener('anotado:open-pdf', handleOpenPdfEvent);
    return () => window.removeEventListener('anotado:open-pdf', handleOpenPdfEvent);
  }, [handleOpenPdfTab]);

  // Ouvinte global para abertura de notas a partir de modais e navegações internas
  useEffect(() => {
    const handleGlobalOpenNote = (e: Event) => {
      const customEvent = e as CustomEvent<{ noteId?: string; folderId?: string | null; workspace?: string }>;
      if (customEvent.detail?.noteId) {
        if (customEvent.detail.workspace && customEvent.detail.workspace !== 'notes') {
          return;
        }
        if (customEvent.detail.folderId !== undefined) {
          setActiveFolderId(customEvent.detail.folderId);
        }
        handleSelectNote(customEvent.detail.noteId);
        setMobileSidebarOpen(false);
      }
    };

    window.addEventListener('anotado:open-note', handleGlobalOpenNote);
    window.addEventListener('anotado:select-active-note', handleGlobalOpenNote);
    return () => {
      window.removeEventListener('anotado:open-note', handleGlobalOpenNote);
      window.removeEventListener('anotado:select-active-note', handleGlobalOpenNote);
    };
  }, [handleSelectNote]);

  // Nota ativa selecionada atualmente
  const activeNote = useMemo(() => {
    return notes.find((n) => n.id === activeNoteId) || null;
  }, [notes, activeNoteId]);

  // Filtros de isolamento por espaço (Notas vs Diário)
  const handleToggleWorkspace = useCallback(() => {
    flushAllPendingSaves();
    router.push('/diary');
  }, [router]);

  // Handlers de Pastas
  const handleCreateFolder = useCallback(async (parentId: string | null = null) => {
    const position = folders.filter((f) => f.parent_id === (parentId || null)).length;
    const newFolder = await createFolder(userId, {
      name: 'Nova pasta',
      parentId: parentId || null,
      position,
      workspaceType: 'notes',
    });

    setFolders((prev) => [...prev, newFolder]);
    return newFolder.id;
  }, [userId, folders]);

  const handleRenameFolder = useCallback(
    async (folderId: string, newName: string) => {
      setFolders((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, name: newName, updated_at: new Date().toISOString() } : f))
      );
      await renameFolder(userId, folderId, newName);
    },
    [userId]
  );

  const handleUpdateFolderColor = useCallback(
    async (folderId: string, color: string | null) => {
      setFolders((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, color, updated_at: new Date().toISOString() } : f))
      );
      await updateFolderColor(userId, folderId, color);
    },
    [userId]
  );

  const handleUpdateFolderSmartConfig = useCallback(
    async (folderId: string, isSmart: boolean, smartTags: string[]) => {
      setFolders((prev) =>
        prev.map((f) =>
          f.id === folderId
            ? { ...f, is_smart: isSmart, smart_tags: smartTags, updated_at: new Date().toISOString() }
            : f
        )
      );
      await updateFolderSmartConfig(userId, folderId, isSmart, smartTags);
    },
    [userId]
  );

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      const targetFolder = folders.find((f) => f.id === folderId);
      const isSmart = targetFolder?.is_smart;

      setFolders((prev) => prev.filter((f) => f.id !== folderId && f.parent_id !== folderId));
      // Se NÃO for pasta inteligente, exclui as notas contidas fisicamente
      if (!isSmart) {
        setNotes((prev) => prev.filter((n) => n.folder_id !== folderId));
      }

      // Se a nota ativa estava dentro da pasta física excluída, limpa a seleção
      if (!isSmart && activeNote && activeNote.folder_id === folderId) {
        setActiveNoteId(null);
      }
      if (activeFolderId === folderId) {
        setActiveFolderId(null);
      }

      await deleteFolder(userId, folderId);
    },
    [userId, activeNote, activeFolderId, folders]
  );

  // Handlers de Notas (com persistência em Markdown no Supabase Storage)
  const handleCreateNote = useCallback(async (folderId: string | null = null, openInNewTab: boolean = false) => {
    // Se folderId não for especificado, utiliza obrigatoriamente a pasta "Notas Rápidas"
    let targetFolderId = folderId;
    if (!targetFolderId) {
      const quickNotesFolder = folders.find(isQuickNotesFolder);
      if (quickNotesFolder) {
        targetFolderId = quickNotesFolder.id;
      } else {
        try {
          const createdQuickFolder = await ensureQuickNotesFolder(userId);
          targetFolderId = createdQuickFolder.id;
          setFolders((prev) => (prev.some((f) => f.id === createdQuickFolder.id) ? prev : [createdQuickFolder, ...prev]));
        } catch {
          targetFolderId = null;
        }
      }
    }

    const position = notes.filter((n) => n.folder_id === targetFolderId).length;

    const newNote = await createNote(userId, {
      title: 'Nova nota',
      folderId: targetFolderId,
      position,
      content: '',
      workspaceType: 'notes',
    });

    setNotes((prev) => [...prev, newNote]);
    setIsNewNoteJustCreated(true);
    setActiveNoteId(newNote.id);

    if (isSplit) {
      if (activeSplitPane === 'right') {
        setRightNoteId(newNote.id);
      } else {
        setLeftNoteId(newNote.id);
      }
    }

    // Se solicitado abrir em nova aba, se não existiam abas ou se um PDF está ativo,
    // cria uma aba de nota separada sem substituir o PDF.
    const activeTabIsPdf = tabs.some((tab) => tab.id === activeTabId && tab.type === 'pdf');
    if (openInNewTab || tabs.length === 0 || activeTabIsPdf) {
      const newTabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setTabs((prev) => [...prev, { id: newTabId, noteId: newNote.id }]);
      setActiveTabId(newTabId);
    } else {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, noteId: newNote.id } : t))
      );
    }

    return newNote.id;
  }, [userId, notes, folders, tabs.length, activeTabId, isSplit, activeSplitPane]);

  // Cria uma nova aba via botão +
  const handleNewTab = useCallback(async () => {
    if (activeNoteId) {
      await flushNoteSaves(activeNoteId);
    }
    await handleCreateNote(null, true);
  }, [activeNoteId, handleCreateNote]);

  const handleUpdateTitle = useCallback(
    async (noteId: string, newTitle: string) => {
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, title: newTitle, updated_at: new Date().toISOString() } : n))
      );
      await updateNoteTitle(userId, noteId, newTitle);
    },
    [userId]
  );

  const handleUpdateContent = useCallback(
    async (noteId: string, newContent: string) => {
      // 1. Atualização Otimista Imediata na Memória da UI
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId
            ? {
                ...n,
                content: newContent,
                updated_at: new Date().toISOString(),
              }
            : n
        )
      );

      // 2. Persistência Serializada em Background (IndexedDB + Supabase)
      const currentNote = notes.find((n) => n.id === noteId);
      const res = await updateNoteContent(userId, noteId, newContent, currentNote?.tags);
      if (res && res.tags) {
        setNotes((prev) =>
          prev.map((n) => (n.id === noteId ? { ...n, tags: res.tags } : n))
        );
      }
    },
    [userId, notes]
  );

  const handleUpdateNoteTags = useCallback(
    async (noteId: string, newTags: string[]) => {
      const currentNote = notes.find((n) => n.id === noteId);
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId ? { ...n, tags: newTags, updated_at: new Date().toISOString() } : n
        )
      );
      const res = await updateNoteTags(userId, noteId, newTags, currentNote?.content);
      if (res.success && res.tags) {
        setNotes((prev) =>
          prev.map((n) => (n.id === noteId ? { ...n, tags: res.tags } : n))
        );
      }
    },
    [userId, notes]
  );

  const handleDeleteNote = useCallback(
    async (noteId: string) => {
      // Fecha quaisquer abas associadas a esta nota excluída
      setTabs((prev) => {
        const remaining = prev.filter((t) => t.noteId !== noteId);
        if (remaining.length !== prev.length) {
          const closedTab = prev.find((t) => t.noteId === noteId);
          if (closedTab && closedTab.id === activeTabId) {
            if (remaining.length > 0) {
              const nextTab = remaining[remaining.length - 1];
              setActiveTabId(nextTab.id);
              setActiveNoteId(nextTab.type === 'pdf' ? null : nextTab.noteId);
            } else {
              setActiveTabId(null);
              setActiveNoteId(null);
            }
          }
        }
        return remaining;
      });

      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      if (activeNoteId === noteId) {
        setActiveNoteId(null);
      }
      await deleteNote(userId, noteId);
    },
    [userId, activeNoteId, activeTabId]
  );

  const handleArchiveNote = useCallback(
    async (noteId: string) => {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId
            ? {
                ...n,
                is_archived: true,
                previous_folder_id: n.folder_id,
                folder_id: null,
                updated_at: new Date().toISOString(),
              }
            : n
        )
      );
      await archiveNote(userId, noteId);
    },
    [userId]
  );

  const handleUnarchiveNote = useCallback(
    async (noteId: string) => {
      const targetNote = notes.find((n) => n.id === noteId);
      const prevFolderId = targetNote?.previous_folder_id ?? null;
      const folderStillExists = prevFolderId ? folders.some((f) => f.id === prevFolderId) : false;
      const destinationFolderId = folderStillExists ? prevFolderId : null;

      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId
            ? {
                ...n,
                is_archived: false,
                folder_id: destinationFolderId,
                previous_folder_id: null,
                updated_at: new Date().toISOString(),
              }
            : n
        )
      );
      await unarchiveNote(userId, noteId, folders);
    },
    [userId, notes, folders]
  );

  const handleArchiveFolderNotes = useCallback(
    async (folderId: string) => {
      const folderIdsToArchive = new Set<string>([folderId]);
      let added = true;
      while (added) {
        added = false;
        for (const folder of folders) {
          if (folder.parent_id && folderIdsToArchive.has(folder.parent_id) && !folderIdsToArchive.has(folder.id)) {
            folderIdsToArchive.add(folder.id);
            added = true;
          }
        }
      }

      setNotes((prev) =>
        prev.map((n) => {
          if (n.folder_id && folderIdsToArchive.has(n.folder_id) && !n.is_archived) {
            return {
              ...n,
              is_archived: true,
              previous_folder_id: n.folder_id,
              folder_id: null,
              updated_at: new Date().toISOString(),
            };
          }
          return n;
        })
      );

      await archiveFolderNotes(userId, folderId, folders);
    },
    [userId, folders]
  );

  const handleToggleFavoriteNote = useCallback(
    async (noteId: string) => {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId
            ? {
                ...n,
                is_favorite: !n.is_favorite,
                updated_at: new Date().toISOString(),
              }
            : n
        )
      );
      await toggleNoteFavorite(userId, noteId);
    },
    [userId]
  );

  const handleMoveItem = useCallback(
    async (
      itemType: 'folder' | 'note' | 'pdf',
      itemId: string,
      targetFolderId: string | null,
      targetPosition: number
    ) => {
      if (itemType === 'pdf') {
        await handleMovePdf(itemId, targetFolderId, targetPosition);
        return;
      }

      if (itemType === 'folder') {
        setFolders((prev) =>
          prev.map((f) =>
            f.id === itemId
              ? { ...f, parent_id: targetFolderId, position: targetPosition, updated_at: new Date().toISOString() }
              : f
          )
        );
      } else {
        setNotes((prev) =>
          prev.map((n) =>
            n.id === itemId
              ? { ...n, folder_id: targetFolderId, position: targetPosition, updated_at: new Date().toISOString() }
              : n
          )
        );
      }

      await moveItem(userId, itemType, itemId, targetFolderId, targetPosition);
    },
    [userId, handleMovePdf]
  );

  const handleReorderItem = useCallback(
    async (
      itemType: 'folder' | 'note' | 'pdf',
      itemId: string,
      targetId: string | null,
      targetParentId: string | null,
      dropPosition: 'before' | 'after' | 'inside'
    ) => {
      if (itemType === 'pdf') {
        await handleMovePdf(itemId, targetParentId, 0);
        return;
      }

      if (itemType === 'note') {
        setNotes((prevNotes) => {
          const draggedNote = prevNotes.find((n) => n.id === itemId);
          if (!draggedNote) return prevNotes;

          // Filtra todas as notas irmãs do container de destino (excluindo a nota arrastada)
          const targetSiblings = prevNotes
            .filter(
              (n) =>
                n.id !== itemId &&
                !n.is_archived &&
                (targetParentId === null ? n.folder_id === null : n.folder_id === targetParentId)
            )
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.created_at.localeCompare(b.created_at));

          let newOrderedList: typeof targetSiblings;

          if (dropPosition === 'inside' || !targetId) {
            newOrderedList = [...targetSiblings, { ...draggedNote, folder_id: targetParentId }];
          } else {
            const targetIndex = targetSiblings.findIndex((n) => n.id === targetId);
            if (targetIndex === -1) {
              newOrderedList = [...targetSiblings, { ...draggedNote, folder_id: targetParentId }];
            } else {
              const insertIndex = dropPosition === 'before' ? targetIndex : targetIndex + 1;
              newOrderedList = [
                ...targetSiblings.slice(0, insertIndex),
                { ...draggedNote, folder_id: targetParentId },
                ...targetSiblings.slice(insertIndex),
              ];
            }
          }

          // Atribui posições estritamente sequenciais 0, 1, 2, 3...
          const updatesMap = new Map<string, { folder_id: string | null; position: number }>();
          newOrderedList.forEach((n, idx) => {
            updatesMap.set(n.id, { folder_id: targetParentId, position: idx });
          });

          // Se a nota veio de outra pasta, reordena as notas restantes na pasta de origem
          if (draggedNote.folder_id !== targetParentId && draggedNote.folder_id !== undefined) {
            const sourceFolderId = draggedNote.folder_id;
            const sourceSiblings = prevNotes
              .filter(
                (n) =>
                  n.id !== itemId &&
                  !n.is_archived &&
                  (sourceFolderId === null ? n.folder_id === null : n.folder_id === sourceFolderId)
              )
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.created_at.localeCompare(b.created_at));

            sourceSiblings.forEach((n, idx) => {
              updatesMap.set(n.id, { folder_id: sourceFolderId, position: idx });
            });
          }

          const updatesArray = Array.from(updatesMap.entries()).map(([id, val]) => ({
            id,
            folder_id: val.folder_id,
            position: val.position,
          }));

          reorderNotesBatch(userId, updatesArray).catch((err) => {
            console.error('[REORDER-NOTES] Erro ao persistir nova ordem de notas:', err);
          });

          return prevNotes.map((n) => {
            const u = updatesMap.get(n.id);
            if (u) {
              return { ...n, folder_id: u.folder_id, position: u.position, updated_at: new Date().toISOString() };
            }
            return n;
          });
        });
      } else {
        // Reordenação de pastas
        setFolders((prevFolders) => {
          const draggedFolder = prevFolders.find((f) => f.id === itemId);
          if (!draggedFolder) return prevFolders;

          const targetSiblings = prevFolders
            .filter(
              (f) =>
                f.id !== itemId &&
                (targetParentId === null ? f.parent_id === null : f.parent_id === targetParentId)
            )
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.created_at.localeCompare(b.created_at));

          let newOrderedList: typeof targetSiblings;

          if (dropPosition === 'inside' || !targetId) {
            newOrderedList = [...targetSiblings, { ...draggedFolder, parent_id: targetParentId }];
          } else {
            const targetIndex = targetSiblings.findIndex((f) => f.id === targetId);
            if (targetIndex === -1) {
              newOrderedList = [...targetSiblings, { ...draggedFolder, parent_id: targetParentId }];
            } else {
              const insertIndex = dropPosition === 'before' ? targetIndex : targetIndex + 1;
              newOrderedList = [
                ...targetSiblings.slice(0, insertIndex),
                { ...draggedFolder, parent_id: targetParentId },
                ...targetSiblings.slice(insertIndex),
              ];
            }
          }

          const updatesMap = new Map<string, { parent_id: string | null; position: number }>();
          newOrderedList.forEach((f, idx) => {
            updatesMap.set(f.id, { parent_id: targetParentId, position: idx });
          });

          updatesMap.forEach((val, fId) => {
            moveItem(userId, 'folder', fId, val.parent_id, val.position).catch(console.error);
          });

          return prevFolders.map((f) => {
            const u = updatesMap.get(f.id);
            if (u) {
              return { ...f, parent_id: u.parent_id, position: u.position, updated_at: new Date().toISOString() };
            }
            return f;
          });
        });
      }
    },
    [userId, handleMovePdf]
  );

  const activePdfTab = tabs.find((tab) => tab.id === activeTabId && tab.type === 'pdf') || null;
  const activePdfAttachmentId = activePdfTab?.attachmentId || null;

  const splitLeftNote = isSplit && leftNoteId ? notes.find((n) => n.id === leftNoteId) || null : null;
  const splitRightNote = isSplit && rightNoteId ? notes.find((n) => n.id === rightNoteId) || null : null;
  const splitLeftTab = isSplit && leftNoteId ? tabs.find((t) => t.noteId === leftNoteId) || null : null;
  const splitRightTab = isSplit && rightNoteId ? tabs.find((t) => t.noteId === rightNoteId) || null : null;

  return (
    <div
      id="main-app-container"
      className="flex flex-col h-screen w-screen overflow-hidden bg-[#fbf9f4] font-sans-ui"
    >
      {/* Workspace Area: Sidebar + Canvas */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Desktop Sidebar */}
        <div className="hidden md:flex shrink-0 h-full">
          <SidebarNavigation
            folders={folders}
            notes={notes}
            libraryPdfs={libraryPdfs}
            activeNoteId={activeNoteId}
            activeFolderId={activeFolderId}
            activePdfId={activePdfAttachmentId}
            onSelectNote={handleSelectNote}
            onSelectFolder={(id) => setActiveFolderId(id)}
            onSelectPdf={handleSelectPdf}
            onCreateFolder={handleCreateFolder}
            onCreateNote={handleCreateNote}
            onRenameFolder={handleRenameFolder}
            onRenameNote={handleUpdateTitle}
            onRenamePdf={handleRenamePdf}
            onDeleteFolder={handleDeleteFolder}
            onDeleteNote={handleDeleteNote}
            onDeletePdf={handleDeletePdf}
            onArchiveNote={handleArchiveNote}
            onUnarchiveNote={handleUnarchiveNote}
            onToggleFavoriteNote={handleToggleFavoriteNote}
            onArchiveFolderNotes={handleArchiveFolderNotes}
            onUpdateFolderColor={handleUpdateFolderColor}
            onUpdateFolderSmartConfig={handleUpdateFolderSmartConfig}
            onSplitNote={handleSplitFromSidebar}
            onOpenNoteInNewTab={handleOpenNoteInNewTab}
            onMoveItem={handleMoveItem}
            onReorderItem={handleReorderItem}
            onMovePdf={handleMovePdf}
            onAddIndependentPdf={handleAddIndependentPdf}
            onAttachPdfToNote={handleAttachPdfToNote}
            currentWorkspace="notes"
            onToggleWorkspace={handleToggleWorkspace}
          />
        </div>

        {/* Mobile Drawer Sidebar */}
        {mobileSidebarOpen && (
          <div
            id="mobile-sidebar-drawer"
            className="fixed inset-0 z-50 flex md:hidden"
          >
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
              onClick={() => setMobileSidebarOpen(false)}
            />

            {/* Slide-in Content */}
            <div className="relative w-[280px] max-w-[80vw] h-full z-10 shadow-2xl">
              <SidebarNavigation
                folders={folders}
                notes={notes}
                libraryPdfs={libraryPdfs}
                activeNoteId={activeNoteId}
                activeFolderId={activeFolderId}
                activePdfId={activePdfAttachmentId}
                onSelectNote={(id, openInNewTab) => {
                  handleSelectNote(id, openInNewTab);
                  setMobileSidebarOpen(false);
                }}
                onSelectFolder={(id) => setActiveFolderId(id)}
                onSelectPdf={(id, openInNewTab) => {
                  handleSelectPdf(id, openInNewTab);
                  setMobileSidebarOpen(false);
                }}
                onCreateFolder={handleCreateFolder}
                onCreateNote={handleCreateNote}
                onRenameFolder={handleRenameFolder}
                onRenameNote={handleUpdateTitle}
                onRenamePdf={handleRenamePdf}
                onDeleteFolder={handleDeleteFolder}
                onDeleteNote={handleDeleteNote}
                onDeletePdf={handleDeletePdf}
                onArchiveNote={handleArchiveNote}
                onUnarchiveNote={handleUnarchiveNote}
                onToggleFavoriteNote={handleToggleFavoriteNote}
                onArchiveFolderNotes={handleArchiveFolderNotes}
                onUpdateFolderColor={handleUpdateFolderColor}
                onUpdateFolderSmartConfig={handleUpdateFolderSmartConfig}
                onSplitNote={(id) => {
                  handleSplitFromSidebar(id);
                  setMobileSidebarOpen(false);
                }}
                onMoveItem={handleMoveItem}
                onReorderItem={handleReorderItem}
                onMovePdf={handleMovePdf}
                onAddIndependentPdf={handleAddIndependentPdf}
                onAttachPdfToNote={handleAttachPdfToNote}
                onOpenNoteInNewTab={handleOpenNoteInNewTab}
                onCloseMobile={() => setMobileSidebarOpen(false)}
                currentWorkspace="notes"
                onToggleWorkspace={handleToggleWorkspace}
              />
            </div>
          </div>
        )}

        {/* Main Note Canvas */}
        <NoteCanvas
          key={isSplit ? `split-${leftNoteId}-${rightNoteId}` : activeNote?.id || 'empty'}
          activeNote={activeNote}
          activePdfAttachmentId={activePdfAttachmentId}
          activePdfTabId={activePdfTab?.id || null}
          activePdfSourceUrl={activePdfTab?.sourceUrl || null}
          userId={userId}
          onUpdateTitle={(noteId, newTitle) => handleUpdateTitle(noteId, newTitle)}
          onUpdateContent={(noteId, newContent) => handleUpdateContent(noteId, newContent)}
          onUpdateTags={(noteId, newTags) => handleUpdateNoteTags(noteId, newTags)}
          onDeleteNote={(noteId) => handleDeleteNote(noteId)}
          onCreateNewNote={() => handleCreateNote()}
          onOpenMobileMenu={() => setMobileSidebarOpen(true)}
          isNewNoteJustCreated={isNewNoteJustCreated}
          currentWorkspace="notes"
          onSelectNote={handleSelectNote}
          tabs={tabs}
          activeTabId={activeTabId}
          notes={notes}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onNewTab={handleNewTab}
          isSplit={isSplit}
          splitLeftTabId={splitLeftTab?.id}
          splitRightTabId={splitRightTab?.id}
          splitLeftNote={splitLeftNote}
          splitRightNote={splitRightNote}
          activeSplitPane={activeSplitPane}
          onFocusSplitPane={setActiveSplitPane}
          onSplitTab={handleSplitTab}
          onUnsplitTab={handleUnsplitTab}
          onSwapSplitPanes={handleSwapSplitPanes}
        />
      </div>
    </div>
  );
}

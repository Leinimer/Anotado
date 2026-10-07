'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrainCircuit, CalendarDays, FileText, Moon, Sun } from 'lucide-react';
import { KnowledgeMap } from '@/src/features/knowledge/ui/KnowledgeMap';
import { createClient } from '@/src/features/auth/api/supabase-client';
import { fetchFoldersAndNotes } from '@/src/features/notes/api/notes-api';
import { Folder, Note } from '@/src/features/notes/types';
import { syncEngine } from '@/src/features/notes/api/sync-engine';
import { ThemeToggle } from '@/src/features/theme/ThemeToggle';

export default function KnowledgeMapPage() {
  const router = useRouter();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const supabase = createClient();
        let uid = 'demo-user';

        try {
          const { data } = await supabase.auth.getSession();
          if (data?.session?.user?.id) uid = data.session.user.id;
        } catch {}

        if (!mounted) return;
        setUserId(uid);
        syncEngine.setActiveUser(uid);

        const data = await fetchFoldersAndNotes(uid);
        if (!mounted) return;
        setFolders(data.folders);
        setNotes(data.notes);
      } catch (error) {
        console.error('[KnowledgeMap] Erro ao carregar base:', error);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const openNote = (noteId: string, workspace: 'notes' | 'diary' = 'notes') => {
    router.push(workspace === 'diary' ? '/diary' : '/notes');
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('anotado:open-note', {
          detail: { noteId, workspace },
        })
      );
    }, 300);
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#fbf9f4] dark:bg-[#000] text-sm text-[#7f756e]">
        Carregando seu mapa de conhecimento…
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[#fbf9f4] dark:bg-[#000]">
      <aside className="hidden md:flex w-24 shrink-0 border-r border-[#eae8e3] dark:border-[#1a1a1a] bg-[#fbf9f4] dark:bg-[#050505] flex-col items-center py-4">
        <div className="flex flex-col items-center gap-1.5">
          <div className="w-9 h-9 rounded-xl bg-[#68594d] text-white flex items-center justify-center font-serif-note font-bold">
            A
          </div>
          <div className="font-serif-note font-bold text-sm">anotado!</div>
        </div>

        <div className="mt-6 flex flex-col gap-2 items-center">
          <button
            className="w-16 h-16 rounded-2xl bg-[#eae8e3] dark:bg-[#1a1a1a] flex flex-col items-center justify-center gap-1 text-[10px] font-semibold"
            title="Mapa completo"
          >
            <BrainCircuit className="w-5 h-5" />
            Mapa
          </button>

          <button
            onClick={() => router.push('/notes')}
            className="w-16 h-16 rounded-2xl hover:bg-[#f0eee9] dark:hover:bg-[#111] flex flex-col items-center justify-center gap-1 text-[10px] font-semibold text-[#7f756e] hover:text-[#1b1c19] dark:hover:text-white"
            title="Abrir Notas"
          >
            <FileText className="w-5 h-5" />
            Notas
          </button>

          <button
            onClick={() => router.push('/diary')}
            className="w-16 h-16 rounded-2xl hover:bg-[#f0eee9] dark:hover:bg-[#111] flex flex-col items-center justify-center gap-1 text-[10px] font-semibold text-[#7f756e] hover:text-[#1b1c19] dark:hover:text-white"
            title="Abrir Diário"
          >
            <CalendarDays className="w-5 h-5" />
            Diário
          </button>

          <div className="w-16 h-16 rounded-2xl flex items-center justify-center hover:bg-[#f0eee9] dark:hover:bg-[#111]">
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <KnowledgeMap
        notes={notes}
        folders={folders}
        userId={userId}
        onOpenNote={openNote}
        onBack={() => router.back()}
      />
    </div>
  );
}

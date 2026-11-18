'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, Check, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { getStickyColorTheme } from '../types';
import {
  StickyReminderAlert,
  acknowledgeStickyReminderAlert,
  deleteStickyReminderAlert,
  deleteReminderPopupStick,
  fetchUnacknowledgedStickyReminderAlerts,
  saveReminderPopupStick,
  triggerDueStickyReminderAlerts,
} from '../api/sticky-reminders-api';

interface ReminderContextValue {
  refresh: () => Promise<void>;
}
const ReminderContext = createContext<ReminderContextValue>({ refresh: async () => {} });
export const useStickyReminders = () => useContext(ReminderContext);

function getStick(alert: StickyReminderAlert): StickyReminderAlert['sticky_notes'] {
  const value = (alert as any).sticky_notes;
  return Array.isArray(value) ? (value[0] || null) : (value || null);
}

function formatDate(date: string): string {
  const value = new Date(date + 'T12:00:00');
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).format(value);
}

function offsetText(days: number): string {
  if (days === 0) return 'Na data escolhida';
  if (days === 1) return '1 dia antes';
  if (days === 2) return '2 dias antes';
  if (days === 3) return '3 dias antes';
  if (days === 5) return '5 dias antes';
  if (days === 7) return '1 semana antes';
  if (days === 14) return '2 semanas antes';
  if (days === 30) return '1 mês antes';
  return days + ' dias antes';
}

export function StickyReminderProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState('');
  const [alerts, setAlerts] = useState<StickyReminderAlert[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [actionError, setActionError] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const currentAlert = alerts[0] || null;
  const currentStick = currentAlert ? getStick(currentAlert) : null;

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const client = createClient();
    client.auth.getSession().then(({ data }) => setUserId(data.session?.user?.id || ''));
    const { data: { subscription } } = client.auth.onAuthStateChange((_event: string, session: any) => {
      setUserId(session?.user?.id || '');
    });
    return () => subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    if (!userId || !isSupabaseConfigured()) {
      setAlerts([]);
      return;
    }
    try {
      await triggerDueStickyReminderAlerts(userId);
      const next = await fetchUnacknowledgedStickyReminderAlerts(userId);
      setAlerts(next);
    } catch (error) {
      console.error('[StickyReminderProvider] Falha ao verificar alertas:', error);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setAlerts([]);
      return;
    }
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 15000);
    const handleFocus = () => { void refresh(); };
    const handleVisibility = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [userId, refresh]);

  useEffect(() => {
    if (!currentAlert || !currentStick) {
      setEditing(false);
      setActionError('');
      return;
    }
    setTitleDraft(currentStick.title || '');
    setEditing(false);
    setActionError('');
  }, [currentAlert?.id, currentStick?.id]);

  useEffect(() => {
    if (!currentAlert || !currentStick || !editorRef.current) return;
    editorRef.current.innerHTML = currentStick.content || '<p><br></p>';
  }, [currentAlert?.id, editing, currentStick?.content]);

  const runAction = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setActionError('');
    try {
      await action();
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Não foi possível concluir a ação.');
    } finally {
      setBusy(false);
    }
  };

  const acknowledge = () => currentAlert && runAction(() => acknowledgeStickyReminderAlert(userId, currentAlert.id));
  const removeAlert = () => currentAlert && runAction(() => deleteStickyReminderAlert(userId, currentAlert.id));
  const removeStick = () => currentAlert && currentStick && runAction(async () => {
    await deleteReminderPopupStick(userId, currentStick.id);
    window.dispatchEvent(new CustomEvent('anotado:sticky-note-deleted', { detail: { noteId: currentStick.id } }));
  });

  const saveEdit = async () => {
    if (!currentAlert || !currentStick) return;
    setSavingEdit(true);
    setActionError('');
    try {
      const updatedContent = editorRef.current?.innerHTML || '';
      await saveReminderPopupStick(userId, currentStick.id, {
        title: titleDraft,
        content: updatedContent,
      });
      window.dispatchEvent(new CustomEvent('anotado:sticky-note-updated', {
        detail: { noteId: currentStick.id, title: titleDraft, content: updatedContent },
      }));
      setEditing(false);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Não foi possível salvar o Stick.');
    } finally {
      setSavingEdit(false);
    }
  };

  const value = useMemo(() => ({ refresh }), [refresh]);
  const theme = currentStick ? getStickyColorTheme(currentStick.color) : getStickyColorTheme('yellow');
  const eventDate = currentAlert ? formatDate(currentAlert.target_date) : '';
  const eventTime = currentAlert ? String(currentAlert.target_time).slice(0, 5) : '';

  return <ReminderContext.Provider value={value}>
    {children}
    {currentAlert && currentStick && <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-[#211a15]/65 backdrop-blur-[3px] p-3 sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="sticky-global-reminder-title" className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl border border-[#e7d7c5] dark:border-[#554233] bg-[#fffdf9] dark:bg-[#1d1b19] shadow-[0_24px_90px_rgba(0,0,0,.35)]">
        <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
          <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f6e8d8] dark:bg-[#3e2b1f] text-[#8b5b37] dark:text-[#e6b98e]"><AlarmClock className="w-5 h-5"/></span><div><h2 id="sticky-global-reminder-title" className="text-sm font-bold tracking-wide text-[#503b2b] dark:text-[#f1dfce]">ALERTA DE LEMBRETE</h2><p className="mt-0.5 text-[11px] text-[#8e7b6b] dark:text-[#b7a495]">Este aviso foi programado para o seu Stick</p></div></div>
          <div className="text-right"><div className="text-[11px] text-[#9a8a7b] dark:text-[#a99b8e]">{alerts.length > 1 ? '1 de ' + alerts.length + ' alertas' : 'Lembrete'}</div><button type="button" onClick={acknowledge} disabled={busy} className="mt-1 rounded-md p-1.5 text-[#8c7b6d] hover:bg-[#f0e8df] dark:hover:bg-[#342a22]" aria-label="Fechar alerta"><X className="w-4 h-4"/></button></div>
        </header>
        <div className="px-5 pb-5 space-y-4">
          <div className={`rounded-2xl border shadow-[0_8px_22px_rgba(58,43,28,.13)] overflow-hidden ${theme.cardClass}`}>
            <div className={`flex items-center gap-2 border-b px-4 py-3 ${theme.headerClass}`}><AlarmClock className={`w-4 h-4 ${theme.textClass}`}/>{editing ? <input value={titleDraft} onChange={event=>setTitleDraft(event.target.value)} placeholder="Título do Stick" className={`w-full bg-transparent text-sm font-semibold outline-none ${theme.textClass}`}/> : <h3 className={`min-w-0 flex-1 text-sm font-semibold ${theme.textClass}`}>{currentStick.title || 'Stick sem título'}</h3>}</div>
            <div ref={editorRef} contentEditable={editing} suppressContentEditableWarning data-placeholder="Este Stick está vazio." className={`sticky-rich-editor min-h-[96px] max-h-[34vh] overflow-y-auto px-4 py-3 text-sm leading-relaxed outline-none ${theme.textClass} ${editing?'ring-1 ring-inset ring-[#a98b70]/35':''}`}/>
          </div>
          <div className="rounded-xl bg-[#f6f0e8] dark:bg-[#2c2621] px-4 py-3 text-center">
            <p className="text-sm font-semibold text-[#594432] dark:text-[#ead7c4]">{offsetText(currentAlert.offset_days)} de {eventDate}</p>
            <p className="mt-1 text-xs text-[#806f60] dark:text-[#b8a797]">Data marcada: {eventDate} · Horário: {eventTime}</p>
          </div>
          {actionError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{actionError}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {editing ? <><button type="button" onClick={()=>setEditing(false)} className="rounded-lg px-3 py-2 text-xs text-[#806f60] hover:bg-[#f2ece5] dark:hover:bg-[#302923]">Cancelar edição</button><button type="button" onClick={saveEdit} disabled={savingEdit} className="inline-flex items-center gap-2 rounded-lg bg-[#80634f] px-4 py-2 text-xs font-semibold text-white hover:bg-[#6c5343] disabled:opacity-50">{savingEdit&&<Loader2 className="w-3.5 h-3.5 animate-spin"/>}Salvar alterações</button></> : <><button type="button" onClick={()=>setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-[#735a45] hover:bg-[#f1e9e0] dark:text-[#d5b99f] dark:hover:bg-[#342a22]"><Pencil className="w-3.5 h-3.5"/>Editar Stick</button><span className="flex-1"/><button type="button" onClick={removeAlert} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-[#9a594c] hover:bg-[#faeae5] dark:text-[#e5a093] dark:hover:bg-[#3d2521]"><X className="w-3.5 h-3.5"/>Excluir alerta</button><button type="button" onClick={removeStick} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-[#402323]"><Trash2 className="w-3.5 h-3.5"/>Excluir Stick</button><button type="button" onClick={acknowledge} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#68594d] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#55473d] disabled:opacity-50"><Check className="w-4 h-4"/>OK</button></>}
          </div>
        </div>
      </section>
    </div>}
  </ReminderContext.Provider>;
}

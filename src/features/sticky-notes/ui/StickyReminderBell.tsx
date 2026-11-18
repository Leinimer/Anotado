'use client';

import React, { useEffect, useState } from 'react';
import { Bell, BellRing, Clock3, Loader2, Trash2 } from 'lucide-react';
import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import {
  clearStickyReminderHistory,
  fetchStickyReminderHistory,
  StickyReminderAlert,
} from '../api/sticky-reminders-api';
import { getAuthenticatedStickyUser } from '../api/sticky-notes-api';

function getStickTitle(alert: StickyReminderAlert): string {
  const value = (alert as any).sticky_notes;
  const note = Array.isArray(value) ? value[0] : value;
  return note?.title || 'Stick sem título';
}

function formatHistoryDate(value: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export function StickyReminderBell() {
  const [userId, setUserId] = useState('');
  const [history, setHistory] = useState<StickyReminderAlert[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const client = createClient();
    getAuthenticatedStickyUser().then(user => setUserId(user?.userId || '')).catch(() => setUserId(''));
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => setUserId(session?.user?.id || ''));
    return () => subscription.unsubscribe();
  }, []);

  const refresh = async () => {
    if (!userId) { setHistory([]); return; }
    setLoading(true);
    try {
      const rows = await fetchStickyReminderHistory(userId);
      setHistory(rows);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar o histórico.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 30000);
    return () => window.clearInterval(interval);
  }, [userId]);

  const handleClear = async () => {
    if (!userId || clearing) return;
    setClearing(true);
    setError('');
    try {
      await clearStickyReminderHistory(userId);
      setHistory([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível limpar o histórico.');
    } finally {
      setClearing(false);
    }
  };

  const openStick = (alert: StickyReminderAlert) => {
    sessionStorage.setItem('anotado_active_sticky_id', alert.sticky_note_id);
    window.location.href = '/sticky-notes';
  };

  return <div className="relative shrink-0">
    <button type="button" onClick={()=>{setOpen(value=>!value);if(!open)void refresh();}} title="Histórico de lembretes" aria-label="Histórico de lembretes" aria-expanded={open} className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${history.length?'text-[#c34435] hover:bg-[#f8e9e5] dark:text-[#ef8071] dark:hover:bg-[#3a2421]':'text-[#78685b] hover:bg-[#f0ece6] dark:text-[#b8a99c] dark:hover:bg-[#211d19]'}`}>
      {history.length ? <BellRing className="w-[17px] h-[17px]"/> : <Bell className="w-[17px] h-[17px]"/>}
      {history.length>0&&<span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#c34435] ring-1 ring-[#fbf9f4] dark:ring-black"/>}
    </button>
    {open&&<div className="absolute right-0 top-[calc(100%+9px)] z-[10900] flex max-h-[min(70vh,520px)] w-[min(350px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-[#e7ded4] bg-[#fffdf9] shadow-[0_16px_50px_rgba(30,20,12,.2)] dark:border-[#40372f] dark:bg-[#1d1b19]">
      <div className="flex items-center justify-between border-b border-[#eee7df] px-3.5 py-3 dark:border-[#39322c]"><div><p className="text-xs font-semibold text-[#41352c] dark:text-[#f0e4d9]">Histórico de lembretes</p><p className="text-[10px] text-[#958678] dark:text-[#a99a8d]">{history.length} {history.length===1?'alerta acionado':'alertas acionados'}</p></div><button type="button" onClick={()=>setOpen(false)} className="text-[11px] text-[#8c7d70] hover:text-[#44372d] dark:text-[#b5a89d]">Fechar</button></div>
      <div className="min-h-[90px] flex-1 overflow-y-auto p-2">
        {loading&&!history.length?<div className="flex justify-center py-8 text-[#8e7e70]"><Loader2 className="w-4 h-4 animate-spin"/></div>:history.length===0?<p className="px-3 py-8 text-center text-xs text-[#96877a] dark:text-[#aa9b8e]">Nenhum alerta no histórico.</p>:history.map(alert=><button key={alert.id} type="button" onClick={()=>openStick(alert)} className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left hover:bg-[#f5eee7] dark:hover:bg-[#302923]"><span className="mt-0.5 rounded-lg bg-[#f4e8dc] p-1.5 text-[#886448] dark:bg-[#392d23] dark:text-[#e4bd98]"><Clock3 className="w-3.5 h-3.5"/></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-[#4b3d32] dark:text-[#efe2d7]">{getStickTitle(alert)}</span><span className="mt-0.5 block text-[10px] text-[#8d7e71] dark:text-[#aa9b8e]">{alert.offset_days===0?'No dia escolhido':alert.offset_days===7?'1 semana antes':alert.offset_days===14?'2 semanas antes':alert.offset_days===30?'1 mês antes':alert.offset_days+' dias antes'} · {formatHistoryDate(alert.triggered_at)}</span></span></button>)}
        {error&&<p className="px-3 py-2 text-[11px] text-red-600">{error}</p>}
      </div>
      <div className="border-t border-[#eee7df] px-3 py-2.5 dark:border-[#39322c]"><button type="button" onClick={handleClear} disabled={!history.length||clearing} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#a14e43] hover:text-red-700 disabled:opacity-35 dark:text-[#e49a8e]"><Trash2 className="w-3 h-3"/>{clearing?'Limpando...':'Limpar tudo'}</button></div>
    </div>}
  </div>;
}

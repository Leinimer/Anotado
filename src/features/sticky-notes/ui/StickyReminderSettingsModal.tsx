'use client';

import React, { useEffect, useState } from 'react';
import { AlarmClock, CalendarDays, Clock3, Loader2, X } from 'lucide-react';
import { StickyNote } from '../types';
import {
  STICKY_REMINDER_OFFSETS,
  fetchStickyReminderConfig,
  saveStickyReminderConfig,
  deleteAllStickyReminderAlerts,
  getBrowserTimeZone,
} from '../api/sticky-reminders-api';

interface Props {
  isOpen: boolean;
  userId: string;
  note: StickyNote | null;
  onClose: () => void;
  onSaved: (hasReminder: boolean) => void;
}

export function StickyReminderSettingsModal({ isOpen, userId, note, onClose, onSaved }: Props) {
  const [targetDate, setTargetDate] = useState('');
  const [targetTime, setTargetTime] = useState('09:00');
  const [selectedOffsets, setSelectedOffsets] = useState<number[]>([0]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !note) return;
    let active = true;
    setLoading(true);
    setError('');
    fetchStickyReminderConfig(userId, note.id)
      .then(config => {
        if (!active) return;
        setTargetDate(config.target_date);
        setTargetTime(config.target_time);
        setSelectedOffsets(config.offset_days);
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err.message : 'Não foi possível carregar os lembretes.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isOpen, note?.id, userId]);

  const toggleOffset = (days: number) => setSelectedOffsets(previous =>
    previous.includes(days) ? previous.filter(value => value !== days) : [...previous, days].sort((a,b) => a-b)
  );

  const handleSave = async () => {
    if (!note || !targetDate || !targetTime || selectedOffsets.length === 0) {
      setError('Escolha a data, a hora e pelo menos um momento para receber o alerta.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const enabled = await saveStickyReminderConfig(userId, note.id, {
        target_date: targetDate,
        target_time: targetTime,
        offset_days: selectedOffsets,
      });
      onSaved(enabled);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o lembrete.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!note) return;
    setSaving(true);
    setError('');
    try {
      await deleteAllStickyReminderAlerts(userId, note.id);
      onSaved(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível remover os lembretes.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !note) return null;
  return <div className="fixed inset-0 z-[10800] flex items-center justify-center bg-black/35 backdrop-blur-[2px] p-3" onMouseDown={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="sticky-reminder-settings-title" onMouseDown={event=>event.stopPropagation()} className="w-full max-w-md rounded-2xl border border-[#e6ddd2] dark:border-[#40352c] bg-[#fffdf9] dark:bg-[#1d1b19] shadow-2xl overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#eee7df] dark:border-[#39322c]">
        <div className="flex items-center gap-2.5 min-w-0"><span className="w-9 h-9 rounded-xl bg-[#f3e7da] dark:bg-[#392c22] text-[#82664f] dark:text-[#e5c6a7] flex items-center justify-center"><AlarmClock className="w-5 h-5"/></span><div className="min-w-0"><h2 id="sticky-reminder-settings-title" className="font-semibold text-sm text-[#332a23] dark:text-[#f2e8df]">Lembrete do Stick</h2><p className="truncate text-xs text-[#8d7d70] dark:text-[#aa9b8f]">{note.title || 'Stick sem título'}</p></div></div>
        <button type="button" onClick={onClose} className="p-2 rounded-lg text-[#89796d] hover:bg-[#f2ece5] dark:hover:bg-[#302923]" aria-label="Fechar"><X className="w-4 h-4"/></button>
      </header>
      <div className="p-5 space-y-4">
        {loading ? <div className="py-10 flex justify-center text-[#8b7d71]"><Loader2 className="w-5 h-5 animate-spin"/></div> : <>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5"><span className="flex items-center gap-1.5 text-xs font-medium text-[#6d5d50] dark:text-[#c7b6a7]"><CalendarDays className="w-3.5 h-3.5"/>Data</span><input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)} className="w-full rounded-xl border border-[#e4d9cd] dark:border-[#51463e] bg-[#fbf8f3] dark:bg-[#29231e] px-3 py-2.5 text-sm text-[#382d25] dark:text-[#f4ece4] outline-none focus:border-[#a8896c]"/></label>
            <label className="space-y-1.5"><span className="flex items-center gap-1.5 text-xs font-medium text-[#6d5d50] dark:text-[#c7b6a7]"><Clock3 className="w-3.5 h-3.5"/>Hora</span><input type="time" value={targetTime} onChange={e=>setTargetTime(e.target.value)} className="w-full rounded-xl border border-[#e4d9cd] dark:border-[#51463e] bg-[#fbf8f3] dark:bg-[#29231e] px-3 py-2.5 text-sm text-[#382d25] dark:text-[#f4ece4] outline-none focus:border-[#a8896c]"/></label>
          </div>
          <div className="space-y-2">
            <div><h3 className="text-xs font-semibold text-[#5e5045] dark:text-[#d8c9bb]">Quando deseja ser lembrado?</h3><p className="text-[11px] text-[#96877a] dark:text-[#a8998d]">Selecione quantos alertas quiser.</p></div>
            <div className="grid grid-cols-2 gap-2">
              {STICKY_REMINDER_OFFSETS.map(option=><label key={option.days} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-xs cursor-pointer transition-colors ${selectedOffsets.includes(option.days)?'border-[#a88a70] bg-[#f3e9df] text-[#513d2e] dark:border-[#80644d] dark:bg-[#3b2e24] dark:text-[#f0dfcf]':'border-[#e9e1d9] bg-white text-[#76695e] hover:bg-[#f8f4ef] dark:border-[#413831] dark:bg-[#25211e] dark:text-[#c4b5a8] dark:hover:bg-[#302a25]'}`}><input type="checkbox" checked={selectedOffsets.includes(option.days)} onChange={()=>toggleOffset(option.days)} className="accent-[#80634f]"/><span>{option.label}</span></label>)}
            </div>
          </div>
          <p className="text-[11px] text-[#988a7e] dark:text-[#a8998d]">Horário local: {getBrowserTimeZone()}</p>
          {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </>}
      </div>
      <footer className="flex items-center justify-between gap-3 px-5 py-4 bg-[#faf7f2] dark:bg-[#211e1b] border-t border-[#eee7df] dark:border-[#39322c]">
        {selectedOffsets.length || note ? <button type="button" onClick={handleRemove} disabled={loading||saving} className="text-xs text-[#a34b3d] hover:text-red-700 disabled:opacity-40">Remover alertas</button> : <span/>}
        <div className="flex items-center gap-2"><button type="button" onClick={onClose} disabled={saving} className="px-3 py-2 rounded-lg text-xs text-[#75675b] hover:bg-[#eee8e0] dark:text-[#c4b5a8] dark:hover:bg-[#342d27]">Cancelar</button><button type="button" onClick={handleSave} disabled={loading||saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#68594d] hover:bg-[#55473d] text-white text-xs font-semibold disabled:opacity-40">{saving&&<Loader2 className="w-3.5 h-3.5 animate-spin"/>}Salvar lembrete</button></div>
      </footer>
    </section>
  </div>;
}

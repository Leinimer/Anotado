import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { StickyNote } from '../types';
import { UpdateStickyNotePatch, updateStickyNote, deleteStickyNote } from './sticky-notes-api';

export const STICKY_REMINDER_OFFSETS = [
  { days: 0, label: 'Na data escolhida' },
  { days: 1, label: '1 dia antes' },
  { days: 2, label: '2 dias antes' },
  { days: 3, label: '3 dias antes' },
  { days: 5, label: '5 dias antes' },
  { days: 7, label: '1 semana antes' },
  { days: 14, label: '2 semanas antes' },
  { days: 30, label: '1 mês antes' },
] as const;

export interface StickyReminderConfig {
  id: string | null;
  target_date: string;
  target_time: string;
  time_zone: string;
  offset_days: number[];
}

export interface StickyReminderAlert {
  id: string;
  reminder_id: string;
  user_id: string;
  sticky_note_id: string;
  target_date: string;
  target_time: string;
  time_zone: string;
  offset_days: number;
  scheduled_at: string;
  triggered_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
  sticky_notes?: Pick<StickyNote, 'id' | 'title' | 'content' | 'color'> | null;
}

const supabase = () => {
  if (!isSupabaseConfigured()) throw new Error('Supabase não está configurado.');
  return createClient();
};

export function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  } catch {
    return 'America/Sao_Paulo';
  }
}

export function getLocalDateValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function getScheduledAt(targetDate: string, targetTime: string, offsetDays: number): string {
  const [year, month, day] = targetDate.split('-').map(Number);
  const [hour, minute] = targetTime.split(':').map(Number);
  const date = new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0);
  date.setDate(date.getDate() - offsetDays);
  return date.toISOString();
}

export async function fetchStickyReminderConfig(userId: string, stickyNoteId: string): Promise<StickyReminderConfig> {
  const client = supabase();
  const { data: reminder, error } = await client
    .from('sticky_note_reminders')
    .select('id,target_date,target_time,time_zone')
    .eq('user_id', userId)
    .eq('sticky_note_id', stickyNoteId)
    .maybeSingle();
  if (error) throw error;

  if (!reminder) {
    return {
      id: null,
      target_date: getLocalDateValue(),
      target_time: '09:00',
      time_zone: getBrowserTimeZone(),
      offset_days: [],
    };
  }

  const { data: alerts, error: alertsError } = await client
    .from('sticky_note_reminder_alerts')
    .select('offset_days')
    .eq('user_id', userId)
    .eq('reminder_id', reminder.id)
    .is('triggered_at', null);
  if (alertsError) throw alertsError;

  return {
    id: reminder.id,
    target_date: reminder.target_date,
    target_time: String(reminder.target_time || '09:00').slice(0, 5),
    time_zone: reminder.time_zone || getBrowserTimeZone(),
    offset_days: (alerts || []).map((alert: any) => Number(alert.offset_days)),
  };
}

export async function saveStickyReminderConfig(
  userId: string,
  stickyNoteId: string,
  input: { target_date: string; target_time: string; offset_days: number[] },
): Promise<boolean> {
  const client = supabase();
  const timeZone = getBrowserTimeZone();
  const { data: reminder, error: upsertError } = await client
    .from('sticky_note_reminders')
    .upsert({
      user_id: userId,
      sticky_note_id: stickyNoteId,
      target_date: input.target_date,
      target_time: input.target_time,
      time_zone: timeZone,
    }, { onConflict: 'sticky_note_id' })
    .select('id')
    .single();
  if (upsertError || !reminder) throw upsertError || new Error('Não foi possível salvar o lembrete.');

  const { error: deleteError } = await client
    .from('sticky_note_reminder_alerts')
    .delete()
    .eq('user_id', userId)
    .eq('reminder_id', reminder.id)
    .is('triggered_at', null);
  if (deleteError) throw deleteError;

  const offsets = Array.from(new Set(input.offset_days))
    .filter(days => STICKY_REMINDER_OFFSETS.some(option => option.days === days));
  if (offsets.length) {
    const rows = offsets.map(offsetDays => ({
      reminder_id: reminder.id,
      user_id: userId,
      sticky_note_id: stickyNoteId,
      target_date: input.target_date,
      target_time: input.target_time,
      time_zone: timeZone,
      offset_days: offsetDays,
      scheduled_at: getScheduledAt(input.target_date, input.target_time, offsetDays),
    }));
    const { error: insertError } = await client.from('sticky_note_reminder_alerts').insert(rows);
    if (insertError) throw insertError;
  } else {
    const { count, error: countError } = await client
      .from('sticky_note_reminder_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('reminder_id', reminder.id)
      .not('triggered_at', 'is', null);
    if (countError) throw countError;
    if (!count) {
      const { error: removeParentError } = await client
        .from('sticky_note_reminders')
        .delete()
        .eq('id', reminder.id)
        .eq('user_id', userId);
      if (removeParentError) throw removeParentError;
    }
  }
  return offsets.length > 0;
}

export async function deleteAllStickyReminderAlerts(userId: string, stickyNoteId: string): Promise<void> {
  const client = supabase();
  const { data: reminder, error } = await client
    .from('sticky_note_reminders')
    .select('id')
    .eq('user_id', userId)
    .eq('sticky_note_id', stickyNoteId)
    .maybeSingle();
  if (error) throw error;
  if (!reminder) return;

  const { error: removePendingError } = await client
    .from('sticky_note_reminder_alerts')
    .delete()
    .eq('user_id', userId)
    .eq('reminder_id', reminder.id)
    .is('triggered_at', null);
  if (removePendingError) throw removePendingError;

  const { count, error: historyError } = await client
    .from('sticky_note_reminder_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('reminder_id', reminder.id)
    .not('triggered_at', 'is', null);
  if (historyError) throw historyError;

  if (!count) {
    const { error: removeParentError } = await client
      .from('sticky_note_reminders')
      .delete()
      .eq('id', reminder.id)
      .eq('user_id', userId);
    if (removeParentError) throw removeParentError;
  }
}

export async function fetchStickyReminderNoteIds(userId: string): Promise<string[]> {
  const client = supabase();
  const { data, error } = await client
    .from('sticky_note_reminder_alerts')
    .select('sticky_note_id')
    .eq('user_id', userId)
    .is('triggered_at', null);
  if (error) throw error;
  return Array.from(new Set((data || []).map((row: any) => row.sticky_note_id as string)));
}

const ALERT_SELECT = 'id,reminder_id,user_id,sticky_note_id,target_date,target_time,time_zone,offset_days,scheduled_at,triggered_at,acknowledged_at,created_at,sticky_notes!inner(id,title,content,color)';

export async function triggerDueStickyReminderAlerts(userId: string, now = new Date()): Promise<void> {
  const client = supabase();
  const { data, error } = await client
    .from('sticky_note_reminder_alerts')
    .select('id')
    .eq('user_id', userId)
    .is('triggered_at', null)
    .lte('scheduled_at', now.toISOString())
    .limit(100);
  if (error) throw error;
  for (const row of data || []) {
    const { error: updateError } = await client
      .from('sticky_note_reminder_alerts')
      .update({ triggered_at: now.toISOString() })
      .eq('id', row.id)
      .eq('user_id', userId)
      .is('triggered_at', null);
    if (updateError) throw updateError;
  }
}

export async function fetchUnacknowledgedStickyReminderAlerts(userId: string): Promise<StickyReminderAlert[]> {
  const client = supabase();
  const { data, error } = await client
    .from('sticky_note_reminder_alerts')
    .select(ALERT_SELECT)
    .eq('user_id', userId)
    .not('triggered_at', 'is', null)
    .is('acknowledged_at', null)
    .order('scheduled_at', { ascending: true })
    .limit(100);
  if (error) throw error;
  return (data || []) as unknown as StickyReminderAlert[];
}

export async function fetchStickyReminderHistory(userId: string): Promise<StickyReminderAlert[]> {
  const client = supabase();
  const { data, error } = await client
    .from('sticky_note_reminder_alerts')
    .select(ALERT_SELECT)
    .eq('user_id', userId)
    .not('triggered_at', 'is', null)
    .order('triggered_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []) as unknown as StickyReminderAlert[];
}

export async function acknowledgeStickyReminderAlert(userId: string, alertId: string): Promise<void> {
  const { error } = await supabase()
    .from('sticky_note_reminder_alerts')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('id', alertId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function deleteStickyReminderAlert(userId: string, alertId: string): Promise<void> {
  const { error } = await supabase()
    .from('sticky_note_reminder_alerts')
    .delete()
    .eq('id', alertId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function clearStickyReminderHistory(userId: string): Promise<void> {
  const { error } = await supabase()
    .from('sticky_note_reminder_alerts')
    .delete()
    .eq('user_id', userId)
    .not('triggered_at', 'is', null);
  if (error) throw error;
}

export async function saveReminderPopupStick(
  userId: string,
  stickyNoteId: string,
  patch: Pick<UpdateStickyNotePatch, 'title' | 'content'>,
) {
  return updateStickyNote(userId, stickyNoteId, patch);
}

export async function deleteReminderPopupStick(userId: string, stickyNoteId: string) {
  return deleteStickyNote(userId, stickyNoteId);
}

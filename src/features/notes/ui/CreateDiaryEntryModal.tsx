'use client';

import React, { useState } from 'react';
import { Calendar, X, Plus, AlertCircle, Check } from 'lucide-react';
import { getLocalDateString, parseDiaryDate, formatDateReadable } from '../utils/diary-date';

interface CreateDiaryEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingDates: Set<string>;
  onConfirm: (dateStr: string, customTitle?: string) => Promise<void>;
}

export function CreateDiaryEntryModal({
  isOpen,
  onClose,
  existingDates,
  onConfirm,
}: CreateDiaryEntryModalProps) {
  const [date, setDate] = useState<string>(getLocalDateString());
  const [title, setTitle] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const isAlreadyCreated = existingDates.has(date);
  const readableDate = date ? formatDateReadable(date) : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || isSubmitting) return;

    try {
      setIsSubmitting(true);
      await onConfirm(date, title.trim() || undefined);
      onClose();
    } catch (err) {
      console.error('[CreateDiaryEntryModal] Erro:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="create-diary-entry-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs font-sans-ui animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl border border-[#e4e2dd] shadow-xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#f0eee9]">
          <div className="flex items-center gap-2 text-[#1b1c19]">
            <div className="w-8 h-8 rounded-xl bg-[#f4dfcb] text-[#68594d] flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1b1c19]">Nova Entrada no Diário</h3>
              <p className="text-xs text-[#7f756e]">Registro pessoal por dia</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#f0eee9] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Data picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#4e453f] block">Data da Entrada</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm bg-[#fbf9f4] border border-[#e4e2dd] rounded-xl text-[#1b1c19] focus:outline-none focus:border-[#68594d] focus:bg-white transition-all"
            />
            {readableDate && (
              <p className="text-[11px] text-[#68594d] font-medium pt-0.5 capitalize">
                {readableDate}
              </p>
            )}
          </div>

          {/* Aviso se já existe */}
          {isAlreadyCreated && (
            <div className="p-3 bg-[#fdf5eb] border border-[#f0dfcc] rounded-xl flex items-start gap-2 text-xs text-[#8c5e2d]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Entrada já existente para esta data.</p>
                <p className="text-[11px] text-[#7a5833] mt-0.5">
                  Ao confirmar, você será direcionado para editar a entrada já existente (não será criada nota duplicada).
                </p>
              </div>
            </div>
          )}

          {/* Título opcional */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#4e453f] block">
              Título ou Tema <span className="text-[#a09890] font-normal">(opcional)</span>
            </label>
            <input
              type="text"
              placeholder="Ex: Reflexões sobre o dia, Viagem, etc."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[#fbf9f4] border border-[#e4e2dd] rounded-xl text-[#1b1c19] placeholder-[#a09890] focus:outline-none focus:border-[#68594d] focus:bg-white transition-all"
            />
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f0eee9]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-[#4e453f] hover:bg-[#f0eee9] rounded-xl transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!date || isSubmitting}
              className="px-4 py-1.5 text-xs font-semibold bg-[#68594d] text-white rounded-xl hover:bg-[#584a3f] active:scale-95 transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isAlreadyCreated ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Abrir Entrada Existente</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>Criar Entrada</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

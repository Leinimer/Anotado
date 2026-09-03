'use client';

import React, { useState } from 'react';
import { Calendar, X, Plus } from 'lucide-react';

interface CreateDiaryYearModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingYears: number[];
  onConfirm: (year: number) => Promise<void>;
}

export function CreateDiaryYearModal({
  isOpen,
  onClose,
  existingYears,
  onConfirm,
}: CreateDiaryYearModalProps) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(() => {
    return existingYears.includes(currentYear) ? currentYear + 1 : currentYear;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const isAlreadyCreated = existingYears.includes(year);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!year || isSubmitting) return;

    try {
      setIsSubmitting(true);
      await onConfirm(year);
      onClose();
    } catch (err) {
      console.error('[CreateDiaryYearModal] Erro:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="create-diary-year-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs font-sans-ui animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl border border-[#e4e2dd] shadow-xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#f0eee9]">
          <div className="flex items-center gap-2 text-[#1b1c19]">
            <div className="w-8 h-8 rounded-xl bg-[#f4dfcb] text-[#68594d] flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1b1c19]">Novo Ano no Diário</h3>
              <p className="text-xs text-[#7f756e]">Cria o ano e seus 12 meses</p>
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
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#4e453f] block">Ano (ex: 2026, 2027)</label>
            <input
              type="number"
              min="1900"
              max="2100"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10))}
              required
              className="w-full px-3 py-2 text-sm bg-[#fbf9f4] border border-[#e4e2dd] rounded-xl text-[#1b1c19] focus:outline-none focus:border-[#68594d] focus:bg-white transition-all"
            />
            <p className="text-[11px] text-[#7f756e]">
              Serão geradas as 12 pastas correspondentes de Janeiro a Dezembro.
            </p>
          </div>

          {isAlreadyCreated && (
            <p className="text-xs text-[#ba1a1a] font-medium">
              Este ano já existe no Diário.
            </p>
          )}

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
              disabled={!year || isAlreadyCreated || isSubmitting}
              className="px-4 py-1.5 text-xs font-semibold bg-[#68594d] text-white rounded-xl hover:bg-[#584a3f] active:scale-95 transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Criar Ano</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

'use client';

import React, { useState, useRef } from 'react';
import { FileUp, X, Folder as FolderIcon, FileText, Check, Loader2 } from 'lucide-react';
import { Folder, Note } from '../types';

interface AddPdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  folders: Folder[];
  notes: Note[];
  activeFolderId: string | null;
  onAddIndependentPdf: (file: File, folderId: string | null) => Promise<void>;
  onAttachPdfToNote: (file: File, noteId: string) => Promise<void>;
}

export function AddPdfModal({
  isOpen,
  onClose,
  folders,
  notes,
  activeFolderId,
  onAddIndependentPdf,
  onAttachPdfToNote,
}: AddPdfModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [destinationMode, setDestinationMode] = useState<'library' | 'note'>('library');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(activeFolderId || null);
  const [selectedNoteId, setSelectedNoteId] = useState<string>('');
  const [noteSearchQuery, setNoteSearchQuery] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        setErrorMsg('Por favor, selecione um arquivo no formato PDF.');
        return;
      }
      setSelectedFile(file);
      setErrorMsg(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        setErrorMsg('Por favor, arraste um arquivo no formato PDF.');
        return;
      }
      setSelectedFile(file);
      setErrorMsg(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const activeNotes = notes.filter((n) => !n.is_archived);
  const filteredNotes = activeNotes.filter((n) =>
    (n.title || 'Sem título').toLowerCase().includes(noteSearchQuery.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorMsg('Selecione um arquivo PDF para continuar.');
      return;
    }

    if (destinationMode === 'note' && !selectedNoteId) {
      setErrorMsg('Escolha a nota de destino onde o PDF será anexado.');
      return;
    }

    try {
      setIsUploading(true);
      setErrorMsg(null);

      if (destinationMode === 'library') {
        await onAddIndependentPdf(selectedFile, selectedFolderId);
      } else {
        await onAttachPdfToNote(selectedFile, selectedNoteId);
      }

      onClose();
    } catch (err: any) {
      console.error('[AddPdfModal] Erro ao adicionar PDF:', err);
      setErrorMsg(err.message || 'Falha ao adicionar PDF. Tente novamente.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-[#201f1d] rounded-2xl shadow-2xl border border-[#e4e2dd] dark:border-[#3d3a37] overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150 font-sans-ui"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0eee9] dark:border-[#2f2d2a]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#e11d48]/10 text-[#e11d48] flex items-center justify-center">
              <FileUp className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#1b1c19] dark:text-[#f3efe6]">
                Adicionar PDF
              </h2>
              <p className="text-[11px] text-[#7f756e] dark:text-[#a89f91]">
                Importe documentos para visualização e anotação integrada
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#7f756e] hover:text-[#1b1c19] dark:text-[#a89f91] dark:hover:text-white hover:bg-[#f4f1ea] dark:hover:bg-[#2a2926] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Área de seleção de arquivo */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={handleFileChange}
          />

          {!selectedFile ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#dcd7ce] dark:border-[#3d3a37] rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:border-[#e11d48] dark:hover:border-[#e11d48] hover:bg-[#fff1f2]/30 dark:hover:bg-[#881337]/10 transition-colors group"
            >
              <div className="w-12 h-12 rounded-full bg-[#f4f1ea] dark:bg-[#2a2926] flex items-center justify-center mb-3 text-[#7f756e] dark:text-[#a89f91] group-hover:text-[#e11d48] group-hover:scale-105 transition-all">
                <FileUp className="w-6 h-6" />
              </div>
              <span className="text-xs font-medium text-[#1b1c19] dark:text-[#f3efe6] mb-1">
                Clique para escolher ou arraste o arquivo PDF aqui
              </span>
              <span className="text-[11px] text-[#7f756e] dark:text-[#a89f91]">
                Documentos PDF até 50 MB
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#fff1f2]/50 dark:bg-[#881337]/15 border border-[#fecdd3] dark:border-[#9f1239]/40">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="w-9 h-9 rounded-lg bg-[#e11d48] text-white flex items-center justify-center shrink-0 shadow-xs">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#1b1c19] dark:text-[#f3efe6] truncate">
                    {selectedFile.name}
                  </p>
                  <p className="text-[11px] text-[#7f756e] dark:text-[#a89f91]">
                    {formatFileSize(selectedFile.size)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFile(null)}
                className="text-xs text-[#e11d48] hover:underline font-medium shrink-0 ml-2"
              >
                Trocar
              </button>
            </div>
          )}

          {/* Destino do PDF */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[#4e453f] dark:text-[#d1c4bc]">
              Destino do arquivo
            </label>

            {/* Opção A: Biblioteca de PDFs */}
            <div
              onClick={() => setDestinationMode('library')}
              className={`p-3 rounded-xl border cursor-pointer transition-all ${
                destinationMode === 'library'
                  ? 'border-[#e11d48] bg-[#fff1f2]/30 dark:bg-[#881337]/10'
                  : 'border-[#e4e2dd] dark:border-[#3d3a37] hover:bg-[#fbfaf7] dark:hover:bg-[#262422]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      destinationMode === 'library'
                        ? 'border-[#e11d48] bg-[#e11d48] text-white'
                        : 'border-[#b5aca4] dark:border-[#605b55]'
                    }`}
                  >
                    {destinationMode === 'library' && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </div>
                  <span className="text-xs font-medium text-[#1b1c19] dark:text-[#f3efe6]">
                    Biblioteca de PDFs (Item na árvore lateral)
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-[#7f756e] dark:text-[#a89f91] mt-1 ml-6">
                Fica disponível diretamente na árvore de pastas para leitura e anotação em aba própria.
              </p>

              {destinationMode === 'library' && (
                <div className="mt-3 ml-6">
                  <label className="block text-[11px] font-medium text-[#68594d] dark:text-[#bdafa0] mb-1">
                    Salvar na pasta:
                  </label>
                  <div className="relative">
                    <FolderIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#7f756e] pointer-events-none" />
                    <select
                      value={selectedFolderId || ''}
                      onChange={(e) => setSelectedFolderId(e.target.value || null)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-[#1a1918] border border-[#dcd7ce] dark:border-[#47423e] rounded-lg text-[#1b1c19] dark:text-[#f3efe6] focus:outline-hidden focus:ring-1 focus:ring-[#e11d48]"
                    >
                      <option value="">Raiz (sem pasta)</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Opção B: Anexar a uma nota */}
            <div
              onClick={() => setDestinationMode('note')}
              className={`p-3 rounded-xl border cursor-pointer transition-all ${
                destinationMode === 'note'
                  ? 'border-[#e11d48] bg-[#fff1f2]/30 dark:bg-[#881337]/10'
                  : 'border-[#e4e2dd] dark:border-[#3d3a37] hover:bg-[#fbfaf7] dark:hover:bg-[#262422]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      destinationMode === 'note'
                        ? 'border-[#e11d48] bg-[#e11d48] text-white'
                        : 'border-[#b5aca4] dark:border-[#605b55]'
                    }`}
                  >
                    {destinationMode === 'note' && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </div>
                  <span className="text-xs font-medium text-[#1b1c19] dark:text-[#f3efe6]">
                    Anexar a uma nota existente
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-[#7f756e] dark:text-[#a89f91] mt-1 ml-6">
                Insere o cartão do PDF dentro do conteúdo da nota selecionada.
              </p>

              {destinationMode === 'note' && (
                <div className="mt-3 ml-6 space-y-2">
                  <input
                    type="text"
                    value={noteSearchQuery}
                    onChange={(e) => setNoteSearchQuery(e.target.value)}
                    placeholder="Filtrar notas por título..."
                    className="w-full px-2.5 py-1 text-xs bg-white dark:bg-[#1a1918] border border-[#dcd7ce] dark:border-[#47423e] rounded-lg text-[#1b1c19] dark:text-[#f3efe6] focus:outline-hidden focus:ring-1 focus:ring-[#e11d48]"
                  />
                  <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                    {filteredNotes.length === 0 ? (
                      <p className="text-[11px] text-[#a89f91] py-2 text-center">
                        Nenhuma nota encontrada
                      </p>
                    ) : (
                      filteredNotes.map((note) => (
                        <div
                          key={note.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedNoteId(note.id);
                          }}
                          className={`px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between cursor-pointer transition-colors ${
                            selectedNoteId === note.id
                              ? 'bg-[#e11d48] text-white font-medium'
                              : 'hover:bg-[#f0eee9] dark:hover:bg-[#2c2a27] text-[#4e453f] dark:text-[#d1c4bc]'
                          }`}
                        >
                          <span className="truncate">{note.title || 'Sem título'}</span>
                          {selectedNoteId === note.id && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-[#fef2f2] dark:bg-[#450a0a] text-[#b91c1c] dark:text-[#fca5a5] text-xs">
              {errorMsg}
            </div>
          )}

          {/* Rodapé com botões de ação */}
          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isUploading}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-[#68594d] dark:text-[#bdafa0] hover:bg-[#f4f1ea] dark:hover:bg-[#2a2926] transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!selectedFile || isUploading}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#e11d48] text-white hover:bg-[#be123c] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Enviando...</span>
                </>
              ) : (
                <span>Adicionar</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

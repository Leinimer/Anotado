'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Highlighter,
  Palette,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  CheckSquare,
  ChevronRight,
  Undo,
  Redo,
  Image as ImageIcon,
  FileText,
  Youtube as YoutubeIcon,
  Plus,
  Trash2,
  ChevronDown,
  X,
  Loader2,
} from 'lucide-react';
import { uploadNoteFile } from '../api/storage-api';
import { createClient } from '@/src/features/auth/api/supabase-client';

interface EditorToolbarProps {
  editor: Editor | null;
}

const FONT_SIZES = [
  '10px',
  '11px',
  '12px',
  '13px',
  '14px',
  '15px',
  '16px',
  '18px',
  '20px',
  '22px',
  '24px',
  '28px',
  '32px',
  '36px',
  '40px',
  '48px',
  '72px',
] as const;

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showAddFileMenu, setShowAddFileMenu] = useState(false);
  const [showYoutubeModal, setShowYoutubeModal] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [, setSelectionUpdate] = useState(0);
  const [keyboardBottomOffset, setKeyboardBottomOffset] = useState<number>(0);

  // Monitora a abertura/fechamento do teclado virtual mobile via visualViewport
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateKeyboardPosition = () => {
      if (window.visualViewport) {
        const vv = window.visualViewport;
        // Distância entre a parte inferior da janela visível e o fim da tela
        const offset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
        // Se a diferença for significativa (> 60px), o teclado virtual está aberto no mobile/tablet
        if (offset > 60) {
          setKeyboardBottomOffset(offset);
        } else {
          setKeyboardBottomOffset(0);
        }
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateKeyboardPosition);
      window.visualViewport.addEventListener('scroll', updateKeyboardPosition);
    }

    window.addEventListener('resize', updateKeyboardPosition);

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateKeyboardPosition);
        window.visualViewport.removeEventListener('scroll', updateKeyboardPosition);
      }
      window.removeEventListener('resize', updateKeyboardPosition);
    };
  }, []);

  // Coordenadas calculadas para os popovers flutuantes livres
  const [popoverCoords, setPopoverCoords] = useState<{ bottom: number; left: number } | null>(null);

  const highlightBtnRef = useRef<HTMLButtonElement>(null);
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const addFileBtnRef = useRef<HTMLButtonElement>(null);

  const highlightPopoverRef = useRef<HTMLDivElement>(null);
  const colorPopoverRef = useRef<HTMLDivElement>(null);
  const addFilePopoverRef = useRef<HTMLDivElement>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.id) {
        setUserId(data.user.id);
      }
    });
  }, []);

  useEffect(() => {
    if (!editor) return;

    const handleTransaction = () => {
      setSelectionUpdate((prev) => prev + 1);
    };

    editor.on('transaction', handleTransaction);
    return () => {
      editor.off('transaction', handleTransaction);
    };
  }, [editor]);

  // Fecha popovers ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        highlightPopoverRef.current &&
        !highlightPopoverRef.current.contains(target) &&
        highlightBtnRef.current &&
        !highlightBtnRef.current.contains(target)
      ) {
        setShowHighlightPicker(false);
      }
      if (
        colorPopoverRef.current &&
        !colorPopoverRef.current.contains(target) &&
        colorBtnRef.current &&
        !colorBtnRef.current.contains(target)
      ) {
        setShowColorPicker(false);
      }
      if (
        addFilePopoverRef.current &&
        !addFilePopoverRef.current.contains(target) &&
        addFileBtnRef.current &&
        !addFileBtnRef.current.contains(target)
      ) {
        setShowAddFileMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  if (!editor) {
    return null;
  }

  // Paleta de Marca-Texto (Pastéis Suaves)
  const highlightPastels = [
    { label: 'Amarelo Suave', color: '#fef08a' },
    { label: 'Verde Menta', color: '#bbf7d0' },
    { label: 'Rosa Pergaminho', color: '#fecdd3' },
    { label: 'Azul Céu', color: '#bfdbfe' },
    { label: 'Lilás Suave', color: '#e9d5ff' },
    { label: 'Laranja Pêssego', color: '#fed7aa' },
  ];

  // Paleta de Cores do Texto (Tons Clássicos de Tinta e Editoriais)
  const textColors = [
    { label: 'Tinta Padrão', color: '#1b1c19' },
    { label: 'Sépia Clássica', color: '#68594d' },
    { label: 'Café Profundo', color: '#4a3728' },
    { label: 'Carmim Nobre', color: '#ba1a1a' },
    { label: 'Azul Noite', color: '#1e3a8a' },
    { label: 'Verde Floresta', color: '#14532d' },
    { label: 'Terracota', color: '#ea580c' },
    { label: 'Cinza Grafite', color: '#64748b' },
  ];

  // Disparadores de Popover com cálculo de posição acima da toolbar
  const toggleHighlightPicker = () => {
    if (!showHighlightPicker && highlightBtnRef.current) {
      const rect = highlightBtnRef.current.getBoundingClientRect();
      setPopoverCoords({
        bottom: window.innerHeight - rect.top + 8,
        left: rect.left + rect.width / 2,
      });
      setShowHighlightPicker(true);
      setShowColorPicker(false);
      setShowAddFileMenu(false);
    } else {
      setShowHighlightPicker(false);
    }
  };

  const toggleColorPicker = () => {
    if (!showColorPicker && colorBtnRef.current) {
      const rect = colorBtnRef.current.getBoundingClientRect();
      setPopoverCoords({
        bottom: window.innerHeight - rect.top + 8,
        left: rect.left + rect.width / 2,
      });
      setShowColorPicker(true);
      setShowHighlightPicker(false);
      setShowAddFileMenu(false);
    } else {
      setShowColorPicker(false);
    }
  };

  const toggleAddFileMenu = () => {
    if (!showAddFileMenu && addFileBtnRef.current) {
      const rect = addFileBtnRef.current.getBoundingClientRect();
      setPopoverCoords({
        bottom: window.innerHeight - rect.top + 8,
        left: rect.left + rect.width / 2,
      });
      setShowAddFileMenu(true);
      setShowHighlightPicker(false);
      setShowColorPicker(false);
    } else {
      setShowAddFileMenu(false);
    }
  };

  // Escala de Tamanho de Fonte Progressiva
  const handleIncreaseFontSize = () => {
    const currentSize = editor.getAttributes('textStyle').fontSize || '16px';
    const currentIndex = FONT_SIZES.indexOf(currentSize as (typeof FONT_SIZES)[number]);
    const nextIndex =
      currentIndex === -1 ? 6 : Math.min(currentIndex + 1, FONT_SIZES.length - 1);
    editor.chain().focus().setMark('textStyle', { fontSize: FONT_SIZES[nextIndex] }).run();
  };

  const handleDecreaseFontSize = () => {
    const currentSize = editor.getAttributes('textStyle').fontSize || '16px';
    const currentIndex = FONT_SIZES.indexOf(currentSize as (typeof FONT_SIZES)[number]);
    const prevIndex = currentIndex === -1 ? 4 : Math.max(0, currentIndex - 1);
    editor.chain().focus().setMark('textStyle', { fontSize: FONT_SIZES[prevIndex] }).run();
  };

  // Upload e inserção de imagem
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      setShowAddFileMenu(false);
      const result = await uploadNoteFile(userId, file);
      editor.chain().focus().setImage({ src: result.url, alt: result.name }).run();
    } catch (err) {
      console.error('Erro ao fazer upload da imagem:', err);
    } finally {
      setIsUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  // Upload e inserção de documento/PDF
  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      setShowAddFileMenu(false);
      const result = await uploadNoteFile(userId, file);
      editor
        .chain()
        .focus()
        .setDocumentAttachment({
          src: result.url,
          name: result.name,
          size: result.size,
          type: result.type,
        })
        .run();
    } catch (err) {
      console.error('Erro ao fazer upload do documento:', err);
    } finally {
      setIsUploading(false);
      if (docInputRef.current) docInputRef.current.value = '';
    }
  };

  // Inserção de vídeo do YouTube
  const handleYoutubeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = youtubeUrl.trim();
    if (!url) return;

    editor.chain().focus().setYoutubeVideo({ src: url, width: '100%' }).run();
    setYoutubeUrl('');
    setShowYoutubeModal(false);
  };

  const isInsideToggle = editor.isActive('toggleDetails');

  return (
    <div
      id="editor-floating-dock-container"
      style={
        keyboardBottomOffset > 0
          ? {
              position: 'fixed',
              bottom: `${keyboardBottomOffset + 10}px`,
              left: 0,
              right: 0,
              zIndex: 50,
              paddingLeft: '8px',
              paddingRight: '8px',
              transition: 'bottom 0.15s cubic-bezier(0.2, 0, 0, 1)',
            }
          : undefined
      }
      className={`w-full flex justify-center px-2 sm:px-4 py-2 shrink-0 select-none z-30 max-w-full overflow-hidden ${
        keyboardBottomOffset > 0 ? 'pointer-events-auto shadow-2xl' : ''
      }`}
    >
      {/* Dock Flutuante Centralizado Minimalista Papyrus & Ink */}
      <nav
        id="editor-bottom-toolbar"
        aria-label="Barra de ferramentas de formatação"
        className="max-w-full bg-[#ffffff]/95 backdrop-blur-md border border-[#e4e2dd] rounded-2xl shadow-lg px-2 sm:px-3 py-1.5 sm:py-2 flex items-center gap-1 sm:gap-1.5 overflow-x-auto relative scrollbar-none"
      >
        {/* Hidden inputs para arquivos */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageUpload}
        />
        <input
          ref={docInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.txt,.rtf"
          className="hidden"
          onChange={handleDocUpload}
        />

        {/* Grupo 0: Desfazer / Refazer (Undo / Redo) */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            id="toolbar-btn-undo"
            type="button"
            disabled={!editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
            className={`min-w-[40px] min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.can().undo()
                ? 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
                : 'text-[#d1c4bc] cursor-not-allowed opacity-50'
            }`}
            title="Desfazer (Ctrl+Z)"
            aria-label="Desfazer"
          >
            <Undo className="w-4.5 h-4.5" />
          </button>

          <button
            id="toolbar-btn-redo"
            type="button"
            disabled={!editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
            className={`min-w-[40px] min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.can().redo()
                ? 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
                : 'text-[#d1c4bc] cursor-not-allowed opacity-50'
            }`}
            title="Refazer (Ctrl+Shift+Z)"
            aria-label="Refazer"
          >
            <Redo className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="h-5 w-[1px] bg-[#e4e2dd] mx-0.5 shrink-0" />

        {/* Grupo 1: Formatação Básica (B, I, U, S) */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            id="toolbar-btn-bold"
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`min-w-[40px] min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive('bold')
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Negrito (Ctrl+B)"
            aria-label="Negrito"
          >
            <Bold className="w-4.5 h-4.5" />
          </button>

          <button
            id="toolbar-btn-italic"
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`min-w-[40px] min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive('italic')
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Itálico (Ctrl+I)"
            aria-label="Itálico"
          >
            <Italic className="w-4.5 h-4.5" />
          </button>

          <button
            id="toolbar-btn-underline"
            type="button"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={`min-w-[40px] min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive('underline')
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Sublinhado (Ctrl+U)"
            aria-label="Sublinhado"
          >
            <Underline className="w-4.5 h-4.5" />
          </button>

          <button
            id="toolbar-btn-strike"
            type="button"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`min-w-[40px] min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive('strike')
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Tachado"
            aria-label="Tachado"
          >
            <Strikethrough className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="h-5 w-[1px] bg-[#e4e2dd] mx-0.5 shrink-0" />

        {/* Grupo 2: Marca-texto e Cor da Fonte */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Marca-Texto (Highlight) */}
          <button
            ref={highlightBtnRef}
            id="toolbar-btn-highlight"
            type="button"
            onClick={toggleHighlightPicker}
            className={`min-h-[40px] px-2 py-1.5 rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer active:scale-95 ${
              editor.isActive('highlight')
                ? 'bg-[#fef08a] text-[#1b1c19] ring-1 ring-[#eab308]'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Marca-texto"
            aria-label="Marca-texto"
          >
            <Highlighter className="w-4.5 h-4.5" />
            <ChevronDown className="w-3 h-3 text-[#7f756e]" />
          </button>

          {/* Cor da Fonte (Text Color) */}
          <button
            ref={colorBtnRef}
            id="toolbar-btn-color"
            type="button"
            onClick={toggleColorPicker}
            className="min-h-[40px] px-2 py-1.5 rounded-xl flex items-center justify-center gap-1 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] transition-all cursor-pointer active:scale-95"
            title="Cor do Texto"
            aria-label="Cor do Texto"
          >
            <Palette className="w-4.5 h-4.5" />
            <ChevronDown className="w-3 h-3 text-[#7f756e]" />
          </button>
        </div>

        <div className="h-5 w-[1px] bg-[#e4e2dd] mx-0.5 shrink-0" />

        {/* Grupo 3: Tamanho da Fonte com Escala Ampla (A↓ / A↑) */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            id="toolbar-btn-decrease-fontsize"
            type="button"
            onClick={handleDecreaseFontSize}
            className="min-w-[40px] min-h-[40px] px-2.5 py-1.5 text-xs font-sans-ui font-bold text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95"
            title="Diminuir tamanho da fonte (A↓)"
            aria-label="Diminuir tamanho da fonte"
          >
            A↓
          </button>
          <button
            id="toolbar-btn-increase-fontsize"
            type="button"
            onClick={handleIncreaseFontSize}
            className="min-w-[40px] min-h-[40px] px-2.5 py-1.5 text-xs font-sans-ui font-bold text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95"
            title="Aumentar tamanho da fonte (A↑)"
            aria-label="Aumentar tamanho da fonte"
          >
            A↑
          </button>
        </div>

        <div className="h-5 w-[1px] bg-[#e4e2dd] mx-0.5 shrink-0" />

        {/* Grupo 4: Alinhamento */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            id="toolbar-align-left"
            type="button"
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            className={`min-w-[40px] min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive({ textAlign: 'left' })
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Alinhar à Esquerda"
            aria-label="Alinhar à Esquerda"
          >
            <AlignLeft className="w-4.5 h-4.5" />
          </button>

          <button
            id="toolbar-align-center"
            type="button"
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            className={`min-w-[40px] min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive({ textAlign: 'center' })
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Centralizar"
            aria-label="Centralizar"
          >
            <AlignCenter className="w-4.5 h-4.5" />
          </button>

          <button
            id="toolbar-align-right"
            type="button"
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            className={`min-w-[40px] min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive({ textAlign: 'right' })
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Alinhar à Direita"
            aria-label="Alinhar à Direita"
          >
            <AlignRight className="w-4.5 h-4.5" />
          </button>

          <button
            id="toolbar-align-justify"
            type="button"
            onClick={() => editor.chain().focus().setTextAlign('justify').run()}
            className={`min-w-[40px] min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive({ textAlign: 'justify' })
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Justificar"
            aria-label="Justificar"
          >
            <AlignJustify className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="h-5 w-[1px] bg-[#e4e2dd] mx-0.5 shrink-0" />

        {/* Grupo 5: Listas e Checklists */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Lista com Marcadores */}
          <button
            id="toolbar-bullet-list"
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`min-w-[40px] min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive('bulletList')
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Lista com Marcadores"
            aria-label="Lista com Marcadores"
          >
            <List className="w-4.5 h-4.5" />
          </button>

          {/* Lista Numerada */}
          <button
            id="toolbar-ordered-list"
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`min-w-[40px] min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive('orderedList')
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Lista Numerada"
            aria-label="Lista Numerada"
          >
            <ListOrdered className="w-4.5 h-4.5" />
          </button>

          {/* Checklist / Task List */}
          <button
            id="toolbar-task-list"
            type="button"
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            className={`min-w-[40px] min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive('taskList')
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Lista de Tarefas (Checklist)"
            aria-label="Lista de Tarefas"
          >
            <CheckSquare className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="h-5 w-[1px] bg-[#e4e2dd] mx-0.5 shrink-0" />

        {/* Grupo 6: Toggle / Details */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            id="toolbar-toggle-details"
            type="button"
            onClick={() => editor.commands.setToggleDetails()}
            className={`min-w-[40px] min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              isInsideToggle
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Bloco de Alternância (Toggle / Recolhível)"
            aria-label="Bloco de Alternância"
          >
            <ChevronRight className="w-4.5 h-4.5" />
          </button>

          {isInsideToggle && (
            <button
              id="toolbar-delete-toggle-btn"
              type="button"
              onClick={() => editor.commands.deleteToggleDetails()}
              className="min-w-[40px] min-h-[40px] p-2 text-[#ba1a1a] hover:bg-[#fceded] rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95"
              title="Excluir Toggle atual"
              aria-label="Excluir Toggle"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="h-5 w-[1px] bg-[#e4e2dd] mx-0.5 shrink-0" />

        {/* Grupo 7: Menu Unificado "+ Arquivo" */}
        <button
          ref={addFileBtnRef}
          id="toolbar-btn-add-file"
          type="button"
          disabled={isUploading}
          onClick={toggleAddFileMenu}
          className="min-h-[40px] flex items-center gap-1.5 px-3.5 py-1.5 bg-[#68594d] text-white hover:bg-[#574a40] rounded-xl text-xs font-sans-ui font-medium transition-all shadow-xs cursor-pointer active:scale-95 shrink-0"
          title="Adicionar Arquivo (Imagem, PDF, YouTube)"
        >
          {isUploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4 stroke-[2.5]" />
          )}
          <span>Arquivo</span>
          <ChevronDown className="w-3.5 h-3.5 text-white/80" />
        </button>
      </nav>

      {/* POPOVER FLUTUANTE 1: MARCA-TEXTO (Renderizado fixo ACIMA da toolbar) */}
      {showHighlightPicker && popoverCoords && (
        <div
          ref={highlightPopoverRef}
          id="toolbar-highlight-popover"
          style={{
            position: 'fixed',
            bottom: `${popoverCoords.bottom}px`,
            left: `clamp(140px, ${popoverCoords.left}px, calc(100vw - 140px))`,
            transform: 'translateX(-50%)',
          }}
          className="bg-white border border-[#e4e2dd] p-2 rounded-xl shadow-xl flex items-center gap-1.5 z-50 animate-in fade-in zoom-in-95"
        >
          {highlightPastels.map((h) => (
            <button
              key={h.color}
              type="button"
              title={h.label}
              onClick={() => {
                editor.chain().focus().toggleHighlight({ color: h.color }).run();
                setShowHighlightPicker(false);
              }}
              className="w-5 h-5 rounded-full border border-black/15 transition-transform hover:scale-125 cursor-pointer shadow-2xs"
              style={{ backgroundColor: h.color }}
            />
          ))}

          {/* Opção Multicolor / Personalizada */}
          <label
            title="Cor personalizada (Multicolor)"
            className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer border border-[#d1c4bc] bg-conic-gradient hover:scale-125 transition-transform overflow-hidden relative"
            style={{
              background:
                'conic-gradient(from 0deg, red, yellow, green, cyan, blue, magenta, red)',
            }}
          >
            <input
              type="color"
              onChange={(e) => {
                editor.chain().focus().toggleHighlight({ color: e.target.value }).run();
                setShowHighlightPicker(false);
              }}
              className="opacity-0 absolute inset-0 cursor-pointer w-full h-full"
            />
          </label>

          <div className="h-4 w-[1px] bg-[#e4e2dd]" />

          <button
            type="button"
            title="Remover marca-texto"
            onClick={() => {
              editor.chain().focus().unsetHighlight().run();
              setShowHighlightPicker(false);
            }}
            className="px-1.5 py-0.5 text-[11px] text-[#ba1a1a] hover:bg-[#fceded] rounded font-sans-ui transition-colors cursor-pointer"
          >
            Limpar
          </button>
        </div>
      )}

      {/* POPOVER FLUTUANTE 2: COR DO TEXTO (Renderizado fixo ACIMA da toolbar) */}
      {showColorPicker && popoverCoords && (
        <div
          ref={colorPopoverRef}
          id="toolbar-color-popover"
          style={{
            position: 'fixed',
            bottom: `${popoverCoords.bottom}px`,
            left: `clamp(140px, ${popoverCoords.left}px, calc(100vw - 140px))`,
            transform: 'translateX(-50%)',
          }}
          className="bg-white border border-[#e4e2dd] p-2 rounded-xl shadow-xl flex items-center gap-1.5 z-50 animate-in fade-in zoom-in-95"
        >
          {textColors.map((c) => (
            <button
              key={c.color}
              type="button"
              title={c.label}
              onClick={() => {
                editor.chain().focus().setColor(c.color).run();
                setShowColorPicker(false);
              }}
              className="w-5 h-5 rounded-full border border-black/15 transition-transform hover:scale-125 cursor-pointer shadow-2xs"
              style={{ backgroundColor: c.color }}
            />
          ))}

          {/* Opção Multicolor / Personalizada */}
          <label
            title="Cor personalizada (Multicolor)"
            className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer border border-[#d1c4bc] hover:scale-125 transition-transform overflow-hidden relative"
            style={{
              background:
                'conic-gradient(from 0deg, red, yellow, green, cyan, blue, magenta, red)',
            }}
          >
            <input
              type="color"
              onChange={(e) => {
                editor.chain().focus().setColor(e.target.value).run();
                setShowColorPicker(false);
              }}
              className="opacity-0 absolute inset-0 cursor-pointer w-full h-full"
            />
          </label>

          <div className="h-4 w-[1px] bg-[#e4e2dd]" />

          <button
            type="button"
            title="Cor padrão"
            onClick={() => {
              editor.chain().focus().unsetColor().run();
              setShowColorPicker(false);
            }}
            className="px-1.5 py-0.5 text-[11px] text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#f0eee9] rounded font-sans-ui transition-colors cursor-pointer"
          >
            Padrão
          </button>
        </div>
      )}

      {/* POPOVER FLUTUANTE 3: + ARQUIVO (Renderizado fixo ACIMA da toolbar) */}
      {showAddFileMenu && popoverCoords && (
        <div
          ref={addFilePopoverRef}
          id="toolbar-add-file-dropdown"
          style={{
            position: 'fixed',
            bottom: `${popoverCoords.bottom}px`,
            left: `clamp(110px, ${popoverCoords.left}px, calc(100vw - 110px))`,
            transform: 'translateX(-50%)',
          }}
          className="bg-white border border-[#e4e2dd] p-1.5 rounded-xl shadow-xl flex flex-col gap-1 min-w-[190px] z-50 animate-in fade-in zoom-in-95 font-sans-ui"
        >
          {/* Opção 1: Imagem */}
          <button
            type="button"
            onClick={() => {
              setShowAddFileMenu(false);
              imageInputRef.current?.click();
            }}
            className="flex items-center gap-2.5 px-3 py-2 text-xs text-[#1b1c19] hover:bg-[#f0eee9] rounded-lg transition-colors cursor-pointer text-left"
          >
            <div className="w-6 h-6 rounded-md bg-[#68594d]/10 text-[#68594d] flex items-center justify-center shrink-0">
              <ImageIcon className="w-3.5 h-3.5" />
            </div>
            <div>
              <span className="font-medium block">Imagem</span>
              <span className="text-[10px] text-[#7f756e] block">
                Upload do computador
              </span>
            </div>
          </button>

          {/* Opção 2: Documento / PDF */}
          <button
            type="button"
            onClick={() => {
              setShowAddFileMenu(false);
              docInputRef.current?.click();
            }}
            className="flex items-center gap-2.5 px-3 py-2 text-xs text-[#1b1c19] hover:bg-[#f0eee9] rounded-lg transition-colors cursor-pointer text-left"
          >
            <div className="w-6 h-6 rounded-md bg-[#ba1a1a]/10 text-[#ba1a1a] flex items-center justify-center shrink-0">
              <FileText className="w-3.5 h-3.5" />
            </div>
            <div>
              <span className="font-medium block">Documento / PDF</span>
              <span className="text-[10px] text-[#7f756e] block">
                Anexar arquivo
              </span>
            </div>
          </button>

          <div className="h-[1px] bg-[#e4e2dd] my-0.5" />

          {/* Opção 3: YouTube */}
          <button
            type="button"
            onClick={() => {
              setShowAddFileMenu(false);
              setShowYoutubeModal(true);
            }}
            className="flex items-center gap-2.5 px-3 py-2 text-xs text-[#1b1c19] hover:bg-[#f0eee9] rounded-lg transition-colors cursor-pointer text-left"
          >
            <div className="w-6 h-6 rounded-md bg-[#ba1a1a]/10 text-[#ba1a1a] flex items-center justify-center shrink-0">
              <YoutubeIcon className="w-3.5 h-3.5" />
            </div>
            <div>
              <span className="font-medium block">Vídeo do YouTube</span>
              <span className="text-[10px] text-[#7f756e] block">
                Incorporar por link
              </span>
            </div>
          </button>
        </div>
      )}

      {/* Popover / Modal Compacto para Link do YouTube */}
      {showYoutubeModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#fbf9f4] border border-[#e4e2dd] rounded-2xl p-5 max-w-md w-full shadow-xl space-y-4 animate-in fade-in zoom-in-95 font-sans-ui"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <YoutubeIcon className="w-5 h-5 text-[#ba1a1a]" />
                <h3 className="font-serif-note font-bold text-lg text-[#1b1c19]">
                  Inserir Vídeo do YouTube
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowYoutubeModal(false)}
                className="text-[#7f756e] hover:text-[#1b1c19] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleYoutubeSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#4e453f] mb-1">
                  Cole o link do vídeo do YouTube:
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  className="w-full bg-white border border-[#d1c4bc] rounded-xl px-3.5 py-2 text-sm text-[#1b1c19] focus:outline-none focus:border-[#68594d]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowYoutubeModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-[#4e453f] hover:bg-[#e4e2dd] transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-medium bg-[#68594d] text-white hover:bg-[#574a40] transition-colors cursor-pointer shadow-xs"
                >
                  Inserir Vídeo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

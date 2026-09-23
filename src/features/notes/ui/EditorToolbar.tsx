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
  List as ListIcon,
  ChevronRight,
  Undo,
  Redo,
  Image as ImageIcon,
  FileText,
  Youtube as YoutubeIcon,
  Paperclip,
  ChevronDown,
  Link as LinkIcon,
  X,
  Loader2,
} from 'lucide-react';
import { uploadNoteFile } from '../api/storage-api';
import { createClient } from '@/src/features/auth/api/supabase-client';
import { useMobileKeyboardViewport } from '../hooks/useMobileKeyboardViewport';
import { normalizeUrl } from '../editor/utils/url-helper';
import { TextLevelDropdown } from './TextLevelDropdown';

interface EditorToolbarProps {
  editor: Editor | null;
  activeNoteId?: string | null;
  userId?: string | null;
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
  '56px',
  '64px',
  '72px',
] as const;

export function EditorToolbar({ editor, activeNoteId, userId: propUserId }: EditorToolbarProps) {
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showListMenu, setShowListMenu] = useState(false);
  const [showAddFileMenu, setShowAddFileMenu] = useState(false);
  const [showYoutubeModal, setShowYoutubeModal] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkModalUrl, setLinkModalUrl] = useState('');
  const [linkModalText, setLinkModalText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [, setSelectionUpdate] = useState(0);

  // Estados para cor personalizada de texto e marca-texto
  const [showCustomTextColor, setShowCustomTextColor] = useState(false);
  const [customTextColorHex, setCustomTextColorHex] = useState('#68594d');
  const customTextColorInputRef = useRef<HTMLInputElement>(null);

  const [showCustomHighlight, setShowCustomHighlight] = useState(false);
  const [customHighlightHex, setCustomHighlightHex] = useState('#fef08a');
  const customHighlightInputRef = useRef<HTMLInputElement>(null);

  const effectiveUserId = propUserId && propUserId !== 'anonymous' ? propUserId : authUserId;

  const footerRef = useRef<HTMLElement>(null);
  const { isKeyboardOpen, toolbarStyle } = useMobileKeyboardViewport(footerRef);

  // Coordenadas calculadas para os popovers flutuantes livres
  const [popoverCoords, setPopoverCoords] = useState<{ bottom: number; left: number } | null>(null);

  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const highlightBtnRef = useRef<HTMLButtonElement>(null);
  const listBtnRef = useRef<HTMLButtonElement>(null);
  const addFileBtnRef = useRef<HTMLButtonElement>(null);

  const colorPopoverRef = useRef<HTMLDivElement>(null);
  const highlightPopoverRef = useRef<HTMLDivElement>(null);
  const listPopoverRef = useRef<HTMLDivElement>(null);
  const addFilePopoverRef = useRef<HTMLDivElement>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (propUserId && propUserId !== 'anonymous') return;
    let isCancelled = false;
    const supabase = createClient();
    const fetchUser = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (isCancelled) return;
        if (sessionData?.session?.user?.id) {
          setAuthUserId(sessionData.session.user.id);
          return;
        }
        const { data: userData } = await supabase.auth.getUser();
        if (isCancelled) return;
        if (userData?.user?.id) {
          setAuthUserId(userData.user.id);
        }
      } catch (e) {
        console.warn('[EditorToolbar] Falha ao verificar autenticação:', e);
      }
    };
    fetchUser();
    return () => {
      isCancelled = true;
    };
  }, [propUserId]);

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

  // Evita sobreposição visual e fecha menus auxiliares quando o usuário clica de volta no canvas ou em outro controle
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const isOutside = (popover: HTMLDivElement | null, btn: HTMLButtonElement | null) =>
        Boolean(popover && !popover.contains(target) && btn && !btn.contains(target));

      if (isOutside(colorPopoverRef.current, colorBtnRef.current)) {
        setShowColorPicker(false);
        setShowCustomTextColor(false);
      }
      if (isOutside(highlightPopoverRef.current, highlightBtnRef.current)) {
        setShowHighlightPicker(false);
        setShowCustomHighlight(false);
      }
      if (isOutside(listPopoverRef.current, listBtnRef.current)) setShowListMenu(false);
      if (isOutside(addFilePopoverRef.current, addFileBtnRef.current)) setShowAddFileMenu(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  if (!editor) {
    return null;
  }

  // Utilitários de normalização de cor Hexadecimal
  const normalizeHexColor = (input: string): string | null => {
    let hex = input.trim();
    if (!hex) return null;
    if (!hex.startsWith('#')) {
      hex = `#${hex}`;
    }
    // #rgb -> #rrggbb
    if (/^#[0-9A-Fa-f]{3}$/.test(hex)) {
      return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toLowerCase();
    }
    // #rrggbb
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      return hex.toLowerCase();
    }
    // #rrggbbaa
    if (/^#[0-9A-Fa-f]{8}$/.test(hex)) {
      return hex.toLowerCase();
    }
    return null;
  };

  const formatToFullHex = (input: string, fallback: string = '#68594d'): string => {
    const norm = normalizeHexColor(input);
    if (norm && norm.length === 7) return norm;
    return fallback;
  };

  // Paleta de Cores do Texto (Tons Clássicos de Tinta e Editoriais)
  const textColors = [
    { label: 'Sépia Clássica', color: '#68594d' },
    { label: 'Café Profundo', color: '#4a3728' },
    { label: 'Carmim Nobre', color: '#ba1a1a' },
    { label: 'Azul Noite', color: '#1e3a8a' },
    { label: 'Verde Floresta', color: '#14532d' },
    { label: 'Terracota', color: '#ea580c' },
    { label: 'Cinza Grafite', color: '#64748b' },
  ];

  // Paleta de Marca-Texto (Pastéis Suaves)
  const highlightPastels = [
    { label: 'Amarelo Suave', color: '#fef08a' },
    { label: 'Verde Menta', color: '#bbf7d0' },
    { label: 'Rosa Pergaminho', color: '#fecdd3' },
    { label: 'Azul Céu', color: '#bfdbfe' },
    { label: 'Lilás Suave', color: '#e9d5ff' },
    { label: 'Laranja Pêssego', color: '#fed7aa' },
  ];

  // Disparadores de Popover com cálculo de posição acima da toolbar
  const togglePopover = (
    currentIsOpen: boolean,
    btnRef: React.RefObject<HTMLButtonElement | null>,
    popoverKey: 'color' | 'highlight' | 'list' | 'addFile'
  ) => {
    if (!currentIsOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPopoverCoords({
        bottom: window.innerHeight - rect.top + 8,
        left: rect.left + rect.width / 2,
      });
      setShowColorPicker(popoverKey === 'color');
      setShowHighlightPicker(popoverKey === 'highlight');
      setShowListMenu(popoverKey === 'list');
      setShowAddFileMenu(popoverKey === 'addFile');
      if (popoverKey !== 'color') setShowCustomTextColor(false);
      if (popoverKey !== 'highlight') setShowCustomHighlight(false);
    } else {
      if (popoverKey === 'color') {
        setShowColorPicker(false);
        setShowCustomTextColor(false);
      }
      if (popoverKey === 'highlight') {
        setShowHighlightPicker(false);
        setShowCustomHighlight(false);
      }
      if (popoverKey === 'list') setShowListMenu(false);
      if (popoverKey === 'addFile') setShowAddFileMenu(false);
    }
  };

  const toggleColorPicker = () => {
    const currentColor = editor.getAttributes('textStyle').color;
    if (currentColor) {
      setCustomTextColorHex(currentColor);
    }
    togglePopover(showColorPicker, colorBtnRef, 'color');
  };

  const toggleHighlightPicker = () => {
    const currentHighlight = editor.getAttributes('highlight').color;
    if (currentHighlight) {
      setCustomHighlightHex(currentHighlight);
    }
    togglePopover(showHighlightPicker, highlightBtnRef, 'highlight');
  };

  const applyCustomTextColor = (colorOverride?: string) => {
    const val = colorOverride || customTextColorHex;
    const normalized = normalizeHexColor(val);
    if (normalized) {
      editor.chain().focus().setColor(normalized).run();
      setShowColorPicker(false);
      setShowCustomTextColor(false);
    }
  };

  const applyCustomHighlight = (colorOverride?: string) => {
    const val = colorOverride || customHighlightHex;
    const normalized = normalizeHexColor(val);
    if (normalized) {
      editor.chain().focus().setHighlight({ color: normalized }).run();
      setShowHighlightPicker(false);
      setShowCustomHighlight(false);
    }
  };
  const toggleListMenu = () => togglePopover(showListMenu, listBtnRef, 'list');
  const toggleAddFileMenu = () => togglePopover(showAddFileMenu, addFileBtnRef, 'addFile');

  // Escala de Tamanho de Fonte Progressiva
  const handleIncreaseFontSize = () => {
    const currentSize = editor.getAttributes('textStyle').fontSize || '16px';
    const currentIndex = FONT_SIZES.indexOf(currentSize as (typeof FONT_SIZES)[number]);
    const nextIndex =
      currentIndex === -1 ? 7 : Math.min(currentIndex + 1, FONT_SIZES.length - 1);
    editor.chain().focus().setMark('textStyle', { fontSize: FONT_SIZES[nextIndex] }).run();
  };

  const handleDecreaseFontSize = () => {
    const currentSize = editor.getAttributes('textStyle').fontSize || '16px';
    const currentIndex = FONT_SIZES.indexOf(currentSize as (typeof FONT_SIZES)[number]);
    const prevIndex = currentIndex === -1 ? 5 : Math.max(0, currentIndex - 1);
    editor.chain().focus().setMark('textStyle', { fontSize: FONT_SIZES[prevIndex] }).run();
  };

  // Upload e inserção de imagem (sequencial / estruturado para múltiplas imagens)
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      setIsUploading(true);
      setShowAddFileMenu(false);

      // Validação rigorosa de autenticação antes do upload
      let authUid: string | null = effectiveUserId;
      const supabase = createClient();
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user?.id) {
          authUid = sessionData.session.user.id;
        } else {
          const { data: userData } = await supabase.auth.getUser();
          if (userData?.user?.id) {
            authUid = userData.user.id;
          }
        }
      } catch (authErr) {
        console.warn('[EditorToolbar] Falha ao checar auth:', authErr);
      }

      if (!authUid && typeof window !== 'undefined') {
        const cached = localStorage.getItem('anotado_last_auth_user_id');
        if (cached && cached !== 'anonymous') authUid = cached;
      }

      if (!authUid || authUid === 'anonymous') {
        console.error('[Attachment] AUTH CHECK FAILED: Nenhuma sessão de usuário autenticado encontrada para upload.');
        alert('Usuário não autenticado. Faça login para fazer upload de arquivos.');
        return;
      }

      const fileList = Array.from(files);
      for (const file of fileList) {
        // 1. Upload do arquivo para fila local / IndexedDB do usuário autenticado
        const result = await uploadNoteFile(authUid, file, activeNoteId || undefined);
        // 2. Insere a referência canônica (attachment://) no documento Tiptap
        editor.chain().focus().setImage({ src: result.url, alt: result.name }).run();
      }
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

      // Validação rigorosa de autenticação antes do upload
      let authUid: string | null = effectiveUserId;
      const supabase = createClient();
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user?.id) {
          authUid = sessionData.session.user.id;
        } else {
          const { data: userData } = await supabase.auth.getUser();
          if (userData?.user?.id) {
            authUid = userData.user.id;
          }
        }
      } catch (authErr) {
        console.warn('[EditorToolbar] Falha ao checar auth:', authErr);
      }

      if (!authUid && typeof window !== 'undefined') {
        const cached = localStorage.getItem('anotado_last_auth_user_id');
        if (cached && cached !== 'anonymous') authUid = cached;
      }

      if (!authUid || authUid === 'anonymous') {
        console.error('[Attachment] AUTH CHECK FAILED: Nenhuma sessão de usuário autenticado encontrada para upload.');
        alert('Usuário não autenticado. Faça login para fazer upload de arquivos.');
        return;
      }

      const result = await uploadNoteFile(authUid, file, activeNoteId || undefined);
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

  // Abrir Modal de Link
  const handleOpenLinkModal = () => {
    const { from, to, empty } = editor.state.selection;
    const selectedText = empty ? '' : editor.state.doc.textBetween(from, to, ' ');
    const currentLinkHref = editor.getAttributes('link').href || '';
    setLinkModalText(selectedText || '');
    setLinkModalUrl(currentLinkHref || '');
    setShowAddFileMenu(false);
    setShowLinkModal(true);
  };

  // Inserção / Aplicação de Link via Modal
  const handleLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = linkModalUrl.trim();
    if (!url) return;

    const normalized = normalizeUrl(url);
    const displayText = linkModalText.trim() || url;

    const { empty } = editor.state.selection;
    if (!empty) {
      if (linkModalText.trim()) {
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'text',
            text: displayText,
            marks: [{ type: 'link', attrs: { href: normalized } }],
          })
          .run();
      } else {
        editor.chain().focus().setLink({ href: normalized }).run();
      }
    } else {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'text',
          text: displayText,
          marks: [{ type: 'link', attrs: { href: normalized } }],
        })
        .run();
    }

    setLinkModalUrl('');
    setLinkModalText('');
    setShowLinkModal(false);
  };

  // Estilo padrão uniforme para os botões da toolbar (sem estado ativo permanente)
  const neutralBtnClass =
    'min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] p-2 rounded-xl flex items-center justify-center text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] active:bg-[#e4e2dd] active:scale-95 transition-all cursor-pointer';

  return (
    <footer
      ref={footerRef as React.RefObject<HTMLElement>}
      id="editor-toolbar-footer-container"
      style={toolbarStyle}
      className={`w-full flex justify-center px-2 sm:px-4 py-2 shrink-0 select-none z-30 max-w-full overflow-hidden ${
        isKeyboardOpen ? 'pointer-events-auto shadow-2xl' : ''
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
          multiple
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

        {/* 1. HISTÓRICO — [ Desfazer | Refazer ] */}
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          <button
            id="toolbar-btn-undo"
            type="button"
            disabled={!editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
            className={`min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.can().undo()
                ? 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
                : 'text-[#d1c4bc] cursor-not-allowed opacity-40'
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
            className={`min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.can().redo()
                ? 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
                : 'text-[#d1c4bc] cursor-not-allowed opacity-40'
            }`}
            title="Refazer (Ctrl+Shift+Z)"
            aria-label="Refazer"
          >
            <Redo className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="h-5 w-[1px] bg-[#e4e2dd] mx-0.5 shrink-0" />

        {/* 2. FORMATAÇÃO — [ B | I | U | S | A | A↓ | A↑ ] */}
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          <button
            id="toolbar-btn-bold"
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={neutralBtnClass}
            title="Negrito (Ctrl+B)"
            aria-label="Negrito"
          >
            <Bold className="w-4.5 h-4.5" />
          </button>

          <button
            id="toolbar-btn-italic"
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={neutralBtnClass}
            title="Itálico (Ctrl+I)"
            aria-label="Itálico"
          >
            <Italic className="w-4.5 h-4.5" />
          </button>

          <button
            id="toolbar-btn-underline"
            type="button"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={neutralBtnClass}
            title="Sublinhado (Ctrl+U)"
            aria-label="Sublinhado"
          >
            <Underline className="w-4.5 h-4.5" />
          </button>

          <button
            id="toolbar-btn-strike"
            type="button"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={neutralBtnClass}
            title="Tachado"
            aria-label="Tachado"
          >
            <Strikethrough className="w-4.5 h-4.5" />
          </button>

          {/* Ferramenta Nível de Texto (Título, Subtítulo, Parágrafo, Corpo) */}
          <TextLevelDropdown
            editor={editor}
            variant="bottom"
            id="toolbar-btn-text-styles"
          />

          {/* Tamanho da Fonte (A↓ / A↑) */}
          <button
            id="toolbar-btn-decrease-fontsize"
            type="button"
            onClick={handleDecreaseFontSize}
            className="min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] px-2 text-xs font-sans-ui font-bold text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] active:bg-[#e4e2dd] rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95"
            title="Diminuir tamanho da fonte (A↓)"
            aria-label="Diminuir tamanho da fonte"
          >
            A↓
          </button>
          <button
            id="toolbar-btn-increase-fontsize"
            type="button"
            onClick={handleIncreaseFontSize}
            className="min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] px-2 text-xs font-sans-ui font-bold text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] active:bg-[#e4e2dd] rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95"
            title="Aumentar tamanho da fonte (A↑)"
            aria-label="Aumentar tamanho da fonte"
          >
            A↑
          </button>
        </div>

        <div className="h-5 w-[1px] bg-[#e4e2dd] mx-0.5 shrink-0" />

        {/* 3. CORES — [ Cor do texto | Marca-texto ] */}
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          {/* Cor do Texto (Text Color) */}
          <button
            ref={colorBtnRef}
            id="toolbar-btn-color"
            type="button"
            onClick={toggleColorPicker}
            className={`min-h-[40px] px-2 py-1.5 rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer active:scale-95 ${
              showColorPicker
                ? 'bg-[#f0eee9] text-[#1b1c19]'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Cor do Texto"
            aria-label="Cor do Texto"
          >
            <Palette className="w-4.5 h-4.5" />
            <ChevronDown className="w-3 h-3 text-[#7f756e]" />
          </button>

          {/* Marca-Texto (Highlight) */}
          <button
            ref={highlightBtnRef}
            id="toolbar-btn-highlight"
            type="button"
            onClick={toggleHighlightPicker}
            className={`min-h-[40px] px-2 py-1.5 rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer active:scale-95 ${
              showHighlightPicker
                ? 'bg-[#f0eee9] text-[#1b1c19]'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Marca-texto"
            aria-label="Marca-texto"
          >
            <Highlighter className="w-4.5 h-4.5" />
            <ChevronDown className="w-3 h-3 text-[#7f756e]" />
          </button>
        </div>

        <div className="h-5 w-[1px] bg-[#e4e2dd] mx-0.5 shrink-0" />

        {/* 4. ALINHAMENTOS — [ Esquerda | Centralizar | Direita | Justificar ] */}
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          <button
            id="toolbar-align-left"
            type="button"
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            className={neutralBtnClass}
            title="Alinhar à Esquerda"
            aria-label="Alinhar à Esquerda"
          >
            <AlignLeft className="w-4.5 h-4.5" />
          </button>

          <button
            id="toolbar-align-center"
            type="button"
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            className={neutralBtnClass}
            title="Centralizar"
            aria-label="Centralizar"
          >
            <AlignCenter className="w-4.5 h-4.5" />
          </button>

          <button
            id="toolbar-align-right"
            type="button"
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            className={neutralBtnClass}
            title="Alinhar à Direita"
            aria-label="Alinhar à Direita"
          >
            <AlignRight className="w-4.5 h-4.5" />
          </button>

          <button
            id="toolbar-align-justify"
            type="button"
            onClick={() => editor.chain().focus().setTextAlign('justify').run()}
            className={neutralBtnClass}
            title="Justificar"
            aria-label="Justificar"
          >
            <AlignJustify className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="h-5 w-[1px] bg-[#e4e2dd] mx-0.5 shrink-0" />

        {/* 5. LISTAS / ESTRUTURA — [ Listas | Toggle | Checklist ] */}
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          {/* Botão ÚNICO: Listas (Abre popover com Marcadores, Numerada, Traços) */}
          <button
            ref={listBtnRef}
            id="toolbar-btn-lists"
            type="button"
            onClick={toggleListMenu}
            className={`min-h-[40px] px-2 py-1.5 rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer active:scale-95 ${
              showListMenu
                ? 'bg-[#f0eee9] text-[#1b1c19]'
                : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
            }`}
            title="Listas (Marcadores, Numerada, Traços)"
            aria-label="Listas"
          >
            <ListIcon className="w-4.5 h-4.5" />
            <ChevronDown className="w-3 h-3 text-[#7f756e]" />
          </button>

          {/* Bloco de Alternância (Toggle) */}
          <button
            id="toolbar-toggle-details"
            type="button"
            onClick={() => editor.commands.setDetails()}
            className={neutralBtnClass}
            title="Bloco de Alternância (Toggle / Recolhível)"
            aria-label="Bloco de Alternância"
          >
            <ChevronRight className="w-4.5 h-4.5" />
          </button>

          {/* Checklist (Ícone fiel à bolinha da nota) */}
          <button
            id="toolbar-task-list"
            type="button"
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            className={neutralBtnClass}
            title="Lista de Tarefas (Checklist)"
            aria-label="Lista de Tarefas"
          >
            <svg
              className="w-4.5 h-4.5"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
            >
              <circle cx="10" cy="10" r="7.5" strokeWidth="1.75" />
              <path
                d="M7 10.2L9 12.2L13.5 7.8"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div className="h-5 w-[1px] bg-[#e4e2dd] mx-0.5 shrink-0" />

        {/* 6. ANEXO — [ 📎 ] */}
        <button
          ref={addFileBtnRef}
          id="toolbar-btn-add-file"
          type="button"
          disabled={isUploading}
          onClick={toggleAddFileMenu}
          className={`min-w-[40px] min-h-[40px] p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 shrink-0 ${
            showAddFileMenu
              ? 'bg-[#f0eee9] text-[#1b1c19]'
              : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
          }`}
          title="Anexar ou Inserir Mídia (Imagem, PDF/Documento, Vídeo)"
          aria-label="Anexar ou Inserir Mídia"
        >
          {isUploading ? (
            <Loader2 className="w-4.5 h-4.5 animate-spin text-[#68594d]" />
          ) : (
            <Paperclip className="w-4.5 h-4.5 stroke-[2.25]" />
          )}
        </button>
      </nav>

      {/* POPOVER FLUTUANTE: COR DO TEXTO */}
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
          className="bg-white border border-[#e4e2dd] p-2.5 rounded-2xl shadow-xl flex flex-col gap-2 z-50 animate-in fade-in zoom-in-95 font-sans-ui min-w-[260px]"
        >
          {/* Cores Predefinidas */}
          <div className="flex items-center justify-between gap-1.5">
            {/* Opção 1: Cor Padrão (Círculo Vazio ○) */}
            <button
              type="button"
              id="color-opt-default"
              onClick={() => {
                editor.chain().focus().unsetColor().run();
                setShowColorPicker(false);
                setShowCustomTextColor(false);
              }}
              className="w-7 h-7 rounded-full border-2 border-dashed border-[#7f756e]/50 hover:border-[#1b1c19] flex items-center justify-center transition-transform hover:scale-110 cursor-pointer shrink-0"
              title="Cor Padrão (Sem cor personalizada)"
              aria-label="Cor Padrão"
            >
              <span className="text-[10px] text-[#7f756e] font-bold leading-none">○</span>
            </button>

            {/* Cores Editoriais */}
            {textColors.map((c) => (
              <button
                key={c.color}
                id={`color-opt-${c.color.replace('#', '')}`}
                type="button"
                onClick={() => {
                  editor.chain().focus().setColor(c.color).run();
                  setShowColorPicker(false);
                  setShowCustomTextColor(false);
                }}
                className="w-7 h-7 rounded-full border border-black/10 transition-transform hover:scale-110 cursor-pointer shadow-2xs shrink-0"
                style={{ backgroundColor: c.color }}
                title={c.label}
                aria-label={c.label}
              />
            ))}
          </div>

          {/* Divisória Editorial */}
          <div className="h-[1px] bg-[#e4e2dd] -mx-0.5" />

          {/* Seção Mais cores... */}
          {!showCustomTextColor ? (
            <button
              type="button"
              id="color-btn-more-colors"
              onClick={() => {
                setShowCustomTextColor(true);
                customTextColorInputRef.current?.click();
              }}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-xl text-xs text-[#4e453f] hover:text-[#1b1c19] hover:bg-[#f0eee9] transition-colors cursor-pointer font-medium"
            >
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-gradient-to-tr from-rose-500 via-amber-400 via-emerald-400 via-blue-500 to-purple-600 border border-black/10 shrink-0 shadow-2xs" />
                <span>Mais cores...</span>
              </div>
              <ChevronDown className="w-3 h-3 text-[#7f756e]" />
            </button>
          ) : (
            <div className="flex items-center gap-2 pt-0.5 animate-in fade-in">
              {/* Seletor visual */}
              <label
                htmlFor="custom-text-color-input"
                className="relative w-7 h-7 rounded-full border border-black/15 shadow-2xs flex items-center justify-center cursor-pointer overflow-hidden shrink-0 hover:scale-105 transition-transform"
                title="Abrir paleta de cores"
              >
                <div
                  className="w-full h-full rounded-full"
                  style={{ backgroundColor: normalizeHexColor(customTextColorHex) || '#68594d' }}
                />
              </label>

              {/* Campo Hex */}
              <input
                type="text"
                value={customTextColorHex}
                onChange={(e) => {
                  let val = e.target.value.trim();
                  if (!val.startsWith('#') && val.length > 0) val = '#' + val;
                  setCustomTextColorHex(val);
                  const normalized = normalizeHexColor(val);
                  if (normalized) {
                    editor.chain().focus().setColor(normalized).run();
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyCustomTextColor();
                  }
                }}
                placeholder="#68594d"
                maxLength={9}
                className="flex-1 min-w-[70px] px-2 py-1 text-xs font-mono bg-[#fbf9f4] border border-[#e4e2dd] focus:border-[#68594d] rounded-lg focus:outline-none text-[#1b1c19]"
              />

              {/* Botão OK */}
              <button
                type="button"
                onClick={() => applyCustomTextColor()}
                className="px-2.5 py-1 text-xs bg-[#68594d] hover:bg-[#574a40] text-white rounded-lg font-medium transition-colors cursor-pointer shadow-2xs shrink-0"
              >
                OK
              </button>
            </div>
          )}

          {/* Input type="color" nativo */}
          <input
            ref={customTextColorInputRef}
            id="custom-text-color-input"
            type="color"
            value={formatToFullHex(customTextColorHex, '#68594d')}
            onChange={(e) => {
              const hex = e.target.value;
              setCustomTextColorHex(hex);
              editor.chain().focus().setColor(hex).run();
            }}
            className="sr-only"
          />
        </div>
      )}

      {/* POPOVER FLUTUANTE: MARCA-TEXTO */}
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
          className="bg-white border border-[#e4e2dd] p-2.5 rounded-2xl shadow-xl flex flex-col gap-2 z-50 animate-in fade-in zoom-in-95 font-sans-ui min-w-[260px]"
        >
          {/* Cores Pastéis Predefinidas */}
          <div className="flex items-center justify-between gap-1.5">
            {/* Opção 1: Sem marca-texto (Círculo Vazio ○) */}
            <button
              type="button"
              id="highlight-opt-none"
              onClick={() => {
                editor.chain().focus().unsetHighlight().run();
                setShowHighlightPicker(false);
                setShowCustomHighlight(false);
              }}
              className="w-7 h-7 rounded-full border-2 border-dashed border-[#7f756e]/50 hover:border-[#1b1c19] flex items-center justify-center transition-transform hover:scale-110 cursor-pointer shrink-0"
              title="Sem Marca-texto (Remover destaque)"
              aria-label="Sem Marca-texto"
            >
              <span className="text-[10px] text-[#7f756e] font-bold leading-none">○</span>
            </button>

            {/* Cores Pastéis */}
            {highlightPastels.map((h) => (
              <button
                key={h.color}
                id={`highlight-opt-${h.color.replace('#', '')}`}
                type="button"
                onClick={() => {
                  editor.chain().focus().setHighlight({ color: h.color }).run();
                  setShowHighlightPicker(false);
                  setShowCustomHighlight(false);
                }}
                className="w-7 h-7 rounded-full border border-black/10 transition-transform hover:scale-110 cursor-pointer shadow-2xs shrink-0"
                style={{ backgroundColor: h.color }}
                title={h.label}
                aria-label={h.label}
              />
            ))}
          </div>

          {/* Divisória Editorial */}
          <div className="h-[1px] bg-[#e4e2dd] -mx-0.5" />

          {/* Seção Mais cores... */}
          {!showCustomHighlight ? (
            <button
              type="button"
              id="highlight-btn-more-colors"
              onClick={() => {
                setShowCustomHighlight(true);
                customHighlightInputRef.current?.click();
              }}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-xl text-xs text-[#4e453f] hover:text-[#1b1c19] hover:bg-[#f0eee9] transition-colors cursor-pointer font-medium"
            >
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-gradient-to-tr from-amber-300 via-emerald-300 via-sky-300 via-purple-300 to-rose-300 border border-black/10 shrink-0 shadow-2xs" />
                <span>Mais cores...</span>
              </div>
              <ChevronDown className="w-3 h-3 text-[#7f756e]" />
            </button>
          ) : (
            <div className="flex items-center gap-2 pt-0.5 animate-in fade-in">
              {/* Seletor visual */}
              <label
                htmlFor="custom-highlight-color-input"
                className="relative w-7 h-7 rounded-full border border-black/15 shadow-2xs flex items-center justify-center cursor-pointer overflow-hidden shrink-0 hover:scale-105 transition-transform"
                title="Abrir paleta de cores"
              >
                <div
                  className="w-full h-full rounded-full"
                  style={{ backgroundColor: normalizeHexColor(customHighlightHex) || '#fef08a' }}
                />
              </label>

              {/* Campo Hex */}
              <input
                type="text"
                value={customHighlightHex}
                onChange={(e) => {
                  let val = e.target.value.trim();
                  if (!val.startsWith('#') && val.length > 0) val = '#' + val;
                  setCustomHighlightHex(val);
                  const normalized = normalizeHexColor(val);
                  if (normalized) {
                    editor.chain().focus().setHighlight({ color: normalized }).run();
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyCustomHighlight();
                  }
                }}
                placeholder="#fef08a"
                maxLength={9}
                className="flex-1 min-w-[70px] px-2 py-1 text-xs font-mono bg-[#fbf9f4] border border-[#e4e2dd] focus:border-[#68594d] rounded-lg focus:outline-none text-[#1b1c19]"
              />

              {/* Botão OK */}
              <button
                type="button"
                onClick={() => applyCustomHighlight()}
                className="px-2.5 py-1 text-xs bg-[#68594d] hover:bg-[#574a40] text-white rounded-lg font-medium transition-colors cursor-pointer shadow-2xs shrink-0"
              >
                OK
              </button>
            </div>
          )}

          {/* Input type="color" nativo */}
          <input
            ref={customHighlightInputRef}
            id="custom-highlight-color-input"
            type="color"
            value={formatToFullHex(customHighlightHex, '#fef08a')}
            onChange={(e) => {
              const hex = e.target.value;
              setCustomHighlightHex(hex);
              editor.chain().focus().setHighlight({ color: hex }).run();
            }}
            className="sr-only"
          />
        </div>
      )}

      {/* POPOVER FLUTUANTE: LISTAS (Marcadores •, Numerada 1., Traços —) */}
      {showListMenu && popoverCoords && (
        <div
          ref={listPopoverRef}
          id="toolbar-list-menu-popover"
          style={{
            position: 'fixed',
            bottom: `${popoverCoords.bottom}px`,
            left: `clamp(110px, ${popoverCoords.left}px, calc(100vw - 110px))`,
            transform: 'translateX(-50%)',
          }}
          className="bg-white border border-[#e4e2dd] p-1.5 rounded-2xl shadow-xl flex flex-col gap-1 min-w-[210px] z-50 animate-in fade-in zoom-in-95 font-sans-ui"
        >
          {/* Opção 1: Marcadores • */}
          <button
            type="button"
            id="list-opt-bullet"
            onClick={() => {
              editor.chain().focus().toggleBulletList().run();
              setShowListMenu(false);
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#fbf9f4] text-[#4e453f] hover:text-[#1b1c19] transition-colors cursor-pointer text-left"
          >
            <span className="w-6 h-6 rounded-lg bg-[#f0eee9] flex items-center justify-center text-sm font-bold text-[#1b1c19] shrink-0">
              •
            </span>
            <span className="text-xs sm:text-sm font-medium">Lista de marcadores</span>
          </button>

          {/* Opção 2: Numerada 1. */}
          <button
            type="button"
            id="list-opt-ordered"
            onClick={() => {
              editor.chain().focus().toggleOrderedList().run();
              setShowListMenu(false);
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#fbf9f4] text-[#4e453f] hover:text-[#1b1c19] transition-colors cursor-pointer text-left"
          >
            <span className="w-6 h-6 rounded-lg bg-[#f0eee9] flex items-center justify-center text-xs font-bold text-[#1b1c19] shrink-0">
              1.
            </span>
            <span className="text-xs sm:text-sm font-medium">Lista numerada</span>
          </button>

          {/* Opção 3: Traços / Linha — */}
          <button
            type="button"
            id="list-opt-divider"
            onClick={() => {
              editor.chain().focus().setHorizontalRule().run();
              setShowListMenu(false);
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#fbf9f4] text-[#4e453f] hover:text-[#1b1c19] transition-colors cursor-pointer text-left"
          >
            <span className="w-6 h-6 rounded-lg bg-[#f0eee9] flex items-center justify-center text-sm font-bold text-[#1b1c19] shrink-0">
              —
            </span>
            <span className="text-xs sm:text-sm font-medium">Lista de traços</span>
          </button>
        </div>
      )}

      {/* POPOVER FLUTUANTE: ANEXO / MÍDIA */}
      {showAddFileMenu && popoverCoords && (
        <div
          ref={addFilePopoverRef}
          id="toolbar-add-file-popover"
          style={{
            position: 'fixed',
            bottom: `${popoverCoords.bottom}px`,
            left: `clamp(130px, ${popoverCoords.left}px, calc(100vw - 130px))`,
            transform: 'translateX(-50%)',
          }}
          className="bg-white border border-[#e4e2dd] p-1.5 rounded-2xl shadow-xl flex flex-col gap-1 min-w-[210px] z-50 animate-in fade-in zoom-in-95 font-sans-ui"
        >
          <button
            type="button"
            id="file-opt-image"
            onClick={() => {
              imageInputRef.current?.click();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#fbf9f4] text-[#4e453f] hover:text-[#1b1c19] transition-colors cursor-pointer text-left text-xs sm:text-sm"
          >
            <ImageIcon className="w-4 h-4 text-[#68594d]" />
            <span>Inserir Imagem</span>
          </button>

          <button
            type="button"
            id="file-opt-doc"
            onClick={() => {
              docInputRef.current?.click();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#fbf9f4] text-[#4e453f] hover:text-[#1b1c19] transition-colors cursor-pointer text-left text-xs sm:text-sm"
          >
            <FileText className="w-4 h-4 text-[#68594d]" />
            <span>Inserir PDF / Arquivo</span>
          </button>

          <button
            type="button"
            id="file-opt-youtube"
            onClick={() => {
              setShowAddFileMenu(false);
              setShowYoutubeModal(true);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#fbf9f4] text-[#4e453f] hover:text-[#1b1c19] transition-colors cursor-pointer text-left text-xs sm:text-sm"
          >
            <YoutubeIcon className="w-4 h-4 text-[#ba1a1a]" />
            <span>Inserir Vídeo do YouTube</span>
          </button>

          <button
            type="button"
            id="file-opt-link"
            onClick={handleOpenLinkModal}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#fbf9f4] text-[#4e453f] hover:text-[#1b1c19] transition-colors cursor-pointer text-left text-xs sm:text-sm"
          >
            <LinkIcon className="w-4 h-4 text-[#68594d]" />
            <span>Inserir Link</span>
          </button>
        </div>
      )}

      {/* MODAL DE INSERÇÃO DE VÍDEO DO YOUTUBE */}
      {showYoutubeModal && (
        <div
          id="youtube-insert-modal-backdrop"
          className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in"
          onClick={() => setShowYoutubeModal(false)}
        >
          <div
            id="youtube-insert-modal"
            className="bg-white border border-[#e4e2dd] p-5 rounded-2xl shadow-2xl max-w-md w-full font-sans-ui space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <YoutubeIcon className="w-5 h-5 text-[#ba1a1a]" />
                <h3 className="font-semibold text-sm sm:text-base text-[#1b1c19]">
                  Inserir Vídeo do YouTube
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowYoutubeModal(false)}
                className="p-1 text-[#7f756e] hover:text-[#1b1c19] rounded-lg hover:bg-[#eae8e3]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleYoutubeSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-[#7f756e] mb-1 font-medium">
                  URL ou Link do Vídeo
                </label>
                <input
                  type="url"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  autoFocus
                  required
                  className="w-full bg-[#fbf9f4] border border-[#e4e2dd] focus:border-[#68594d] rounded-xl px-3 py-2 text-xs sm:text-sm text-[#1b1c19] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowYoutubeModal(false)}
                  className="px-3.5 py-1.5 text-xs text-[#7f756e] hover:text-[#1b1c19] rounded-xl hover:bg-[#f0eee9] font-medium cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs bg-[#68594d] hover:bg-[#574a40] text-white rounded-xl font-medium shadow-xs cursor-pointer"
                >
                  Inserir Vídeo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE INSERÇÃO DE LINK */}
      {showLinkModal && (
        <div
          id="link-insert-modal-backdrop"
          className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in"
          onClick={() => setShowLinkModal(false)}
        >
          <div
            id="link-insert-modal"
            className="bg-white border border-[#e4e2dd] p-5 rounded-2xl shadow-2xl max-w-md w-full font-sans-ui space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LinkIcon className="w-5 h-5 text-[#68594d]" />
                <h3 className="font-semibold text-sm sm:text-base text-[#1b1c19]">
                  Inserir Link
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                className="p-1 text-[#7f756e] hover:text-[#1b1c19] rounded-lg hover:bg-[#eae8e3] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleLinkSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-[#7f756e] mb-1 font-medium">
                  URL / Endereço do Link *
                </label>
                <input
                  type="text"
                  placeholder="https://exemplo.com ou google.com"
                  value={linkModalUrl}
                  onChange={(e) => setLinkModalUrl(e.target.value)}
                  autoFocus
                  required
                  className="w-full bg-[#fbf9f4] border border-[#e4e2dd] focus:border-[#68594d] rounded-xl px-3 py-2 text-xs sm:text-sm text-[#1b1c19] focus:outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs text-[#7f756e] mb-1 font-medium">
                  Texto de Exibição (opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ex: Abrir Site"
                  value={linkModalText}
                  onChange={(e) => setLinkModalText(e.target.value)}
                  className="w-full bg-[#fbf9f4] border border-[#e4e2dd] focus:border-[#68594d] rounded-xl px-3 py-2 text-xs sm:text-sm text-[#1b1c19] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLinkModal(false)}
                  className="px-3.5 py-1.5 text-xs text-[#7f756e] hover:text-[#1b1c19] rounded-xl hover:bg-[#f0eee9] font-medium cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs bg-[#68594d] hover:bg-[#574a40] text-white rounded-xl font-medium shadow-xs cursor-pointer"
                >
                  Inserir Link
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </footer>
  );
}

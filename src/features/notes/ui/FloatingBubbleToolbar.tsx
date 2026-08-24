'use client';

import React, { useState, useEffect, useRef } from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  ChevronDown,
  ArrowDown,
  ArrowUp,
  Link as LinkIcon,
  ExternalLink,
  Pencil,
  Unlink,
  Check,
  X,
} from 'lucide-react';
import { normalizeUrl } from '../editor/utils/url-helper';

interface FloatingBubbleToolbarProps {
  editor: Editor;
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

export function FloatingBubbleToolbar({ editor }: FloatingBubbleToolbarProps) {
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const [dropdownPlacement, setDropdownPlacement] = useState<'top' | 'bottom'>('top');
  const [isEditingLink, setIsEditingLink] = useState(false);
  const [linkUrlInput, setLinkUrlInput] = useState('');

  const styleBtnRef = useRef<HTMLButtonElement>(null);
  const styleMenuRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  const isLinkActive = editor.isActive('link');
  const activeHref = editor.getAttributes('link').href || '';

  // Foca o input de link quando aberto
  useEffect(() => {
    if (isEditingLink) {
      setTimeout(() => {
        linkInputRef.current?.focus();
        linkInputRef.current?.select();
      }, 50);
    }
  }, [isEditingLink]);

  // Fecha o menu de estilo ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        styleMenuRef.current &&
        !styleMenuRef.current.contains(target) &&
        styleBtnRef.current &&
        !styleBtnRef.current.contains(target)
      ) {
        setShowStyleMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Escala de fontes
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

  const handleToggleStyleMenu = () => {
    if (!showStyleMenu && styleBtnRef.current) {
      const rect = styleBtnRef.current.getBoundingClientRect();
      if (rect.top < 180) {
        setDropdownPlacement('bottom');
      } else {
        setDropdownPlacement('top');
      }
      setShowStyleMenu(true);
    } else {
      setShowStyleMenu(false);
    }
  };

  // Aplica / Atualiza o Link
  const handleApplyLink = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const url = linkUrlInput.trim();
    if (!url) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      const normalized = normalizeUrl(url);
      editor.chain().focus().extendMarkRange('link').setLink({ href: normalized }).run();
    }
    setIsEditingLink(false);
    setLinkUrlInput('');
  };

  // Remove o Link mantendo o texto
  const handleRemoveLink = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setIsEditingLink(false);
    setLinkUrlInput('');
  };

  // Abre o Link em nova aba
  const handleOpenLink = () => {
    if (activeHref) {
      window.open(activeHref, '_blank', 'noopener,noreferrer');
    }
  };

  // Paleta de Estilos de Texto Estruturados (reutilizando a lógica existente do app)
  const textStyles = [
    {
      id: 'title',
      label: 'Título',
      previewClass: 'font-serif-note font-bold text-lg text-[#1b1c19] tracking-tight leading-tight',
      isActive: () => editor.isActive('heading', { level: 1 }),
      action: () => editor.chain().focus().setHeading({ level: 1 }).run(),
    },
    {
      id: 'heading',
      label: 'Cabeçalho',
      previewClass: 'font-serif-note font-bold text-base text-[#1b1c19] leading-snug',
      isActive: () => editor.isActive('heading', { level: 2 }),
      action: () => editor.chain().focus().setHeading({ level: 2 }).run(),
    },
    {
      id: 'subtitle',
      label: 'Subtítulo',
      previewClass: 'font-serif-note font-semibold text-sm text-[#4e453f] leading-snug',
      isActive: () => editor.isActive('heading', { level: 3 }),
      action: () => editor.chain().focus().setHeading({ level: 3 }).run(),
    },
    {
      id: 'body',
      label: 'Corpo',
      previewClass: 'font-serif-note font-normal text-xs text-[#1b1c19] leading-normal',
      isActive: () => editor.isActive('paragraph') && !editor.isActive('heading'),
      action: () => editor.chain().focus().setParagraph().run(),
    },
  ];

  return (
    <BubbleMenu
      editor={editor}
      appendTo={() => (typeof document !== 'undefined' ? document.body : (null as unknown as HTMLElement))}
      updateDelay={50}
      options={{
        strategy: 'fixed',
        placement: 'top',
        offset: 8,
        flip: {
          fallbackPlacements: ['bottom', 'top-start', 'bottom-start', 'top-end', 'bottom-end'],
          padding: 8,
        },
        shift: {
          padding: 8,
        },
      }}
      shouldShow={({ editor, from, to, state }) => {
        if (!editor.isEditable) return false;
        const { empty } = state.selection;
        // Permite exibir se houver seleção OU se o cursor estiver sobre um link ativo
        if (empty && !editor.isActive('link')) return false;
        if (!empty && from === to && !editor.isActive('link')) return false;
        // Não exibe caso um node view especial como imagem/youtube/documento esteja selecionado
        if (
          editor.isActive('image') ||
          editor.isActive('youtube') ||
          editor.isActive('documentAttachment')
        ) {
          return false;
        }
        return true;
      }}
    >
      <div
        id="editor-floating-bubble-menu"
        className="bg-[#ffffff]/98 backdrop-blur-md border border-[#e4e2dd] shadow-2xl rounded-2xl p-1 sm:p-1.5 flex items-center gap-0.5 sm:gap-1 text-[#4e453f] select-none pointer-events-auto"
        style={{ zIndex: 99999 }}
      >
        {/* MODO 1: INPUT DE EDIÇÃO DE LINK */}
        {isEditingLink ? (
          <form
            onSubmit={handleApplyLink}
            className="flex items-center gap-1 px-1 py-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <LinkIcon className="w-3.5 h-3.5 text-[#68594d] shrink-0" />
            <input
              ref={linkInputRef}
              type="text"
              value={linkUrlInput}
              onChange={(e) => setLinkUrlInput(e.target.value)}
              placeholder="Cole ou digite a URL (ex: google.com)"
              className="px-2 py-1 text-xs bg-[#f5f3ee] text-[#1b1c19] rounded-lg border border-[#e4e2dd] focus:outline-none focus:border-[#68594d] w-48 sm:w-56 font-sans-ui"
            />
            <button
              type="submit"
              className="p-1.5 bg-[#68594d] hover:bg-[#4a3728] text-white rounded-lg transition-colors cursor-pointer"
              title="Salvar link"
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
            <button
              type="button"
              onClick={() => {
                setIsEditingLink(false);
                setLinkUrlInput('');
              }}
              className="p-1.5 text-[#7f756e] hover:bg-[#f0eee9] hover:text-[#1b1c19] rounded-lg transition-colors cursor-pointer"
              title="Cancelar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : isLinkActive ? (
          /* MODO 2: VISUALIZAÇÃO CONTEXTUAL DE LINK ATIVO */
          <div className="flex items-center gap-1 px-1 py-0.5 font-sans-ui text-xs">
            <LinkIcon className="w-3.5 h-3.5 text-[#68594d] shrink-0" />
            <span
              className="max-w-[140px] sm:max-w-[180px] truncate text-[#1b1c19] font-medium font-mono text-[11px]"
              title={activeHref}
            >
              {activeHref.replace(/^https?:\/\//, '')}
            </span>

            <div className="h-4 w-[1px] bg-[#e4e2dd] mx-0.5 shrink-0" />

            {/* Abrir Link */}
            <button
              type="button"
              onClick={handleOpenLink}
              className="p-1.5 text-[#68594d] hover:bg-[#f0eee9] rounded-lg transition-colors cursor-pointer"
              title="Abrir link em nova aba"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>

            {/* Editar Link */}
            <button
              type="button"
              onClick={() => {
                setLinkUrlInput(activeHref);
                setIsEditingLink(true);
              }}
              className="p-1.5 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] rounded-lg transition-colors cursor-pointer"
              title="Editar URL do link"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>

            {/* Remover Link (Unlink preservando texto) */}
            <button
              type="button"
              onClick={handleRemoveLink}
              className="p-1.5 text-[#ba1a1a] hover:bg-[#fceded] rounded-lg transition-colors cursor-pointer"
              title="Remover link (manter texto)"
            >
              <Unlink className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          /* MODO 3: BARRA DE FORMATAÇÃO DE TEXTO PADRÃO */
          <>
            {/* 1. Negrito [B] */}
            <button
              type="button"
              id="bubble-btn-bold"
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().toggleBold().run();
              }}
              className={`min-w-[32px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                editor.isActive('bold')
                  ? 'bg-[#68594d] text-white shadow-2xs'
                  : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
              }`}
              title="Negrito (Ctrl+B)"
              aria-label="Negrito"
            >
              <Bold className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.25]" />
            </button>

            {/* 2. Itálico [I] */}
            <button
              type="button"
              id="bubble-btn-italic"
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().toggleItalic().run();
              }}
              className={`min-w-[32px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                editor.isActive('italic')
                  ? 'bg-[#68594d] text-white shadow-2xs'
                  : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
              }`}
              title="Itálico (Ctrl+I)"
              aria-label="Itálico"
            >
              <Italic className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.25]" />
            </button>

            {/* 3. Sublinhado [U] */}
            <button
              type="button"
              id="bubble-btn-underline"
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().toggleUnderline().run();
              }}
              className={`min-w-[32px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                editor.isActive('underline')
                  ? 'bg-[#68594d] text-white shadow-2xs'
                  : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
              }`}
              title="Sublinhado (Ctrl+U)"
              aria-label="Sublinhado"
            >
              <UnderlineIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.25]" />
            </button>

            {/* 4. Tachado [S] */}
            <button
              type="button"
              id="bubble-btn-strike"
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().toggleStrike().run();
              }}
              className={`min-w-[32px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                editor.isActive('strike')
                  ? 'bg-[#68594d] text-white shadow-2xs'
                  : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
              }`}
              title="Tachado"
              aria-label="Tachado"
            >
              <Strikethrough className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.25]" />
            </button>

            {/* Inserir Link Rápido na Seleção [🔗] */}
            <button
              type="button"
              id="bubble-btn-link"
              onMouseDown={(e) => {
                e.preventDefault();
                setLinkUrlInput('');
                setIsEditingLink(true);
              }}
              className="min-w-[32px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19] active:scale-95"
              title="Inserir Link no texto selecionado"
              aria-label="Inserir Link"
            >
              <LinkIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.25]" />
            </button>

            {/* Separador Visual */}
            <div className="h-4 w-[1px] bg-[#e4e2dd] mx-0.5" />

            {/* 5. Menu de Estilo [A v] */}
            <div className="relative">
              <button
                ref={styleBtnRef}
                type="button"
                id="bubble-btn-style-menu"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleToggleStyleMenu();
                }}
                className={`min-w-[32px] min-h-[32px] sm:min-w-[36px] sm:min-h-[34px] px-1.5 py-1 rounded-xl flex items-center gap-0.5 transition-all cursor-pointer active:scale-95 ${
                  showStyleMenu
                    ? 'bg-[#68594d] text-white'
                    : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
                }`}
                title="Estilos de Texto (Título, Cabeçalho, Corpo)"
                aria-label="Estilos de Texto"
              >
                <span className="font-serif-note font-bold text-xs sm:text-sm">A</span>
                <ChevronDown className="w-2.5 h-2.5 opacity-70" />
              </button>

              {showStyleMenu && (
                <div
                  ref={styleMenuRef}
                  id="bubble-style-dropdown"
                  className={`absolute left-0 w-40 bg-white/98 backdrop-blur-md border border-[#e4e2dd] rounded-2xl shadow-2xl p-1.5 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-100 ${
                    dropdownPlacement === 'bottom'
                      ? 'top-full mt-2'
                      : 'bottom-full mb-2'
                  }`}
                  style={{ zIndex: 100000 }}
                >
                  {textStyles.map((st) => {
                    const active = st.isActive();
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          st.action();
                          setShowStyleMenu(false);
                        }}
                        className={`w-full px-2.5 py-1.5 rounded-xl flex items-center justify-between text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#f0eee9] text-[#1b1c19] font-medium'
                            : 'hover:bg-[#f0eee9] text-[#4e453f]'
                        }`}
                      >
                        <span className={st.previewClass}>{st.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 6. Diminuir Tamanho de Fonte [A↓] */}
            <button
              type="button"
              id="bubble-btn-decrease-font"
              onMouseDown={(e) => {
                e.preventDefault();
                handleDecreaseFontSize();
              }}
              className="min-w-[32px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19] active:scale-95"
              title="Diminuir tamanho da fonte"
              aria-label="Diminuir tamanho da fonte"
            >
              <div className="flex items-center">
                <span className="font-serif-note font-bold text-xs">A</span>
                <ArrowDown className="w-2.5 h-2.5 -ml-0.5 stroke-[2.5]" />
              </div>
            </button>

            {/* 7. Aumentar Tamanho de Fonte [A↑] */}
            <button
              type="button"
              id="bubble-btn-increase-font"
              onMouseDown={(e) => {
                e.preventDefault();
                handleIncreaseFontSize();
              }}
              className="min-w-[32px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19] active:scale-95"
              title="Aumentar tamanho da fonte"
              aria-label="Aumentar tamanho da fonte"
            >
              <div className="flex items-center">
                <span className="font-serif-note font-bold text-sm">A</span>
                <ArrowUp className="w-2.5 h-2.5 -ml-0.5 stroke-[2.5]" />
              </div>
            </button>

            {/* Separador Visual */}
            <div className="h-4 w-[1px] bg-[#e4e2dd] mx-0.5" />

            {/* 8. Bolinha 1: Marca-texto Amarelo [🟡] */}
            <button
              type="button"
              id="bubble-btn-highlight-yellow"
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run();
              }}
              className={`min-w-[28px] min-h-[28px] sm:min-w-[30px] sm:min-h-[30px] p-1 rounded-xl flex items-center justify-center transition-all cursor-pointer hover:bg-[#f0eee9] active:scale-90 ${
                editor.isActive('highlight', { color: '#fef08a' })
                  ? 'ring-2 ring-[#68594d] ring-offset-1 bg-[#f0eee9]'
                  : ''
              }`}
              title="Marca-texto Amarelo"
              aria-label="Marca-texto Amarelo"
            >
              <span
                className="w-3.5 h-3.5 rounded-full border border-[#ca8a04]/40 shadow-2xs block"
                style={{ backgroundColor: '#fef08a' }}
              />
            </button>

            {/* 9. Bolinha 2: Marca-texto Verde Menta [🟢] */}
            <button
              type="button"
              id="bubble-btn-highlight-green"
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().toggleHighlight({ color: '#bbf7d0' }).run();
              }}
              className={`min-w-[28px] min-h-[28px] sm:min-w-[30px] sm:min-h-[30px] p-1 rounded-xl flex items-center justify-center transition-all cursor-pointer hover:bg-[#f0eee9] active:scale-90 ${
                editor.isActive('highlight', { color: '#bbf7d0' })
                  ? 'ring-2 ring-[#68594d] ring-offset-1 bg-[#f0eee9]'
                  : ''
              }`}
              title="Marca-texto Verde Menta"
              aria-label="Marca-texto Verde Menta"
            >
              <span
                className="w-3.5 h-3.5 rounded-full border border-[#16a34a]/40 shadow-2xs block"
                style={{ backgroundColor: '#bbf7d0' }}
              />
            </button>

            {/* 10. Bolinha 3: Marca-texto Rosa Pergaminho [🩷] */}
            <button
              type="button"
              id="bubble-btn-highlight-pink"
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().toggleHighlight({ color: '#fecdd3' }).run();
              }}
              className={`min-w-[28px] min-h-[28px] sm:min-w-[30px] sm:min-h-[30px] p-1 rounded-xl flex items-center justify-center transition-all cursor-pointer hover:bg-[#f0eee9] active:scale-90 ${
                editor.isActive('highlight', { color: '#fecdd3' })
                  ? 'ring-2 ring-[#68594d] ring-offset-1 bg-[#f0eee9]'
                  : ''
              }`}
              title="Marca-texto Rosa Pergaminho"
              aria-label="Marca-texto Rosa Pergaminho"
            >
              <span
                className="w-3.5 h-3.5 rounded-full border border-[#e11d48]/40 shadow-2xs block"
                style={{ backgroundColor: '#fecdd3' }}
              />
            </button>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}


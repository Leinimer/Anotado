'use client';

import React, { useEffect, useRef } from 'react';
import { PanelLeftClose } from 'lucide-react';

interface PdfThumbnailSidebarProps {
  numPages: number;
  currentPage: number;
  onSelectPage: (pageIndex: number) => void;
  pdfDoc: any;
  isOpen: boolean;
  onToggle: () => void;
}

export function PdfThumbnailSidebar({
  numPages,
  currentPage,
  onSelectPage,
  pdfDoc,
  isOpen,
  onToggle,
}: PdfThumbnailSidebarProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLDivElement | null>(null);
  const manualScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualScrollLockRef = useRef(false);
  const [scrollRoot, setScrollRoot] = React.useState<HTMLDivElement | null>(null);

  useEffect(() => {
    setScrollRoot(scrollContainerRef.current);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (manualScrollTimerRef.current) clearTimeout(manualScrollTimerRef.current);
    };
  }, []);

  // A miniatura da página visível no documento fica centralizada. O auto-follow
  // pausa enquanto o usuário navega manualmente pela barra de miniaturas.
  useEffect(() => {
    if (!isOpen || manualScrollLockRef.current || !activeItemRef.current) return;
    activeItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentPage, isOpen]);

  const pauseAutoFollow = () => {
    manualScrollLockRef.current = true;
    if (manualScrollTimerRef.current) clearTimeout(manualScrollTimerRef.current);
    manualScrollTimerRef.current = setTimeout(() => {
      manualScrollLockRef.current = false;
    }, 1800);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <aside
      className="w-56 shrink-0 border-r border-[#e4e2dd] dark:border-[#383633] bg-[#f8f6f0] dark:bg-[#1a1918] flex flex-col h-full z-20 transition-all select-none"
      aria-label="Miniaturas de páginas"
    >
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-[#e4e2dd] dark:border-[#383633]">
        <span className="text-xs font-semibold text-[#68594d] dark:text-[#c4b5a5] uppercase tracking-wider font-sans-ui">
          Páginas ({numPages})
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="p-1 rounded-lg text-[#7f756e] hover:bg-[#eae7e0] dark:hover:bg-[#2c2a28] dark:text-[#a89f97] transition-colors cursor-pointer"
          title="Recolher miniaturas"
          aria-label="Recolher miniaturas"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-3 space-y-3"
        onWheel={pauseAutoFollow}
        onTouchMove={pauseAutoFollow}
        onKeyDown={(event) => {
          if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
            pauseAutoFollow();
          }
        }}
        tabIndex={0}
        aria-label="Lista de miniaturas; a centralização automática pausa durante a navegação manual"
      >
        {Array.from({ length: numPages }, (_, index) => (
          <ThumbnailItem
            key={index}
            pageIndex={index}
            isActive={currentPage === index}
            onSelect={() => {
              manualScrollLockRef.current = false;
              if (manualScrollTimerRef.current) clearTimeout(manualScrollTimerRef.current);
              onSelectPage(index);
            }}
            pdfDoc={pdfDoc}
            scrollRoot={scrollRoot}
            itemRef={currentPage === index ? activeItemRef : undefined}
          />
        ))}
      </div>
    </aside>
  );
}

function ThumbnailItem({
  pageIndex,
  isActive,
  onSelect,
  pdfDoc,
  scrollRoot,
  itemRef,
}: {
  pageIndex: number;
  isActive: boolean;
  onSelect: () => void;
  pdfDoc: any;
  scrollRoot: HTMLElement | null;
  itemRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const itemContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);
  const [isNearViewport, setIsNearViewport] = React.useState(pageIndex < 2);

  useEffect(() => {
    const element = itemContainerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => setIsNearViewport(entry.isIntersecting)),
      { root: scrollRoot, rootMargin: '240px 0px', threshold: 0 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    let isCancelled = false;

    async function renderThumbnail() {
      if (!pdfDoc || !canvasRef.current || !isNearViewport) {
        if (canvasRef.current && !isNearViewport) {
          canvasRef.current.width = 0;
          canvasRef.current.height = 0;
        }
        return;
      }
      try {
        const page = await pdfDoc.getPage(pageIndex + 1);
        if (isCancelled) return;

        const viewport = page.getViewport({ scale: 0.22 });
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
        };

        renderTaskRef.current = page.render(renderContext);
        await renderTaskRef.current.promise;
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          // ignore cancelled
        }
      }
    }

    renderThumbnail();

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
      }
    };
  }, [pdfDoc, pageIndex, isNearViewport]);

  return (
    <div
      ref={(element) => {
        itemContainerRef.current = element;
        if (itemRef && 'current' in itemRef) {
          (itemRef as React.MutableRefObject<HTMLDivElement | null>).current = element;
        }
      }}
      onClick={onSelect}
      className={`group flex flex-col items-center p-2 rounded-xl cursor-pointer transition-all ${
        isActive
          ? 'bg-[#e8e4db] dark:bg-[#2f2d2a] ring-2 ring-[#68594d] dark:ring-[#c4b5a5]'
          : 'hover:bg-[#efebe2] dark:hover:bg-[#252422]'
      }`}
    >
      <div className="w-full bg-white dark:bg-[#121212] rounded-md shadow-xs overflow-hidden flex items-center justify-center min-h-[90px] border border-[#e4e2dd] dark:border-[#33312e]">
        <canvas ref={canvasRef} className="max-w-full h-auto block" />
      </div>
      <span
        className={`text-[11px] font-sans-ui mt-1.5 font-medium ${
          isActive
            ? 'text-[#68594d] dark:text-[#e0d6cb] font-semibold'
            : 'text-[#7f756e] dark:text-[#9e958d] group-hover:text-[#1b1c19] dark:group-hover:text-white'
        }`}
      >
        {pageIndex + 1}
      </span>
    </div>
  );
}

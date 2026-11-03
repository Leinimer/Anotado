'use client';

import React, { useEffect, useRef } from 'react';
import { PanelLeftClose, ChevronLeft, ChevronRight } from 'lucide-react';

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

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {Array.from({ length: numPages }, (_, index) => (
          <ThumbnailItem
            key={index}
            pageIndex={index}
            isActive={currentPage === index}
            onSelect={() => onSelectPage(index)}
            pdfDoc={pdfDoc}
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
}: {
  pageIndex: number;
  isActive: boolean;
  onSelect: () => void;
  pdfDoc: any;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);

  useEffect(() => {
    let isCancelled = false;

    async function renderThumbnail() {
      if (!pdfDoc || !canvasRef.current) return;
      try {
        const page = await pdfDoc.getPage(pageIndex + 1);
        if (isCancelled) return;

        const viewport = page.getViewport({ scale: 0.25 });
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
  }, [pdfDoc, pageIndex]);

  return (
    <div
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

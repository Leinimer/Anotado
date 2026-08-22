'use client';

import { useState } from 'react';
import { SidebarNavigation } from '@/src/features/notes/ui/SidebarNavigation';
import { NoteCanvas } from '@/src/features/notes/ui/NoteCanvas';
import { EditorToolbar } from '@/src/features/notes/ui/EditorToolbar';
import { LoginForm } from '@/src/features/auth/ui/LoginForm';

interface MainLayoutProps {
  initialView?: 'notes' | 'login';
}

export function MainLayout({ initialView = 'notes' }: MainLayoutProps) {
  const [currentView, setCurrentView] = useState<'notes' | 'login'>(initialView);
  const [activeNoteId, setActiveNoteId] = useState('texto-2');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  if (currentView === 'login') {
    return (
      <LoginForm
        onSuccess={() => setCurrentView('notes')}
        onSwitchToApp={() => setCurrentView('notes')}
      />
    );
  }

  return (
    <div
      id="main-app-container"
      className="flex flex-col h-screen w-screen overflow-hidden bg-[#fbf9f4] font-sans-ui"
    >
      {/* Workspace Area: Sidebar + Canvas */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Desktop Sidebar */}
        <div className="hidden md:flex shrink-0 h-full">
          <SidebarNavigation
            activeNoteId={activeNoteId}
            onSelectNote={(id) => setActiveNoteId(id)}
          />
        </div>

        {/* Mobile Drawer Sidebar */}
        {mobileSidebarOpen && (
          <div
            id="mobile-sidebar-drawer"
            className="fixed inset-0 z-50 flex md:hidden"
          >
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
              onClick={() => setMobileSidebarOpen(false)}
            />

            {/* Slide-in Content */}
            <div className="relative w-[280px] max-w-[80vw] h-full z-10 shadow-2xl">
              <SidebarNavigation
                activeNoteId={activeNoteId}
                onSelectNote={(id) => {
                  setActiveNoteId(id);
                  setMobileSidebarOpen(false);
                }}
                onCloseMobile={() => setMobileSidebarOpen(false)}
              />
            </div>
          </div>
        )}

        {/* Main Note Canvas */}
        <NoteCanvas
          noteTitle="Texto II"
          onOpenMobileMenu={() => setMobileSidebarOpen(true)}
          onDeleteNote={() => {}}
        />
      </div>

      {/* Formatting Editor Toolbar at the Bottom */}
      <EditorToolbar
        onFormat={(action) => {
          // Handles editor formatting (Bold, Italic, Underline, Object Insert, Color)
        }}
      />
    </div>
  );
}

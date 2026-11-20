'use client';

import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type DropAnimation,
} from '@dnd-kit/core';
import {
  SortableContext,
  defaultAnimateLayoutChanges,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import { STICKY_COLORS, StickyNote, StickyNoteGroup } from '../types';

interface StickyGroupsSidebarProps {
  isTablet: boolean;
  groups: StickyNoteGroup[];
  notes: StickyNote[];
  onClose: () => void;
  onSelectGroup: (groupId: string) => void;
  onReorderGroups: (activeId: string, overId: string) => void;
}

const dropAnimationConfig: DropAnimation = {
  duration: 210,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.4',
      },
    },
  }),
};

interface SortableGroupCardProps {
  group: StickyNoteGroup;
  count: number;
  onSelect: (groupId: string) => void;
}

function SortableGroupCard({ group, count, onSelect }: SortableGroupCardProps) {
  const palette = STICKY_COLORS.find((color) => color.key === group.color) || STICKY_COLORS[0];
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: group.id,
    animateLayoutChanges: (args) =>
      args.isSorting || args.wasDragging ? defaultAnimateLayoutChanges(args) : true,
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-sticky-sidebar-group-id={group.id}
      className={`group/card relative flex w-full items-center gap-1.5 rounded-xl border pr-3 pl-1.5 py-1.5 text-left transition-shadow ${palette.cardClass} ${palette.textClass} ${
        isDragging
          ? 'opacity-35 border-dashed ring-2 ring-[#8d725d]/55 shadow-none'
          : 'shadow-sm hover:shadow-md'
      }`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        style={{ touchAction: 'none' }}
        aria-label={`Arrastar campo ${group.title || 'sem título'} para mudar sua posição`}
        title="Segure e arraste para reordenar este campo"
        className="flex h-9 w-8 shrink-0 cursor-grab items-center justify-center rounded-lg touch-none select-none opacity-60 transition-opacity hover:bg-black/5 hover:opacity-100 active:cursor-grabbing focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8d725d] dark:hover:bg-white/10"
      >
        <GripVertical className="h-4 w-4 pointer-events-none" />
      </button>

      <button
        type="button"
        onClick={() => onSelect(group.id)}
        className="flex min-w-0 flex-1 items-center justify-between gap-2.5 rounded-lg py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8d725d]"
        title={count > 0 ? 'Centralizar este campo no quadro' : 'Este campo ainda não possui Stick'}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {group.title || 'Campo sem título'}
        </span>
        <span className="shrink-0 text-[11px] font-medium opacity-75">
          {count} {count === 1 ? 'Stick' : 'Sticks'}
        </span>
      </button>
    </div>
  );
}

interface GroupCardOverlayProps {
  group: StickyNoteGroup;
  count: number;
}

function GroupCardOverlay({ group, count }: GroupCardOverlayProps) {
  const palette = STICKY_COLORS.find((color) => color.key === group.color) || STICKY_COLORS[0];

  return (
    <div
      className={`flex w-full items-center gap-1.5 rounded-xl border pr-3 pl-1.5 py-1.5 text-left cursor-grabbing select-none scale-[1.02] ring-2 ring-[#8d725d]/65 shadow-[0_14px_30px_rgba(40,30,20,0.24)] dark:shadow-[0_16px_34px_rgba(0,0,0,0.65)] ${palette.cardClass} ${palette.textClass}`}
    >
      <div className="flex h-9 w-8 shrink-0 items-center justify-center rounded-lg opacity-95">
        <GripVertical className="h-4 w-4" />
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {group.title || 'Campo sem título'}
        </span>
        <span className="shrink-0 text-[11px] font-medium opacity-75">
          {count} {count === 1 ? 'Stick' : 'Sticks'}
        </span>
      </div>
    </div>
  );
}

export function StickyGroupsSidebar({
  isTablet,
  groups,
  notes,
  onClose,
  onSelectGroup,
  onReorderGroups,
}: StickyGroupsSidebarProps) {
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { distance: 3 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const groupIds = useMemo(() => groups.map((group) => group.id), [groups]);

  const countsByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      if (!note.group_id) continue;
      counts.set(note.group_id, (counts.get(note.group_id) || 0) + 1);
    }
    return counts;
  }, [notes]);

  const activeGroup = useMemo(
    () => (activeGroupId ? groups.find((group) => group.id === activeGroupId) || null : null),
    [activeGroupId, groups]
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveGroupId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveGroupId(null);
    if (!over || active.id === over.id) return;
    onReorderGroups(String(active.id), String(over.id));
  };

  const handleDragCancel = () => {
    setActiveGroupId(null);
  };

  const overlay = (
    <DragOverlay zIndex={10600} dropAnimation={dropAnimationConfig}>
      {activeGroup ? (
        <GroupCardOverlay
          group={activeGroup}
          count={countsByGroup.get(activeGroup.id) || 0}
        />
      ) : null}
    </DragOverlay>
  );

  return (
    <aside
      aria-label="Campos criados"
      onPointerDown={(event) => event.stopPropagation()}
      className={`fixed left-0 ${isTablet ? 'top-[92px]' : 'top-[76px]'} bottom-0 z-[10500] flex w-[min(290px,85vw)] flex-col border-r border-[#ded6cc] bg-[#fbf9f4] shadow-[8px_0_28px_rgba(40,30,20,.14)] dark:border-[#38332e] dark:bg-[#11100f] dark:shadow-[8px_0_28px_rgba(0,0,0,.45)]`}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#e8e1d8] px-4 dark:border-[#302b26]">
        <h2 className="text-sm font-semibold text-[#51463d] dark:text-[#e8ded4]">Campos criados</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar campos criados"
          className="rounded-full p-1.5 text-[#75695f] hover:bg-[#eee8df] dark:text-[#c5b8aa] dark:hover:bg-[#29231e]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        className={`flex-1 space-y-2 p-3 ${
          activeGroupId ? 'overflow-y-hidden select-none' : 'overflow-y-auto'
        }`}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
            {groups.map((group) => (
              <SortableGroupCard
                key={group.id}
                group={group}
                count={countsByGroup.get(group.id) || 0}
                onSelect={onSelectGroup}
              />
            ))}
          </SortableContext>

          {typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay}
        </DndContext>

        {groups.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-[#8b8178] dark:text-[#a39a91]">
            Nenhum campo criado.
          </p>
        )}
      </div>
    </aside>
  );
}

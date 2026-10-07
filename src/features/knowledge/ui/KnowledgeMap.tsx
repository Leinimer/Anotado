'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@/src/features/theme/theme-context';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  BookOpen,
  ArrowUpRight,
  BrainCircuit,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ExternalLink,
  FileClock,
  Filter,
  History,
  LayoutDashboard,
  Maximize2,
  Plus,
  Search,
  Sparkles,
  Star,
  X,
  Zap,
} from 'lucide-react';
import { Folder, Note } from '@/src/features/notes/types';
import {
  buildKnowledgeGraph,
  getLocalGraph,
  KnowledgeGraphData,
  KnowledgeGraphNode,
} from '@/src/features/notes/utils/knowledge-graph';
import {
  getNoteHistory,
  getRecentNotes,
  NoteRevision,
  RecentNoteItem,
} from '@/src/features/notes/utils/user-activity';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center text-sm text-[#7f756e]">
      Preparando o mapa…
    </div>
  ),
});

type CenterTab = 'map' | 'overview' | 'recent' | 'tasks' | 'templates' | 'history' | 'ai';

interface KnowledgeMapProps {
  notes: Note[];
  folders: Folder[];
  userId: string;
  onOpenNote?: (noteId: string, workspace?: 'notes' | 'diary') => void;
  onBack?: () => void;
  onCreateTemplate?: (template: TemplateItem) => void;
}

interface TemplateItem {
  id: string;
  title: string;
  content: string;
}

const TEMPLATE_KEY = 'anotado_templates_v1';

const DEFAULT_TEMPLATES: TemplateItem[] = [
  {
    id: 'study',
    title: 'Estudo',
    content: '# Tema\n\n## Conceitos principais\n\n## Pontos importantes\n\n## Dúvidas\n\n## Questões\n\n## Revisão',
  },
  {
    id: 'investigation',
    title: 'Investigação',
    content: '# Objeto\n\n## Pessoas / entidades\n\n## Fatos\n\n## Diligências\n\n## Documentos\n\n## Análise\n\n## Conclusão',
  },
  {
    id: 'meeting',
    title: 'Reunião',
    content: '# Reunião\n\n**Data:** \n**Participantes:** \n\n## Pauta\n\n## Decisões\n\n## Pendências\n',
  },
];

function loadTemplates(): TemplateItem[] {
  if (typeof window === 'undefined') return DEFAULT_TEMPLATES;
  try {
    const parsed = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || 'null');
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_TEMPLATES;
  } catch {
    return DEFAULT_TEMPLATES;
  }
}

function saveTemplates(items: TemplateItem[]) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(items));
  }
}

function stripMarkdown(content: string) {
  return content
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_\u0060>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function workspaceOf(note: Note): 'notes' | 'diary' {
  return note.workspace_type === 'diary' || note.entry_date || note.diary_year ? 'diary' : 'notes';
}

function dispatchOpenNote(noteId: string, workspace: 'notes' | 'diary') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('anotado:open-note', {
      detail: { noteId, workspace },
    })
  );
}

function taskStats(notes: Note[]) {
  let open = 0;
  let done = 0;
  for (const note of notes) {
    const text = note.content || '';
    open += (text.match(/(?:^|\n)\s*[-*]\s*\[\s\]/g) || []).length;
    done += (text.match(/(?:^|\n)\s*[-*]\s*\[[xX]\]/g) || []).length;
  }
  return { open, done };
}

function calendarCells(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: offset + count }, (_, index) =>
    index < offset ? null : index - offset + 1
  );
}

export function KnowledgeMap({
  notes,
  folders,
  userId,
  onOpenNote,
  onBack,
  onCreateTemplate,
}: KnowledgeMapProps) {
  const { theme } = useTheme();
  const [tab, setTab] = useState<CenterTab>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [graphMode, setGraphMode] = useState<'global' | 'local'>('global');
  const [localDepth, setLocalDepth] = useState(2);
  const [includeDiary, setIncludeDiary] = useState(true);
  const [search, setSearch] = useState('');
  const [workspaceFilter, setWorkspaceFilter] = useState<'all' | 'notes' | 'diary'>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [showArrows, setShowArrows] = useState(true);
  const [linkWidth, setLinkWidth] = useState(1.4);
  const [nodeScale, setNodeScale] = useState(1);
  const [showFilters, setShowFilters] = useState(true);

  const [templates, setTemplates] = useState<TemplateItem[]>(loadTemplates);
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateContent, setTemplateContent] = useState('');

  const [recent, setRecent] = useState<RecentNoteItem[]>(getRecentNotes);
  const [historyNoteId, setHistoryNoteId] = useState<string | null>(null);
  const [history, setHistory] = useState<NoteRevision[]>([]);

  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  const [calendarCursor, setCalendarCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const graphRef = useRef<any>(null);
  const lastNodeClickRef = useRef({ id: '', time: 0 });

  const graph = useMemo(() => {
    const source = notes.filter((note) => {
      if (includeDiary) return true;
      return workspaceOf(note) === 'notes';
    });
    return buildKnowledgeGraph(source, folders);
  }, [notes, folders, includeDiary]);

  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedId) || null,
    [graph.nodes, selectedId]
  );

  useEffect(() => {
    if (!selectedId || !graph.nodes.some((node) => node.id === selectedId)) {
      const defaultId = graph.nodes[0]?.id || null;
      setTimeout(() => setSelectedId(defaultId), 0);
    }
  }, [graph.nodes, selectedId]);

  useEffect(() => {
    const recents = getRecentNotes();
    setTimeout(() => setRecent(recents), 0);
  }, [notes]);

  useEffect(() => {
    const hist = historyNoteId ? getNoteHistory(historyNoteId) : [];
    setTimeout(() => setHistory(hist), 0);
  }, [historyNoteId]);

  const noteSearchIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const note of notes) {
      index.set(
        note.id,
        [
          note.title || '',
          note.content || '',
          ...(note.tags || []),
        ].join(' ').toLowerCase()
      );
    }
    return index;
  }, [notes]);

  const visible = useMemo(() => {
    const base =
      graphMode === 'local' && selectedId
        ? getLocalGraph(graph, selectedId, localDepth)
        : graph;

    const query = search.trim().toLowerCase();
    const allowed = new Set(
      base.nodes
        .filter((node) => {
          if (workspaceFilter !== 'all' && node.workspace !== workspaceFilter) return false;
          if (favoritesOnly && !node.isFavorite) return false;
          if (orphansOnly && node.degree !== 0) return false;
          if (query && !(noteSearchIndex.get(node.id) || '').includes(query)) return false;
          return true;
        })
        .map((node) => node.id)
    );

    return {
      nodes: base.nodes.filter((node) => allowed.has(node.id)),
      links: base.links.filter(
        (link) => allowed.has(link.source) && allowed.has(link.target)
      ),
    };
  }, [
    graph,
    graphMode,
    selectedId,
    localDepth,
    search,
    workspaceFilter,
    favoritesOnly,
    orphansOnly,
    noteSearchIndex,
  ]);

  const stats = useMemo(() => {
    const top = [...graph.nodes].sort((a, b) => b.inbound - a.inbound).slice(0, 8);
    return {
      notes: graph.nodes.filter((n) => n.workspace === 'notes').length,
      diary: graph.nodes.filter((n) => n.workspace === 'diary').length,
      links: graph.links.length,
      orphans: graph.nodes.filter((n) => n.degree === 0).length,
      top,
    };
  }, [graph]);

  const tasks = useMemo(() => taskStats(notes), [notes]);

  const diaryNotes = useMemo(
    () => notes.filter((note) => workspaceOf(note) === 'diary'),
    [notes]
  );

  const recentNotes = useMemo(
    () =>
      recent
        .map((item) => notes.find((note) => note.id === item.id))
        .filter(Boolean) as Note[],
    [recent, notes]
  );

  const selectedRaw = selectedId ? notes.find((note) => note.id === selectedId) || null : null;

  const openNote = (noteId: string, workspace: 'notes' | 'diary') => {
    onOpenNote?.(noteId, workspace);
    dispatchOpenNote(noteId, workspace);
  };

  const focusGraph = () => graphRef.current?.zoomToFit?.(500, 40);

  const saveTemplate = () => {
    const title = templateTitle.trim();
    if (!title) return;
    const next = [
      ...templates.filter((item) => item.title.toLowerCase() !== title.toLowerCase()),
      { id: String(Date.now()), title, content: templateContent },
    ];
    setTemplates(next);
    saveTemplates(next);
    setTemplateTitle('');
    setTemplateContent('');
  };

  const applyTemplate = (template: TemplateItem) => {
    if (onCreateTemplate) {
      onCreateTemplate(template);
      return;
    }
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(
        'anotado_pending_template',
        JSON.stringify({ title: template.title, content: template.content })
      );
    }
  };

  const askAi = async () => {
    const question = aiQuestion.trim();
    if (!question) return;

    setAiBusy(true);
    setAiAnswer('');

    try {
      const context = notes
        .filter((note) => !note.is_archived)
        .slice(0, 120)
        .map(
          (note) =>
            'NOTA: ' +
            (note.title || 'Sem título') +
            ' [' +
            (workspaceOf(note) === 'diary' ? 'Diário' : 'Notas') +
            ']\n' +
            stripMarkdown(note.content || '').slice(0, 6000)
        )
        .join('\n\n');

      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, context, userId }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Não foi possível consultar a IA.');
      setAiAnswer(data.answer || 'Sem resposta.');
    } catch (error: any) {
      setAiAnswer(error?.message || 'Erro ao consultar a IA.');
    } finally {
      setAiBusy(false);
    }
  };

  const restoreRevision = (revision: NoteRevision) => {
    if (typeof window === 'undefined') return;
    const target = notes.find((note) => note.id === revision.noteId);
    if (!target) return;
    sessionStorage.setItem(
      'anotado_pending_history_restore',
      JSON.stringify({
        noteId: revision.noteId,
        content: revision.content,
        title: revision.title,
      })
    );
    openNote(revision.noteId, workspaceOf(target));
    setHistoryNoteId(null);
  };

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col bg-[#fbf9f4] dark:bg-[#000000] font-sans-ui text-[#1b1c19] dark:text-[#ededed]">
      <header className="h-14 shrink-0 border-b border-[#eae8e3] dark:border-[#1a1a1a] flex items-center justify-between px-4 sm:px-6 bg-[#fbf9f4]/95 dark:bg-[#000000]/95 backdrop-blur">
        <div className="flex items-center gap-2 min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2 rounded-lg hover:bg-[#eae8e3] dark:hover:bg-[#171717]"
              title="Voltar"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <BrainCircuit className="w-5 h-5 text-[#68594d]" />
          <div>
            <div className="font-serif-note font-bold text-base">Mapa de conhecimento</div>
            <div className="text-[10px] uppercase tracking-wider text-[#8c7e72]">
              conexões, contexto e exploração
            </div>
          </div>
        </div>

        <div className="hidden lg:flex items-center gap-1">
          {([
            ['map', 'Mapa', BrainCircuit],
            ['overview', 'Visão geral', LayoutDashboard],
            ['recent', 'Recentes', Zap],
            ['tasks', 'Tarefas', CheckSquare],
            ['templates', 'Modelos', BookOpen],
            ['history', 'Histórico', FileClock],
            ['ai', 'IA', Sparkles],
          ] as Array<[CenterTab, string, any]>).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={
                'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs ' +
                (tab === id
                  ? 'bg-[#eae8e3] dark:bg-[#1a1a1a] font-semibold'
                  : 'text-[#7f756e] hover:bg-[#f0eee9] dark:hover:bg-[#141414]')
              }
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <section className="flex-1 min-w-0 min-h-0 relative">
          {tab === 'map' && (
            <>
              <div className="absolute top-3 left-3 right-3 z-20 flex flex-wrap gap-2 pointer-events-none">
                <div className="pointer-events-auto flex items-center gap-1 bg-white/90 dark:bg-[#0b0b0b]/90 backdrop-blur border border-[#e4e2dd] dark:border-[#222] rounded-xl p-1.5 shadow-sm">
                  <button
                    onClick={() => setGraphMode('global')}
                    className={
                      'px-2.5 py-1.5 rounded-lg text-[11px] ' +
                      (graphMode === 'global' ? 'bg-[#68594d] text-white' : '')
                    }
                  >
                    Completo
                  </button>
                  <button
                    onClick={() => setGraphMode('local')}
                    disabled={!selectedId}
                    className={
                      'px-2.5 py-1.5 rounded-lg text-[11px] disabled:opacity-40 ' +
                      (graphMode === 'local' ? 'bg-[#68594d] text-white' : '')
                    }
                  >
                    Local
                  </button>
                  {graphMode === 'local' && (
                    <select
                      value={localDepth}
                      onChange={(e) => setLocalDepth(Number(e.target.value))}
                      className="bg-transparent text-[11px] px-1 outline-none"
                    >
                      {[1, 2, 3].map((depth) => (
                        <option key={depth} value={depth}>
                          {depth} nível{depth > 1 ? 'eis' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="pointer-events-auto flex items-center gap-1.5 bg-white/90 dark:bg-[#0b0b0b]/90 backdrop-blur border border-[#e4e2dd] dark:border-[#222] rounded-xl px-2.5 py-1.5 shadow-sm min-w-[220px]">
                  <Search className="w-3.5 h-3.5 text-[#7f756e]" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar no mapa…"
                    className="bg-transparent outline-none text-xs min-w-0 flex-1"
                  />
                  {search && (
                    <button onClick={() => setSearch('')}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <button
                  onClick={() => setShowFilters((value) => !value)}
                  className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/90 dark:bg-[#0b0b0b]/90 border border-[#e4e2dd] dark:border-[#222] shadow-sm text-[11px]"
                >
                  <Filter className="w-3.5 h-3.5" />
                  Filtros
                  <ChevronDown
                    className={
                      'w-3 h-3 transition-transform ' +
                      (showFilters ? '' : '-rotate-90')
                    }
                  />
                </button>

                {showFilters && (
                  <div className="pointer-events-auto w-full flex flex-wrap gap-3 items-center bg-white/90 dark:bg-[#0b0b0b]/90 backdrop-blur border border-[#e4e2dd] dark:border-[#222] rounded-xl px-3 py-2 shadow-sm text-[11px]">
                    <label className="flex items-center gap-1.5">
                      <span>Espaço</span>
                      <select
                        value={workspaceFilter}
                        onChange={(e) =>
                          setWorkspaceFilter(e.target.value as 'all' | 'notes' | 'diary')
                        }
                        className="bg-transparent outline-none"
                      >
                        <option value="all">Todos</option>
                        <option value="notes">Notas</option>
                        <option value="diary">Diário</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeDiary}
                        onChange={(e) => setIncludeDiary(e.target.checked)}
                      />
                      Incluir Diário
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={favoritesOnly}
                        onChange={(e) => setFavoritesOnly(e.target.checked)}
                      />
                      Favoritos
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={orphansOnly}
                        onChange={(e) => setOrphansOnly(e.target.checked)}
                      />
                      Órfãs
                    </label>
                    <label className="flex items-center gap-1.5">
                      Nó
                      <input
                        type="range"
                        min="0.65"
                        max="1.8"
                        step="0.05"
                        value={nodeScale}
                        onChange={(e) => setNodeScale(Number(e.target.value))}
                      />
                    </label>
                    <label className="flex items-center gap-1.5">
                      Link
                      <input
                        type="range"
                        min="0.5"
                        max="4"
                        step="0.25"
                        value={linkWidth}
                        onChange={(e) => setLinkWidth(Number(e.target.value))}
                      />
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showArrows}
                        onChange={(e) => setShowArrows(e.target.checked)}
                      />
                      Setas
                    </label>
                    <button
                      onClick={() => {
                        setSearch('');
                        setWorkspaceFilter('all');
                        setFavoritesOnly(false);
                        setOrphansOnly(false);
                      }}
                      className="ml-auto text-[#68594d] hover:underline"
                    >
                      Limpar
                    </button>
                  </div>
                )}
              </div>

              <div className="absolute bottom-3 left-3 z-20 flex items-center gap-1.5">
                <button
                  onClick={() =>
                    graphRef.current?.zoom?.(
                      Math.max(0.2, (graphRef.current?.zoom?.() || 1) * 0.8),
                      300
                    )
                  }
                  className="p-2 rounded-xl bg-white/90 dark:bg-[#0b0b0b]/90 border border-[#e4e2dd] dark:border-[#222] shadow-sm"
                  title="Afastar"
                >
                  −
                </button>
                <button
                  onClick={() =>
                    graphRef.current?.zoom?.(
                      Math.min(8, (graphRef.current?.zoom?.() || 1) * 1.25),
                      300
                    )
                  }
                  className="p-2 rounded-xl bg-white/90 dark:bg-[#0b0b0b]/90 border border-[#e4e2dd] dark:border-[#222] shadow-sm"
                  title="Aproximar"
                >
                  +
                </button>
                <button
                  onClick={focusGraph}
                  className="p-2 rounded-xl bg-white/90 dark:bg-[#0b0b0b]/90 border border-[#e4e2dd] dark:border-[#222] shadow-sm"
                  title="Enquadrar grafo"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>

              <ForceGraph2D
                ref={graphRef}
                graphData={visible}
                backgroundColor="transparent"
                nodeLabel={(node: KnowledgeGraphNode) =>
                  node.label + '\n' + node.folderPath
                }
                nodeVal={(node: KnowledgeGraphNode) =>
                  Math.max(1.2, (1 + node.degree * 0.45) * nodeScale)
                }
                linkWidth={() => linkWidth}
                linkDirectionalArrowLength={showArrows ? 4 : 0}
                linkDirectionalArrowRelPos={0.82}
                linkColor={() => (theme === 'dark' ? 'rgba(255,255,255,.22)' : 'rgba(104,89,77,.24)')}
                d3AlphaDecay={0.03}
                d3VelocityDecay={0.35}
                onNodeClick={(node: KnowledgeGraphNode) => {
                  const now = Date.now();
                  if (
                    lastNodeClickRef.current.id === node.id &&
                    now - lastNodeClickRef.current.time < 360
                  ) {
                    openNote(node.id, node.workspace);
                    lastNodeClickRef.current = { id: '', time: 0 };
                    return;
                  }
                  lastNodeClickRef.current = { id: node.id, time: now };
                  setSelectedId(node.id);
                }}
                onNodeRightClick={(node: KnowledgeGraphNode) => setSelectedId(node.id)}
                nodeCanvasObject={(
                  node: KnowledgeGraphNode,
                  ctx: CanvasRenderingContext2D,
                  globalScale: number
                ) => {
                  const selected = node.id === selectedId;
                  const radius =
                    Math.sqrt(Math.max(1, node.degree + 1)) * 2.25 * nodeScale +
                    (selected ? 2 : 0);
                  const color =
                    node.workspace === 'diary'
                      ? '#b8864a'
                      : node.isFavorite
                      ? '#d89b2e'
                      : '#68594d';

                  ctx.beginPath();
                  ctx.fillStyle = selected ? (theme === 'dark' ? '#ffffff' : '#2d2620') : color;
                  ctx.strokeStyle = selected ? (theme === 'dark' ? '#000000' : '#f4dfcb') : (theme === 'dark' ? '#444444' : '#ffffff');
                  ctx.lineWidth = selected ? 2 : 1;
                  ctx.arc(node.x || 0, node.y || 0, radius, 0, 2 * Math.PI);
                  ctx.fill();
                  ctx.stroke();

                  if (globalScale > 0.75 || selected) {
                    ctx.font =
                      (selected ? '600 ' : '500 ') +
                      Math.max(9, 11 / globalScale * 0.75) +
                      'px Manrope, sans-serif';
                    ctx.fillStyle = theme === 'dark' ? '#f2f2f2' : '#3b332d';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(
                      node.label.slice(0, 32),
                      (node.x || 0) + radius + 4,
                      node.y || 0
                    );
                  }
                }}
              />
            </>
          )}

          {tab === 'overview' && (
            <div className="h-full overflow-y-auto p-5 sm:p-7">
              <div className="max-w-6xl mx-auto grid grid-cols-2 xl:grid-cols-4 gap-3">
                {[
                  ['Notas', stats.notes, FileClock],
                  ['Diário', stats.diary, CalendarDays],
                  ['Conexões', stats.links, BrainCircuit],
                  ['Órfãs', stats.orphans, Zap],
                ].map(([label, value, Icon]: any) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-[#eae8e3] dark:border-[#1f1f1f] bg-white/60 dark:bg-[#080808] p-4"
                  >
                    <div className="flex items-center gap-2 text-[#7f756e] text-xs">
                      <Icon className="w-4 h-4" />
                      {label}
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{value}</div>
                  </div>
                ))}
              </div>

              <div className="max-w-6xl mx-auto grid lg:grid-cols-3 gap-4 mt-4">
                <div className="lg:col-span-2 rounded-2xl border border-[#eae8e3] dark:border-[#1f1f1f] bg-white/60 dark:bg-[#080808] p-4">
                  <div className="font-semibold text-sm mb-3">Hubs da sua base</div>
                  <div className="space-y-1.5">
                    {stats.top.map((node) => (
                      <button
                        key={node.id}
                        onClick={() => {
                          setSelectedId(node.id);
                          setTab('map');
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-[#f0eee9] dark:hover:bg-[#141414] text-left"
                      >
                        <span className="truncate text-sm">{node.label}</span>
                        <span className="text-[11px] text-[#8c7e72]">
                          {node.inbound} entradas / {node.outbound} saídas
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-[#eae8e3] dark:border-[#1f1f1f] bg-white/60 dark:bg-[#080808] p-4">
                  <div className="font-semibold text-sm mb-3">Favoritos</div>
                  <div className="space-y-1.5">
                    {graph.nodes
                      .filter((node) => node.isFavorite)
                      .slice(0, 8)
                      .map((node) => (
                        <button
                          key={node.id}
                          onClick={() => openNote(node.id, node.workspace)}
                          className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#f0eee9] dark:hover:bg-[#141414]"
                        >
                          <div className="flex items-center gap-2">
                            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
                            <span className="text-sm truncate">{node.label}</span>
                          </div>
                        </button>
                      ))}
                    {graph.nodes.every((node) => !node.isFavorite) && (
                      <div className="text-xs text-[#8c7e72]">Nenhum favorito.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'recent' && (
            <div className="h-full overflow-y-auto p-5 sm:p-7 max-w-4xl mx-auto">
              <div className="font-serif-note font-bold text-xl">Recentes</div>
              <div className="text-xs text-[#8c7e72] mb-5 mt-1">
                Histórico de abertura neste dispositivo.
              </div>
              <div className="space-y-2">
                {recentNotes.map((note) => (
                  <button
                    key={note.id}
                    onClick={() => openNote(note.id, workspaceOf(note))}
                    className="w-full flex items-center justify-between gap-3 p-3 rounded-2xl border border-[#eae8e3] dark:border-[#1f1f1f] bg-white/60 dark:bg-[#080808] hover:bg-[#f4f1ea] dark:hover:bg-[#121212] text-left"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">
                        {note.title || 'Sem título'}
                      </div>
                      <div className="text-xs text-[#8c7e72] mt-0.5 truncate">
                        {workspaceOf(note) === 'diary' ? 'Diário' : 'Notas'} ·{' '}
                        {stripMarkdown(note.content || '').slice(0, 100)}
                      </div>
                    </div>
                    <ArrowUpRight className="w-4 h-4 shrink-0 text-[#8c7e72]" />
                  </button>
                ))}
                {!recentNotes.length && (
                  <div className="text-sm text-[#8c7e72]">
                    Ainda não há notas recentes.
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'tasks' && (
            <div className="h-full overflow-y-auto p-5 sm:p-7 max-w-4xl mx-auto">
              <div className="font-serif-note font-bold text-xl">Tarefas</div>
              <div className="text-xs text-[#8c7e72] mt-1 mb-5">
                {tasks.open} abertas · {tasks.done} concluídas
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {notes.map((note) => {
                  const openCount =
                    (note.content || '').match(/(?:^|\n)\s*[-*]\s*\[\s\]/g)?.length || 0;
                  const doneCount =
                    (note.content || '').match(/(?:^|\n)\s*[-*]\s*\[[xX]\]/g)?.length || 0;
                  if (!openCount && !doneCount) return null;
                  return (
                    <button
                      key={note.id}
                      onClick={() => openNote(note.id, workspaceOf(note))}
                      className="text-left p-4 rounded-2xl border border-[#eae8e3] dark:border-[#1f1f1f] bg-white/60 dark:bg-[#080808]"
                    >
                      <div className="font-medium text-sm truncate">
                        {note.title || 'Sem título'}
                      </div>
                      <div className="text-xs text-[#8c7e72] mt-1">
                        {openCount} abertas · {doneCount} concluídas
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'templates' && (
            <div className="h-full overflow-y-auto p-5 sm:p-7">
              <div className="max-w-5xl mx-auto">
                <div className="font-serif-note font-bold text-xl">Modelos</div>
                <div className="text-xs text-[#8c7e72] mt-1 mb-5">
                  Crie notas estruturadas em segundos.
                </div>

                <div className="grid md:grid-cols-3 gap-3">
                  {templates.map((template) => (
                    <div
                      key={template.id}
                      className="rounded-2xl border border-[#eae8e3] dark:border-[#1f1f1f] bg-white/60 dark:bg-[#080808] p-4"
                    >
                      <div className="font-semibold text-sm">{template.title}</div>
                      <div className="text-xs text-[#8c7e72] mt-2 line-clamp-5">
                        {stripMarkdown(template.content)}
                      </div>
                      <button
                        onClick={() => applyTemplate(template)}
                        className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#68594d] text-white text-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Usar modelo
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-6 rounded-2xl border border-[#eae8e3] dark:border-[#1f1f1f] bg-white/60 dark:bg-[#080808] p-4">
                  <div className="font-semibold text-sm mb-3">Novo modelo</div>
                  <input
                    value={templateTitle}
                    onChange={(e) => setTemplateTitle(e.target.value)}
                    placeholder="Nome do modelo"
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#111] border border-[#e4e2dd] dark:border-[#222] text-sm outline-none"
                  />
                  <textarea
                    value={templateContent}
                    onChange={(e) => setTemplateContent(e.target.value)}
                    placeholder="Conteúdo..."
                    rows={8}
                    className="mt-2 w-full px-3 py-2 rounded-xl bg-white dark:bg-[#111] border border-[#e4e2dd] dark:border-[#222] text-sm outline-none"
                  />
                  <button
                    onClick={saveTemplate}
                    className="mt-2 px-3 py-2 rounded-xl bg-[#68594d] text-white text-xs"
                  >
                    Salvar modelo
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'history' && (
            <div className="h-full overflow-y-auto p-5 sm:p-7 max-w-4xl mx-auto">
              <div className="font-serif-note font-bold text-xl">Histórico</div>
              <div className="text-xs text-[#8c7e72] mt-1 mb-5">
                Histórico local por nota, neste dispositivo.
              </div>

              <div className="grid lg:grid-cols-2 gap-3">
                <div className="space-y-2">
                  {notes
                    .filter((note) => getNoteHistory(note.id).length > 0)
                    .map((note) => (
                      <button
                        key={note.id}
                        onClick={() => setHistoryNoteId(note.id)}
                        className="w-full text-left p-3 rounded-2xl border border-[#eae8e3] dark:border-[#1f1f1f] bg-white/60 dark:bg-[#080808]"
                      >
                        <div className="font-medium text-sm truncate">
                          {note.title || 'Sem título'}
                        </div>
                        <div className="text-xs text-[#8c7e72] mt-1">
                          {getNoteHistory(note.id).length} versões
                        </div>
                      </button>
                    ))}
                </div>

                <div className="rounded-2xl border border-[#eae8e3] dark:border-[#1f1f1f] bg-white/60 dark:bg-[#080808] p-4 min-h-40">
                  {!historyNoteId ? (
                    <div className="text-sm text-[#8c7e72]">
                      Selecione uma nota para ver as versões.
                    </div>
                  ) : (
                    <>
                      <div className="font-semibold text-sm mb-3">
                        {notes.find((note) => note.id === historyNoteId)?.title || 'Nota'}
                      </div>
                      <div className="space-y-2">
                        {history.map((revision) => (
                          <button
                            key={revision.id}
                            onClick={() => restoreRevision(revision)}
                            className="w-full text-left p-3 rounded-xl hover:bg-[#f0eee9] dark:hover:bg-[#151515]"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium">
                                {new Date(revision.createdAt).toLocaleString('pt-BR')}
                              </span>
                              <History className="w-3.5 h-3.5" />
                            </div>
                            <div className="text-[11px] text-[#8c7e72] mt-1">
                              {revision.reason}
                            </div>
                            <div className="text-xs text-[#6e655f] dark:text-[#9b9b9b] mt-1 line-clamp-2">
                              {stripMarkdown(revision.content)}
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'ai' && (
            <div className="h-full overflow-y-auto p-5 sm:p-7 max-w-4xl mx-auto">
              <div className="font-serif-note font-bold text-xl">Assistente do ANOTADO</div>
              <div className="text-xs text-[#8c7e72] mt-1 mb-5">
                Pergunte sobre as suas notas e o Diário.
              </div>

              <div className="rounded-2xl border border-[#eae8e3] dark:border-[#1f1f1f] bg-white/60 dark:bg-[#080808] p-4">
                <textarea
                  value={aiQuestion}
                  onChange={(e) => setAiQuestion(e.target.value)}
                  placeholder="Ex.: quais notas citam blockchain e quais são as principais conclusões?"
                  rows={5}
                  className="w-full bg-transparent outline-none text-sm resize-none"
                />
                <div className="flex justify-end">
                  <button
                    disabled={aiBusy || !aiQuestion.trim()}
                    onClick={askAi}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#68594d] text-white text-xs disabled:opacity-40"
                  >
                    <Sparkles className="w-4 h-4" />
                    {aiBusy ? 'Consultando…' : 'Perguntar'}
                  </button>
                </div>
              </div>

              {aiAnswer && (
                <div className="mt-3 rounded-2xl border border-[#eae8e3] dark:border-[#1f1f1f] bg-white/60 dark:bg-[#080808] p-4 text-sm leading-6 whitespace-pre-wrap">
                  {aiAnswer}
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="w-full lg:w-[340px] shrink-0 border-t lg:border-t-0 lg:border-l border-[#eae8e3] dark:border-[#1a1a1a] bg-[#f7f4ee] dark:bg-[#050505] overflow-y-auto">
          <div className="p-4 sm:p-5">
            {selectedNode ? (
              <>
                <div className="text-[10px] uppercase tracking-wider text-[#8c7e72]">
                  {selectedNode.workspace === 'diary' ? 'Diário' : 'Notas'}
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-serif-note font-bold text-lg mt-1 truncate">
                      {selectedNode.label}
                    </h2>
                    <div className="text-xs text-[#8c7e72] mt-1 truncate">
                      {selectedNode.folderPath}
                    </div>
                  </div>
                  {selectedNode.isFavorite && (
                    <Star className="w-4 h-4 fill-amber-400 text-amber-500 shrink-0" />
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 mt-4">
                  <div className="rounded-xl bg-white/70 dark:bg-[#0a0a0a] p-2">
                    <div className="text-[10px] text-[#8c7e72]">Entradas</div>
                    <div className="font-semibold">{selectedNode.inbound}</div>
                  </div>
                  <div className="rounded-xl bg-white/70 dark:bg-[#0a0a0a] p-2">
                    <div className="text-[10px] text-[#8c7e72]">Saídas</div>
                    <div className="font-semibold">{selectedNode.outbound}</div>
                  </div>
                  <div className="rounded-xl bg-white/70 dark:bg-[#0a0a0a] p-2">
                    <div className="text-[10px] text-[#8c7e72]">Total</div>
                    <div className="font-semibold">{selectedNode.degree}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    onClick={() =>
                      openNote(selectedNode.id, selectedNode.workspace)
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#68594d] text-white text-xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Abrir nota
                  </button>
                  <button
                    onClick={() => {
                      setGraphMode('local');
                      setTab('map');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#e4e2dd] dark:border-[#2a2a2a] text-xs"
                  >
                    <BrainCircuit className="w-3.5 h-3.5" />
                    Explorar conexões
                  </button>
                </div>

                <div className="mt-5">
                  <div className="text-xs font-semibold mb-2">Resumo</div>
                  <p className="text-xs leading-5 text-[#6f675f] dark:text-[#aaa]">
                    {stripMarkdown(selectedRaw?.content || '').slice(0, 550) ||
                      'Sem conteúdo carregado.'}
                  </p>
                </div>

                <div className="mt-5">
                  <div className="text-xs font-semibold mb-2">Conexões diretas</div>
                  <div className="space-y-1">
                    {graph.links
                      .filter(
                        (link) =>
                          link.source === selectedNode.id ||
                          link.target === selectedNode.id
                      )
                      .slice(0, 20)
                      .map((link) => {
                        const id =
                          link.source === selectedNode.id
                            ? link.target
                            : link.source;
                        const target = graph.nodes.find((node) => node.id === id);
                        if (!target) return null;
                        return (
                          <button
                            key={link.source + '>' + link.target}
                            onClick={() => {
                              setSelectedId(id);
                              setTab('map');
                            }}
                            className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-[#ece8e1] dark:hover:bg-[#121212] flex items-center justify-between gap-2"
                          >
                            <span className="text-xs truncate">{target.label}</span>
                            <ArrowUpRight className="w-3.5 h-3.5 text-[#8c7e72]" />
                          </button>
                        );
                      })}
                    {!graph.links.some(
                      (link) =>
                        link.source === selectedNode.id ||
                        link.target === selectedNode.id
                    ) && (
                      <div className="text-xs text-[#8c7e72]">
                        Nenhuma conexão direta.
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-[#8c7e72]">
                Selecione uma nota no mapa.
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-[#eae8e3] dark:border-[#1a1a1a]">
              <div className="text-xs font-semibold">Calendário do Diário</div>
              <div className="flex items-center justify-between mt-3 mb-2 text-xs">
                <button
                  onClick={() =>
                    setCalendarCursor((cursor) =>
                      cursor.month === 0
                        ? { year: cursor.year - 1, month: 11 }
                        : { year: cursor.year, month: cursor.month - 1 }
                    )
                  }
                >
                  ‹
                </button>
                <span>
                  {new Date(
                    calendarCursor.year,
                    calendarCursor.month
                  ).toLocaleDateString('pt-BR', {
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
                <button
                  onClick={() =>
                    setCalendarCursor((cursor) =>
                      cursor.month === 11
                        ? { year: cursor.year + 1, month: 0 }
                        : { year: cursor.year, month: cursor.month + 1 }
                    )
                  }
                >
                  ›
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((day, index) => (
                  <div key={index} className="text-[10px] opacity-60">
                    {day}
                  </div>
                ))}
                {calendarCells(calendarCursor.year, calendarCursor.month).map(
                  (day, index) => {
                    if (!day) return <div key={index} />;
                    const date =
                      calendarCursor.year +
                      '-' +
                      String(calendarCursor.month + 1).padStart(2, '0') +
                      '-' +
                      String(day).padStart(2, '0');
                    const note = diaryNotes.find(
                      (item) => item.entry_date === date
                    );
                    return (
                      <button
                        key={index}
                        onClick={() => note && openNote(note.id, 'diary')}
                        className={
                          'h-7 rounded-lg text-[10px] ' +
                          (note
                            ? 'bg-[#f4dfcb] dark:bg-[#2e2620] text-[#5e4b3e] dark:text-[#f4dfcb]'
                            : 'hover:bg-black/5 dark:hover:bg-white/5')
                        }
                      >
                        {day}
                      </button>
                    );
                  }
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

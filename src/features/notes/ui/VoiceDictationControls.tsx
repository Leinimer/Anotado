'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { Mic, Pause, Play, Square, AlertCircle } from 'lucide-react';

type DictationMode = 'idle' | 'listening' | 'paused';

type SpeechResult = {
  0: { transcript: string };
  isFinal: boolean;
};

type SpeechResultEvent = Event & {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
};

type SpeechErrorEvent = Event & {
  error: string;
  message?: string;
};

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

interface DictationRange {
  from: number;
  length: number;
}

interface VoiceDictationControlsProps {
  editor: Editor | null;
  activeNoteId?: string | null;
}

export function VoiceDictationControls({ editor, activeNoteId }: VoiceDictationControlsProps) {
  const [mode, setMode] = useState<DictationMode>('idle');
  const [error, setError] = useState('');
  const [interimText, setInterimText] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const modeRef = useRef<DictationMode>('idle');
  const rangeRef = useRef<DictationRange | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const updateMode = useCallback((nextMode: DictationMode) => {
    modeRef.current = nextMode;
    if (mountedRef.current) setMode(nextMode);
  }, []);

  const insertTranscriptPreview = useCallback((text: string) => {
    if (!editor || !text) return;
    const range = rangeRef.current;
    if (!range) return;

    const from = Math.max(1, Math.min(range.from, editor.state.doc.content.size));
    const to = Math.max(from, Math.min(range.from + range.length, editor.state.doc.content.size));

    try {
      const tr = editor.state.tr.insertText(text, from, to);
      const cursorPosition = Math.min(from + text.length, tr.doc.content.size);
      tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPosition), 1));
      editor.view.dispatch(tr);
      rangeRef.current = { from, length: text.length };
      if (mountedRef.current) setInterimText(text);
    } catch (cause) {
      console.warn('[VoiceDictation] Não foi possível inserir a transcrição no editor:', cause);
    }
  }, [editor]);

  const captureCurrentSelection = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    rangeRef.current = { from, length: Math.max(0, to - from) };
    setInterimText('');
  }, [editor]);

  const startRecognition = useCallback(() => {
    if (!editor || typeof window === 'undefined') return false;

    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

    if (!Recognition) {
      updateMode('idle');
      setError('Este navegador não oferece ditado por voz. Use uma versão atual do Chrome ou Edge.');
      return false;
    }

    try {
      const recognition = new Recognition();
      recognition.lang = 'pt-BR';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event) => {
        // O navegador devolve resultados finais e provisórios. Substituímos apenas
        // o trecho desta sessão para que o texto provisório não seja duplicado.
        let transcript = '';
        for (let index = 0; index < event.results.length; index += 1) {
          const item = event.results[index];
          const part = item?.[0]?.transcript || '';
          if (!part) continue;
          if (
            transcript &&
            !/\\s$/.test(transcript) &&
            !/^\\s/.test(part) &&
            !/^[,.;:!?]/.test(part)
          ) {
            transcript += ' ';
          }
          transcript += part;
        }

        const normalized = transcript.replace(/[\\t ]+/g, ' ').replace(/^\\s+/, '');
        if (normalized) insertTranscriptPreview(normalized);
      };

      recognition.onerror = (event) => {
        const fatalErrors = ['not-allowed', 'service-not-allowed', 'audio-capture'];
        if (fatalErrors.includes(event.error)) {
          updateMode('idle');
          const messages: Record<string, string> = {
            'not-allowed': 'Permita o acesso ao microfone nas configurações do navegador.',
            'service-not-allowed': 'O serviço de reconhecimento de voz não está disponível.',
            'audio-capture': 'Nenhum microfone disponível foi encontrado.',
          };
          setError(messages[event.error] || 'Não foi possível iniciar o ditado.');
        } else if (event.error === 'network') {
          setError('A conexão com o serviço de reconhecimento foi interrompida. Tente retomar o ditado.');
          updateMode('paused');
        }
      };

      recognition.onend = () => {
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
        }

        if (modeRef.current !== 'listening') return;

        // Alguns navegadores encerram uma sessão contínua após períodos de silêncio.
        // Reabrimos o reconhecimento a partir do ponto em que o texto foi inserido.
        const currentRange = rangeRef.current;
        if (currentRange) {
          const nextPosition = Math.min(
            currentRange.from + currentRange.length,
            editor.state.doc.content.size
          );
          rangeRef.current = { from: nextPosition, length: 0 };
        }

        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          if (modeRef.current === 'listening') startRecognition();
        }, 250);
      };

      recognitionRef.current = recognition;
      recognition.start();
      setError('');
      return true;
    } catch (cause) {
      console.warn('[VoiceDictation] Falha ao iniciar reconhecimento:', cause);
      updateMode('paused');
      setError('Não foi possível iniciar o microfone. Tente novamente.');
      return false;
    }
  }, [editor, insertTranscriptPreview, updateMode]);

  const handleStart = useCallback(() => {
    if (!editor) return;
    captureCurrentSelection();
    setError('');
    updateMode('listening');
    startRecognition();
  }, [editor, captureCurrentSelection, startRecognition, updateMode]);

  const handlePause = useCallback(() => {
    // O modo muda antes de stop() para impedir que onend reinicie automaticamente.
    updateMode('paused');
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    recognitionRef.current?.stop();
  }, [updateMode]);

  const handleResume = useCallback(() => {
    if (!editor) return;
    // O usuário pode editar a nota enquanto pausado. A retomada começa
    // exatamente na posição atual do cursor/seleção, sem apagar o texto anterior.
    captureCurrentSelection();
    setError('');
    updateMode('listening');
    startRecognition();
  }, [editor, captureCurrentSelection, startRecognition, updateMode]);

  const handleFinish = useCallback(() => {
    updateMode('idle');
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    rangeRef.current = null;
    setInterimText('');
    setError('');
  }, [updateMode]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      modeRef.current = 'idle';
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      recognitionRef.current?.abort?.();
      recognitionRef.current = null;
    };
  }, [editor, activeNoteId]);

  const baseButton =
    'min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 shrink-0';

  if (mode === 'idle') {
    return (
      <div className="flex items-center gap-1 shrink-0" title="Ditado em português (Brasil)">
        <button
          id="toolbar-btn-voice-dictation"
          type="button"
          onClick={handleStart}
          className={`${baseButton} text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] dark:text-[#d4d4d4] dark:hover:bg-[#222222] dark:hover:text-white`}
          title="Ditar na nota"
          aria-label="Iniciar ditado por voz"
        >
          <Mic className="w-4.5 h-4.5" />
        </button>
        {error && (
          <span className="max-w-[190px] text-[10px] leading-tight text-[#ba1a1a] dark:text-[#fca5a5]" role="status">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1 rounded-xl border border-[#e4e2dd] dark:border-[#393939] bg-[#f5f3ee] dark:bg-[#111111] px-1 shrink-0"
      title={mode === 'listening' ? 'O texto reconhecido aparece na nota em tempo real' : 'Ditado pausado; edite o texto e retome quando quiser'}
    >
      <span
        className={`hidden sm:inline-flex items-center gap-1.5 px-1.5 text-[10px] font-sans-ui whitespace-nowrap ${
          mode === 'listening' ? 'text-[#ba1a1a] dark:text-[#fca5a5]' : 'text-[#7f756e] dark:text-[#a3a3a3]'
        }`}
        aria-live="polite"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${mode === 'listening' ? 'bg-[#dc2626] animate-pulse' : 'bg-[#a1a1aa]'}`} />
        {mode === 'listening' ? 'Ditando' : 'Pausado'}
      </span>

      {mode === 'listening' ? (
        <button
          id="toolbar-btn-voice-pause"
          type="button"
          onClick={handlePause}
          className={`${baseButton} text-[#4e453f] hover:bg-[#e8e4db] dark:text-[#e5e5e5] dark:hover:bg-[#262626]`}
          title="Pausar para editar a nota"
          aria-label="Pausar ditado"
        >
          <Pause className="w-4 h-4" />
        </button>
      ) : (
        <button
          id="toolbar-btn-voice-resume"
          type="button"
          onClick={handleResume}
          className={`${baseButton} text-[#166534] hover:bg-[#dcfce7] dark:text-[#86efac] dark:hover:bg-[#14251a]`}
          title="Retomar ditado no cursor"
          aria-label="Retomar ditado"
        >
          <Play className="w-4 h-4" />
        </button>
      )}

      <button
        id="toolbar-btn-voice-finish"
        type="button"
        onClick={handleFinish}
        className={`${baseButton} text-[#ba1a1a] hover:bg-[#fee2e2] dark:text-[#fca5a5] dark:hover:bg-[#351515]`}
        title="Finalizar ditado"
        aria-label="Finalizar ditado"
      >
        <Square className="w-3.5 h-3.5" />
      </button>

      {error && (
        <span className="hidden md:inline text-[10px] text-[#ba1a1a] dark:text-[#fca5a5] max-w-[150px]" role="status">
          {error}
        </span>
      )}
      {interimText && (
        <span className="sr-only" aria-live="polite">
          {interimText}
        </span>
      )}
    </div>
  );
}

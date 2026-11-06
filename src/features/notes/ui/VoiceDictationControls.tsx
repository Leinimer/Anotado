'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { Mic, Pause, Play, Square, AlertCircle, Info } from 'lucide-react';
import { LocalWhisperDictationEngine } from './LocalWhisperDictationEngine';

export type DictationMode = 'idle' | 'listening' | 'paused';

/**
 * Interface preparada para futura expansão de transcrição de arquivos de áudio
 * (ex.: MP3, WAV, M4A, WebM utilizando Transformers.js / Whisper no cliente).
 */
export interface AudioTranscriptionProvider {
  transcribeFile: (file: File, options?: { language?: string }) => Promise<string>;
}

type SpeechResult = {
  0: { transcript: string };
  isFinal: boolean;
  length: number;
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

interface VoiceDictationControlsProps {
  editor: Editor | null;
  activeNoteId?: string | null;
}

export function VoiceDictationControls({ editor, activeNoteId }: VoiceDictationControlsProps) {
  const [mode, setMode] = useState<DictationMode>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [showPrivacyNotice, setShowPrivacyNotice] = useState<boolean>(false);
  const [engineStatus, setEngineStatus] = useState<string>('');

  // Instância ativa do SpeechRecognition
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const localEngineRef = useRef<LocalWhisperDictationEngine | null>(null);
  const modeRef = useRef<DictationMode>('idle');

  // Controle pontual da posição no ProseMirror/Tiptap:
  // sessionAnchorPosRef: posição no documento onde o segmento atual começa
  // interimLengthRef: quantos caracteres provisórios (interim) estão renderizados nessa âncora
  // confirmedIndexRef: índice dos resultados de SpeechRecognition já consolidados permanentemente
  const sessionAnchorPosRef = useRef<number>(1);
  const interimLengthRef = useRef<number>(0);
  const confirmedIndexRef = useRef<number>(0);

  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStoppingRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(true);

  const updateMode = useCallback((nextMode: DictationMode) => {
    modeRef.current = nextMode;
    if (mountedRef.current) {
      setMode(nextMode);
    }
  }, []);

  /**
   * Dispara aviso toast global do Anotado
   */
  const showToast = useCallback((message: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('anotado:toast-warning', {
          detail: { message },
        })
      );
    }
  }, []);

  /**
   * Aplica uma alteração de texto pontual no editor Tiptap usando transações do ProseMirror.
   * - Substitui apenas a fatia provisória [anchor, anchor + interimLength]
   * - Quando isFinal === true, avança a âncora e zera a fatia provisória, consolidando o texto permanentemente.
   * - Não duplica palavras nem substitui o documento inteiro.
   */
  const applyTranscriptTransaction = useCallback(
    (text: string, isFinal: boolean) => {
      if (!editor || !editor.view) return;

      const docSize = editor.state.doc.content.size;
      const anchor = Math.max(1, Math.min(sessionAnchorPosRef.current, docSize));
      const replaceTo = Math.max(anchor, Math.min(anchor + interimLengthRef.current, docSize));

      let textToInsert = text;

      // Adiciona espaço anterior apenas se necessário (ex.: precedido por palavra sem espaço)
      if (anchor > 1 && !/^[\s,.;:!?)]/.test(textToInsert) && interimLengthRef.current === 0) {
        try {
          const charBefore = editor.state.doc.textBetween(anchor - 1, anchor, '', '');
          if (charBefore && !/\s/.test(charBefore)) {
            textToInsert = ` ${textToInsert}`;
          }
        } catch {
          // Fallback silencioso caso posição seja limite de bloco
        }
      }

      try {
        const tr = editor.state.tr.insertText(textToInsert, anchor, replaceTo);
        const newCursorPos = Math.min(anchor + textToInsert.length, tr.doc.content.size);
        tr.setSelection(TextSelection.near(tr.doc.resolve(newCursorPos), 1));
        tr.scrollIntoView();
        editor.view.dispatch(tr);

        if (isFinal) {
          // Texto confirmado definitivamente: avança a âncora para após o texto confirmado
          sessionAnchorPosRef.current = newCursorPos;
          interimLengthRef.current = 0;
        } else {
          // Texto provisório: mantém a âncora fixa e atualiza o comprimento da fatia a ser substituída
          sessionAnchorPosRef.current = anchor;
          interimLengthRef.current = textToInsert.length;
        }
      } catch (err) {
        console.warn('[VoiceDictation] Erro ao aplicar transação de fala no Tiptap:', err);
      }
    },
    [editor]
  );

  /**
   * Consolida qualquer texto provisório pendente na posição atual, transformando-o em permanente
   */
  const commitPendingInterim = useCallback(() => {
    if (interimLengthRef.current > 0) {
      sessionAnchorPosRef.current += interimLengthRef.current;
      interimLengthRef.current = 0;
    }
  }, []);

  /**
   * Fallback independente do serviço de voz do navegador.
   * Usa Whisper local em Worker quando Chrome/Edge retorna erro de rede.
   */
  const startLocalFallback = useCallback(async () => {
    if (!editor || localEngineRef.current) return;

    const engine = new LocalWhisperDictationEngine({
      onTranscript: (text) => {
        applyTranscriptTransaction(text, true);
      },
      onStatus: (message) => {
        if (mountedRef.current) setEngineStatus(message);
      },
      onError: (message) => {
        if (mountedRef.current) {
          setErrorMessage(message);
          showToast(message);
        }
      },
    });

    localEngineRef.current = engine;
    setErrorMessage('');
    setEngineStatus('Ativando transcrição local e preparando o modelo Whisper…');

    try {
      await engine.start();
      if (mountedRef.current) {
        setErrorMessage('');
        setEngineStatus('Ditado local ativo');
      }
    } catch (error) {
      console.error('[VoiceDictation] Fallback local falhou:', error);
      try {
        await engine.stop();
      } catch {}
      if (localEngineRef.current === engine) localEngineRef.current = null;
      if (!mountedRef.current) return;

      updateMode('paused');
      const detail = error instanceof Error ? error.message : 'Erro desconhecido';
      const message = `Não foi possível ativar o ditado local: ${detail}`;
      setErrorMessage(message);
      setEngineStatus('');
      showToast(message);
    }
  }, [applyTranscriptTransaction, editor, showToast, updateMode]);

  /**
   * Inicia o motor Web Speech API nativo
   */
  const startRecognitionSession = useCallback(() => {
    if (!editor || typeof window === 'undefined') return false;

    // Se já houver instância ativa, não recria
    if (recognitionRef.current) return true;

    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

    if (!Recognition) {
      void startLocalFallback();
      return true;
    }

    try {
      const recognition = new Recognition();
      recognition.lang = 'pt-BR';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: SpeechResultEvent) => {
        if (!editor || !editor.view) return;

        // 1. Processa novos resultados definitivos (isFinal === true)
        let hasNewFinal = false;
        for (let i = confirmedIndexRef.current; i < event.results.length; i++) {
          const item = event.results[i];
          if (item.isFinal) {
            const finalPart = (item[0]?.transcript || '').trim();
            if (finalPart) {
              applyTranscriptTransaction(finalPart, true);
            }
            confirmedIndexRef.current = i + 1;
            hasNewFinal = true;
          }
        }

        // 2. Coleta os resultados provisórios (isFinal === false) que ainda não foram consolidados
        let interimCombined = '';
        for (let i = confirmedIndexRef.current; i < event.results.length; i++) {
          const item = event.results[i];
          if (!item.isFinal) {
            const part = (item[0]?.transcript || '').trim();
            if (part) {
              if (interimCombined) interimCombined += ' ';
              interimCombined += part;
            }
          }
        }

        if (interimCombined) {
          applyTranscriptTransaction(interimCombined, false);
        } else if (hasNewFinal && interimLengthRef.current > 0) {
          interimLengthRef.current = 0;
        }
      };

      recognition.onerror = (event: SpeechErrorEvent) => {
        // Ignora eventos tardios gerados por stop()/abort() após uma troca de motor.
        if (isStoppingRef.current && event.error !== 'not-allowed') return;
        // 'no-speech' é um evento normal quando o usuário faz pausas ao falar
        if (event.error === 'no-speech') {
          return;
        }

        if (event.error === 'not-allowed') {
          updateMode('idle');
          isStoppingRef.current = true;
          const msg = 'Acesso ao microfone negado. Permita o uso do microfone no navegador.';
          setErrorMessage(msg);
          showToast(msg);
        } else if (event.error === 'audio-capture') {
          updateMode('idle');
          isStoppingRef.current = true;
          const msg = 'Nenhum microfone encontrado. Verifique se ele está conectado e tente novamente.';
          setErrorMessage(msg);
          showToast(msg);
        } else if (
          event.error === 'network' ||
          event.error === 'service-not-allowed' ||
          event.error === 'language-not-supported'
        ) {
          // O Chrome pode depender de um serviço remoto de voz. Em caso de falha,
          // não pede ao usuário para tentar o mesmo serviço novamente: muda para Whisper local.
          isStoppingRef.current = true;
          commitPendingInterim();
          try {
            recognition.stop();
          } catch {}
          recognitionRef.current = null;
          setErrorMessage('');
          setEngineStatus('Serviço de voz do navegador indisponível. Mudando para transcrição local…');
          void startLocalFallback();
        } else {
          console.warn('[VoiceDictation] Erro de reconhecimento:', event.error);
          setErrorMessage(`Falha no reconhecimento de voz: ${event.error}`);
          updateMode('paused');
        }
      };

      recognition.onend = () => {
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
        }

        // Se o usuário não pausou nem finalizou manualmente, os navegadores (Chrome/Edge)
        // podem encerrar sessões contínuas após alguns segundos de silêncio.
        // Reiniciamos transparentemente a sessão sem perder texto nem mover o cursor.
        if (modeRef.current === 'listening' && !isStoppingRef.current) {
          commitPendingInterim();
          confirmedIndexRef.current = 0;

          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => {
            if (modeRef.current === 'listening' && !isStoppingRef.current) {
              startRecognitionSession();
            }
          }, 180);
        }
      };

      isStoppingRef.current = false;
      recognitionRef.current = recognition;
      recognition.start();
      setErrorMessage('');
      return true;
    } catch (cause) {
      console.warn('[VoiceDictation] Falha ao iniciar reconhecimento:', cause);
      updateMode('idle');
      const msg = 'Não foi possível iniciar o microfone. Verifique as permissões.';
      setErrorMessage(msg);
      showToast(msg);
      return false;
    }
  }, [applyTranscriptTransaction, commitPendingInterim, editor, showToast, startLocalFallback, updateMode]);

  /**
   * Inicia o ditado por voz
   */
  const handleStart = useCallback(() => {
    if (!editor) return;

    editor.commands.focus();
    const { from, to } = editor.state.selection;
    sessionAnchorPosRef.current = from;
    interimLengthRef.current = Math.max(0, to - from);
    confirmedIndexRef.current = 0;

    setErrorMessage('');
    setEngineStatus('');
    updateMode('listening');
    startRecognitionSession();
  }, [editor, startRecognitionSession, updateMode]);

  /**
   * Pausa o ditado para edição manual completa
   */
  const handlePause = useCallback(async () => {
    if (localEngineRef.current) {
      setEngineStatus('Finalizando o trecho atual antes de pausar…');
      try {
        await localEngineRef.current.pause();
        commitPendingInterim();
        updateMode('paused');
        setEngineStatus('Ditado local pausado');
      } catch (error) {
        updateMode('paused');
        const message = error instanceof Error ? error.message : 'Não foi possível pausar o ditado local.';
        setErrorMessage(message);
        setEngineStatus('');
      }
      return;
    }

    isStoppingRef.current = true;
    updateMode('paused');
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    commitPendingInterim();

    try {
      recognitionRef.current?.stop();
    } catch {}
    recognitionRef.current = null;
  }, [commitPendingInterim, updateMode]);

  /**
   * Retoma o ditado na posição ATUAL do cursor após edição livre do usuário.
   */
  const handleResume = useCallback(async () => {
    if (!editor) return;

    editor.commands.focus();
    const { from, to } = editor.state.selection;
    sessionAnchorPosRef.current = from;
    interimLengthRef.current = Math.max(0, to - from);
    confirmedIndexRef.current = 0;
    isStoppingRef.current = false;
    setErrorMessage('');
    updateMode('listening');

    if (localEngineRef.current) {
      setEngineStatus('Reabrindo o microfone local…');
      try {
        await localEngineRef.current.resume();
        setEngineStatus('Ditado local ativo');
      } catch (error) {
        updateMode('paused');
        const message = error instanceof Error ? error.message : 'Não foi possível retomar o ditado local.';
        setErrorMessage(message);
        setEngineStatus('');
        showToast(message);
      }
      return;
    }

    setEngineStatus('');
    startRecognitionSession();
  }, [editor, showToast, startRecognitionSession, updateMode]);

  /**
   * Finaliza a captura e preserva inclusive o último trecho ainda em processamento.
   */
  const handleFinish = useCallback(async () => {
    isStoppingRef.current = true;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    const localEngine = localEngineRef.current;
    if (localEngine) {
      setEngineStatus('Finalizando e transcrevendo o último trecho…');
      try {
        await localEngine.stop();
      } catch (error) {
        console.warn('[VoiceDictation] Erro ao finalizar transcrição local:', error);
      }
      if (localEngineRef.current === localEngine) localEngineRef.current = null;
    } else {
      try {
        recognitionRef.current?.stop();
      } catch {}
      recognitionRef.current = null;
    }

    commitPendingInterim();
    sessionAnchorPosRef.current = 1;
    interimLengthRef.current = 0;
    confirmedIndexRef.current = 0;
    setErrorMessage('');
    setEngineStatus('');
    updateMode('idle');
  }, [commitPendingInterim, updateMode]);


  // Limpa o estado quando a nota ativa ou a instância do editor mudar
  useEffect(() => {
    isStoppingRef.current = true;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    try {
      recognitionRef.current?.abort?.();
    } catch {
      // Ignora
    }
    recognitionRef.current = null;
    const localEngine = localEngineRef.current;
    localEngineRef.current = null;
    if (localEngine) void localEngine.stop();
    setEngineStatus('');
    modeRef.current = 'idle';
    setMode('idle');
    setErrorMessage('');
    sessionAnchorPosRef.current = 1;
    interimLengthRef.current = 0;
    confirmedIndexRef.current = 0;
  }, [editor, activeNoteId]);

  // Limpa na desmontagem do componente
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      isStoppingRef.current = true;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
      }
      try {
        recognitionRef.current?.abort?.();
      } catch {
        // Ignora
      }
      recognitionRef.current = null;
      const localEngine = localEngineRef.current;
      localEngineRef.current = null;
      if (localEngine) void localEngine.stop();
    };
  }, []);

  const baseButton =
    'min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 shrink-0';

  // ESTADO INATIVO (IDLE)
  if (mode === 'idle') {
    return (
      <div className="flex items-center gap-1 shrink-0 relative" title="Ditado por voz (pt-BR)">
        <button
          id="toolbar-btn-voice-dictation"
          type="button"
          onClick={handleStart}
          disabled={!editor}
          className={`${baseButton} text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] dark:text-[#d4d4d4] dark:hover:bg-[#222222] dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed`}
          title="Iniciar ditado por voz (pt-BR) — A fala é transcrita diretamente na nota"
          aria-label="Iniciar ditado por voz"
        >
          <Mic className="w-4.5 h-4.5 stroke-[2.25]" />
        </button>

        {errorMessage && (
          <div
            className="flex items-center gap-1 max-w-[200px] text-[10px] leading-tight text-[#ba1a1a] dark:text-[#fca5a5] pl-1 font-sans-ui"
            role="status"
          >
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span className="truncate" title={errorMessage}>
              {errorMessage}
            </span>
          </div>
        )}
      </div>
    );
  }

  // ESTADO GRAVANDO / OUVINDO (LISTENING)
  if (mode === 'listening') {
    return (
      <div
        id="voice-dictation-active-bar"
        className="flex items-center gap-1 sm:gap-1.5 py-1 px-2 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/90 dark:bg-red-950/40 text-[#1b1c19] dark:text-[#f5f5f5] shrink-0 animate-in fade-in duration-150 shadow-2xs font-sans-ui"
      >
        {/* Indicador de Microfone Ativo */}
        <div className="flex items-center gap-1.5 pr-1">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600"></span>
          </span>
          <span className="text-[11px] font-semibold text-red-700 dark:text-red-300 whitespace-nowrap">
            {engineStatus || 'Ouvindo...'}
          </span>
        </div>

        {/* Botão Pausar */}
        <button
          id="toolbar-btn-voice-pause"
          type="button"
          onClick={handlePause}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-white/95 dark:bg-[#1a1a1a] hover:bg-white dark:hover:bg-[#262626] border border-red-200 dark:border-red-900/40 text-[#4a4742] dark:text-[#e4e2dd] transition-all cursor-pointer shadow-2xs active:scale-95"
          title="Pausar o ditado para digitar, apagar ou editar livremente no editor"
          aria-label="Pausar ditado para edição"
        >
          <Pause className="w-3.5 h-3.5 fill-current" />
          <span className="hidden sm:inline">Pausar</span>
        </button>

        {/* Botão Concluir/Finalizar */}
        <button
          id="toolbar-btn-voice-finish"
          type="button"
          onClick={handleFinish}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white transition-all cursor-pointer shadow-2xs active:scale-95"
          title="Concluir e encerrar ditado"
          aria-label="Finalizar ditado"
        >
          <Square className="w-3 h-3 fill-current" />
          <span className="hidden sm:inline">Concluir</span>
        </button>

        {/* Botão sutil de aviso de privacidade */}
        <button
          type="button"
          onClick={() => setShowPrivacyNotice((prev) => !prev)}
          className="p-1 rounded-md text-red-600/70 hover:text-red-700 dark:text-red-300/70 dark:hover:text-red-200 hover:bg-red-100/50 dark:hover:bg-red-900/30 transition-colors ml-0.5 cursor-pointer"
          title="Informações de privacidade do ditado"
          aria-label="Privacidade do ditado por voz"
        >
          <Info className="w-3.5 h-3.5" />
        </button>

        {showPrivacyNotice && (
          <div className="absolute top-full mt-2 left-0 z-50 p-3 bg-white dark:bg-[#1a1a1a] border border-[#e4e2dd] dark:border-[#333333] rounded-xl shadow-xl max-w-[280px] text-[11px] leading-relaxed text-[#4a4742] dark:text-[#d4d4d4]">
            <p className="font-semibold text-[#1b1c19] dark:text-[#f5f5f5] mb-1">Privacidade do Ditado</p>
            <p>O áudio não é salvo no aplicativo. O navegador processa a fala localmente ou via serviço de reconhecimento nativo do próprio sistema/navegador.</p>
          </div>
        )}
      </div>
    );
  }

  // ESTADO PAUSADO (PAUSED)
  return (
    <div
      id="voice-dictation-paused-bar"
      className="flex items-center gap-1 sm:gap-1.5 py-1 px-2 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/90 dark:bg-amber-950/40 text-[#1b1c19] dark:text-[#f5f5f5] shrink-0 animate-in fade-in duration-150 shadow-2xs font-sans-ui"
    >
      {/* Indicador Pausado */}
      <div className="flex items-center gap-1.5 pr-1">
        <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
        <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 whitespace-nowrap">
          Pausado
        </span>
      </div>

      {/* Botão Retomar */}
      <button
        id="toolbar-btn-voice-resume"
        type="button"
        onClick={handleResume}
        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-all cursor-pointer shadow-2xs active:scale-95"
        title="Retomar ditado na posição atual do cursor (após suas edições)"
        aria-label="Retomar ditado"
      >
        <Play className="w-3.5 h-3.5 fill-current" />
        <span className="hidden sm:inline">Retomar</span>
      </button>

      {(engineStatus || errorMessage) && (
        <span
          className={`hidden lg:inline max-w-[220px] truncate text-[10px] ${errorMessage ? 'text-[#ba1a1a] dark:text-[#fca5a5]' : 'text-[#7f756e] dark:text-[#a3a3a3]'}`}
          role={errorMessage ? 'alert' : 'status'}
          title={errorMessage || engineStatus}
        >
          {errorMessage || engineStatus}
        </span>
      )}
      {/* Botão Concluir/Finalizar */}
      <button
        id="toolbar-btn-voice-finish"
        type="button"
        onClick={handleFinish}
        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-white/95 dark:bg-[#1a1a1a] hover:bg-white dark:hover:bg-[#262626] border border-amber-200 dark:border-amber-900/40 text-[#4a4742] dark:text-[#e4e2dd] transition-all cursor-pointer shadow-2xs active:scale-95"
        title="Concluir e encerrar ditado"
        aria-label="Finalizar ditado"
      >
        <Square className="w-3 h-3" />
        <span className="hidden sm:inline">Concluir</span>
      </button>
    </div>
  );
}

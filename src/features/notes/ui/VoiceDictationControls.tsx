'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { Mic, Pause, Play, Square, AlertCircle, Info, Download, CheckCircle2, X, HardDrive } from 'lucide-react';
import { LocalWhisperDictationEngine } from './LocalWhisperDictationEngine';

export type DictationMode = 'idle' | 'listening' | 'paused';

const WHISPER_INSTALL_KEY = 'anotado:local-whisper:onnx-community-whisper-tiny:v1';

/**
 * Interface preparada para futura expansão de transcrição de arquivos de áudio
 * (ex.: MP3, WAV, M4A, WebM utilizando Transformers.js / Whisper no cliente).
 */
export interface AudioTranscriptionProvider {
  transcribeFile: (file: File, options?: { language?: string }) => Promise<string>;
}


interface VoiceDictationControlsProps {
  editor: Editor | null;
  activeNoteId?: string | null;
}

export function VoiceDictationControls({ editor, activeNoteId }: VoiceDictationControlsProps) {
  const [mode, setMode] = useState<DictationMode>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [showPrivacyNotice, setShowPrivacyNotice] = useState<boolean>(false);
  const [engineStatus, setEngineStatus] = useState<string>('');
  const [modelInstalled, setModelInstalled] = useState(false);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installingModel, setInstallingModel] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [installLoadedBytes, setInstallLoadedBytes] = useState(0);
  const [installTotalBytes, setInstallTotalBytes] = useState(0);
  const [installStatus, setInstallStatus] = useState('O modelo será baixado uma única vez e ficará salvo no navegador.');
  const [installError, setInstallError] = useState('');
  const [persistentStorageGranted, setPersistentStorageGranted] = useState<boolean | null>(null);

  const localEngineRef = useRef<LocalWhisperDictationEngine | null>(null);
  const modeRef = useRef<DictationMode>('idle');

  // Controle pontual da posição no ProseMirror/Tiptap:
  // sessionAnchorPosRef: posição no documento onde o segmento atual começa
  // interimLengthRef: quantos caracteres provisórios (interim) estão renderizados nessa âncora
  // confirmedIndexRef: índice dos resultados de SpeechRecognition já consolidados permanentemente
  const sessionAnchorPosRef = useRef<number>(1);
  const interimLengthRef = useRef<number>(0);
  const confirmedIndexRef = useRef<number>(0);

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

  const getOrCreateLocalEngine = useCallback(() => {
    if (localEngineRef.current) return localEngineRef.current;

    const engine = new LocalWhisperDictationEngine({
      onTranscript: (text) => applyTranscriptTransaction(text, true),
      onStatus: (message) => {
        if (mountedRef.current) {
          setEngineStatus(message);
          if (installDialogOpen) setInstallStatus(message);
        }
      },
      onProgress: (progress, loaded, total) => {
        if (!mountedRef.current) return;
        setInstallProgress(Math.round(progress));
        setInstallLoadedBytes(loaded);
        setInstallTotalBytes(total);
      },
      onError: (message) => {
        if (mountedRef.current) {
          setErrorMessage(message);
          setInstallError(message);
          showToast(message);
        }
      },
    });

    localEngineRef.current = engine;
    return engine;
  }, [applyTranscriptTransaction, installDialogOpen, showToast]);

  const handleInstallModel = useCallback(async () => {
    if (installingModel) return;
    setInstallingModel(true);
    setInstallProgress(0);
    setInstallLoadedBytes(0);
    setInstallTotalBytes(0);
    setInstallError('');
    setInstallStatus('Verificando o cache e preparando o modelo Whisper…');

    try {
      const engine = getOrCreateLocalEngine();
      await engine.prepare();

      let persistent = false;
      try {
        if (navigator.storage?.persist) {
          persistent = await navigator.storage.persist();
        }
      } catch {
        persistent = false;
      }

      try {
        localStorage.setItem(WHISPER_INSTALL_KEY, 'installed');
      } catch {
        // A sessão atual continua funcionando mesmo quando o navegador bloqueia localStorage.
      }

      setPersistentStorageGranted(persistent);
      setModelInstalled(true);
      setInstallProgress(100);
      setInstallStatus('Modelo instalado e pronto para uso.');
    } catch (error) {
      console.error('[VoiceDictation] Falha ao instalar o modelo Whisper:', error);
      const message = error instanceof Error
        ? error.message
        : 'Não foi possível baixar e preparar o modelo de voz.';
      setInstallError(message);
      setInstallStatus('A instalação não foi concluída. Você pode tentar novamente.');
      setModelInstalled(false);
    } finally {
      setInstallingModel(false);
    }
  }, [getOrCreateLocalEngine, installingModel]);

  const beginLocalDictation = useCallback(async () => {
    if (!editor) return;

    editor.commands.focus();
    const { from, to } = editor.state.selection;
    sessionAnchorPosRef.current = from;
    interimLengthRef.current = Math.max(0, to - from);
    confirmedIndexRef.current = 0;
    setErrorMessage('');
    setEngineStatus('Carregando modelo salvo…');
    setInstallDialogOpen(false);
    updateMode('listening');

    try {
      const engine = getOrCreateLocalEngine();
      // Se o navegador limpou o cache, prepare() baixa novamente os arquivos ausentes.
      await engine.prepare();
      await engine.start();
      try {
        localStorage.setItem(WHISPER_INSTALL_KEY, 'installed');
      } catch {}
      setModelInstalled(true);
      setEngineStatus('Ditado local ativo');
    } catch (error) {
      updateMode('idle');
      const message = error instanceof Error
        ? error.message
        : 'Não foi possível iniciar o ditado local.';
      setErrorMessage(message);
      setEngineStatus('');
      showToast(message);
    }
  }, [editor, getOrCreateLocalEngine, showToast, updateMode]);

  // Reconhece a instalação feita anteriormente neste navegador.
  useEffect(() => {
    try {
      setModelInstalled(localStorage.getItem(WHISPER_INSTALL_KEY) === 'installed');
    } catch {
      setModelInstalled(false);
    }
  }, []);

  /**
   * Na primeira utilização, abre o diálogo de instalação em vez de iniciar
   * um download oculto em segundo plano. Após a instalação, inicia direto.
   */
  const handleStart = useCallback(() => {
    if (!editor) return;

    editor.commands.focus();
    const { from, to } = editor.state.selection;
    sessionAnchorPosRef.current = from;
    interimLengthRef.current = Math.max(0, to - from);
    confirmedIndexRef.current = 0;
    setErrorMessage('');

    if (!modelInstalled) {
      setInstallDialogOpen(true);
      setInstallError('');
      setInstallProgress(0);
      setInstallLoadedBytes(0);
      setInstallTotalBytes(0);
      setInstallStatus('O modelo será baixado uma vez e ficará salvo no navegador.');
      return;
    }

    void beginLocalDictation();
  }, [beginLocalDictation, editor, modelInstalled]);

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
    const engine = localEngineRef.current;
    if (!engine) {
      updateMode('paused');
      return;
    }

    setEngineStatus('Finalizando o trecho atual antes de pausar…');
    try {
      await engine.pause();
      commitPendingInterim();
      updateMode('paused');
      setEngineStatus('Ditado local pausado');
    } catch (error) {
      updateMode('paused');
      const message = error instanceof Error ? error.message : 'Não foi possível pausar o ditado local.';
      setErrorMessage(message);
      setEngineStatus('');
    }
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
    void beginLocalDictation();
  }, [beginLocalDictation, editor, showToast, updateMode]);

  /**
   * Finaliza a captura e preserva inclusive o último trecho ainda em processamento.
   */
  const handleFinish = useCallback(async () => {
    const localEngine = localEngineRef.current;
    if (localEngine) {
      setEngineStatus('Finalizando e transcrevendo o último trecho…');
      try {
        await localEngine.stop();
      } catch (error) {
        console.warn('[VoiceDictation] Erro ao finalizar transcrição local:', error);
      }
      if (localEngineRef.current === localEngine) localEngineRef.current = null;
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
      const localEngine = localEngineRef.current;
      localEngineRef.current = null;
      if (localEngine) void localEngine.stop();
    };
  }, []);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes < 0) return '0 MB';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const installDialog = installDialogOpen ? (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="whisper-install-title"
        className="w-full max-w-[460px] rounded-2xl border border-[#e4e2dd] dark:border-[#383838] bg-[#fbf9f4] dark:bg-[#111111] p-5 shadow-2xl text-[#1b1c19] dark:text-[#f5f5f5]"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#eee7df] dark:bg-[#29231f] text-[#735e4c] dark:text-[#d6c0aa]">
            {modelInstalled ? <CheckCircle2 className="h-5 w-5" /> : <Download className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="whisper-install-title" className="text-base font-semibold">
              {modelInstalled ? 'Modelo de voz instalado' : 'Preparar ditado por voz'}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[#6f665e] dark:text-[#b5b5b5]">
              {modelInstalled
                ? 'O Whisper já está preparado neste navegador. Clique abaixo para começar a ditar.'
                : 'Na primeira utilização, o Anotado precisa baixar e preparar o modelo Whisper. Depois disso, ele será reutilizado pelo cache local do navegador.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !installingModel && setInstallDialogOpen(false)}
            disabled={installingModel}
            className="rounded-lg p-1.5 text-[#746b63] hover:bg-[#eee9e2] dark:text-[#b5b5b5] dark:hover:bg-[#242424] disabled:opacity-30"
            aria-label="Fechar diálogo"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {installingModel && (
          <div className="mt-5 space-y-2" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-[#5e554d] dark:text-[#d1d1d1]">{installStatus}</span>
              <span className="shrink-0 font-semibold tabular-nums">{installProgress}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-[#e6e0d8] dark:bg-[#303030]">
              <div
                className="h-full rounded-full bg-[#8a725d] dark:bg-[#c0a68e] transition-[width] duration-300"
                style={{ width: `${Math.max(0, Math.min(100, installProgress))}%` }}
              />
            </div>
            {installTotalBytes > 0 && (
              <p className="text-[11px] tabular-nums text-[#7f756e] dark:text-[#a3a3a3]">
                {formatBytes(installLoadedBytes)} de {formatBytes(installTotalBytes)} carregados
              </p>
            )}
          </div>
        )}

        {installError && (
          <div className="mt-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-xs leading-relaxed text-red-700 dark:text-red-300" role="alert">
            {installError}
          </div>
        )}

        {modelInstalled && !installingModel && (
          <div className="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/25 p-3 text-xs text-emerald-800 dark:text-emerald-300">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4" />
              Instalação concluída
            </div>
            <p className="mt-1">
              {persistentStorageGranted === false
                ? 'O navegador não garantiu armazenamento permanente; evite limpar os dados deste site.'
                : 'O modelo está pronto e será reutilizado neste navegador.'}
            </p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {!installingModel && !modelInstalled && (
            <button
              type="button"
              onClick={() => setInstallDialogOpen(false)}
              className="rounded-xl border border-[#d8d0c7] dark:border-[#414141] px-3.5 py-2 text-xs font-medium text-[#665c53] dark:text-[#d0d0d0] hover:bg-[#eee9e2] dark:hover:bg-[#222222]"
            >
              Agora não
            </button>
          )}
          {!modelInstalled && (
            <button
              type="button"
              onClick={handleInstallModel}
              disabled={installingModel}
              className="rounded-xl bg-[#735e4c] px-4 py-2 text-xs font-semibold text-white hover:bg-[#5f4b3c] disabled:cursor-wait disabled:opacity-60"
            >
              {installingModel ? 'Instalando…' : 'Baixar e instalar'}
            </button>
          )}
          {modelInstalled && !installingModel && (
            <button
              type="button"
              onClick={() => void beginLocalDictation()}
              className="rounded-xl bg-[#735e4c] px-4 py-2 text-xs font-semibold text-white hover:bg-[#5f4b3c]"
            >
              Iniciar ditado
            </button>
          )}
        </div>

        <div className="mt-4 flex items-start gap-2 border-t border-[#e5ded6] dark:border-[#303030] pt-3 text-[10px] leading-relaxed text-[#827970] dark:text-[#a3a3a3]">
          <HardDrive className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            O modelo fica no armazenamento local do navegador. O áudio é processado no próprio dispositivo; se os dados do site forem apagados pelo navegador, será necessário baixar o modelo novamente.
          </p>
        </div>
      </section>
    </div>
  ) : null;

  const baseButton =
    'min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 shrink-0';

  // ESTADO INATIVO (IDLE)
  if (mode === 'idle') {
    return (
      <>
      {installDialog}
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
      </>
    );
  }

  // ESTADO GRAVANDO / OUVINDO (LISTENING)
  if (mode === 'listening') {
    return (
      <>
      {installDialog}
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
            <p>O áudio é processado localmente pelo Whisper no próprio dispositivo. O aplicativo salva apenas o texto reconhecido na nota.</p>
          </div>
        )}
      </div>
      </>
    );
  }

  // ESTADO PAUSADO (PAUSED)
  return (
    <>
    {installDialog}
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
    </>
  );
}

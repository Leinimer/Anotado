type WhisperWorkerResponse =
  | { type: 'progress'; message: string }
  | { type: 'ready'; device: 'webgpu' | 'wasm' }
  | { type: 'transcript'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };

interface PendingTranscription {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

type EngineCallbacks = {
  onTranscript: (text: string) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
};

/**
 * Fallback de ditado local com Whisper. Captura segmentos curtos do microfone,
 * transcreve em um Worker e devolve somente o texto novo para o Tiptap.
 */
export class LocalWhisperDictationEngine {
  private readonly callbacks: EngineCallbacks;
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private currentRecorder: MediaRecorder | null = null;
  private recorders = new Set<MediaRecorder>();
  private rotationTimer: ReturnType<typeof setTimeout> | null = null;
  private stopTimers = new Set<ReturnType<typeof setTimeout>>();
  private queue: Blob[] = [];
  private processing = false;
  private ready = false;
  private nextRequestId = 1;
  private pending = new Map<number, PendingTranscription>();
  private idleWaiters: Array<() => void> = [];
  private recording = false;
  private disposed = false;
  private previousWords: string[] = [];
  private workerReadyPromise: Promise<void> | null = null;

  constructor(callbacks: EngineCallbacks) {
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (this.disposed) throw new Error('A sessão local já foi encerrada.');
    if (this.recording) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador não permite acessar o microfone neste endereço.');
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('Este navegador não oferece gravação de áudio compatível com o ditado local.');
    }

    // Captura o microfone primeiro para não perder o início da fala durante o download do modelo.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.recording = true;
    this.currentRecorder = this.createRecorder();
    this.scheduleRotation();

    if (!this.workerReadyPromise) {
      this.workerReadyPromise = this.initializeWorker();
    }
    await this.workerReadyPromise;
    this.callbacks.onStatus('Ditado local ativo');
    void this.processQueue();
  }

  async pause(): Promise<void> {
    await this.stopCaptureAndFlush();
    this.callbacks.onStatus('Ditado local pausado');
  }

  async resume(): Promise<void> {
    if (this.disposed) throw new Error('A sessão local já foi encerrada.');
    if (this.recording) return;
    if (!this.ready) {
      if (!this.workerReadyPromise) this.workerReadyPromise = this.initializeWorker();
      await this.workerReadyPromise;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Não foi possível acessar o microfone neste navegador.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.recording = true;
    this.currentRecorder = this.createRecorder();
    this.scheduleRotation();
    this.callbacks.onStatus('Ditado local ativo');
  }

  async stop(): Promise<void> {
    await this.stopCaptureAndFlush();
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.pending.forEach(({ reject }) => reject(new Error('Ditado encerrado.')));
    this.pending.clear();
  }

  private async initializeWorker(): Promise<void> {
    this.callbacks.onStatus('Preparando o modelo de transcrição local…');
    const worker = new Worker(new URL('./local-whisper.worker.ts', import.meta.url), {
      type: 'module',
      name: 'anotado-local-whisper',
    });
    this.worker = worker;

    this.workerReadyPromise = new Promise<void>((resolve, reject) => {
      const handleMessage = (event: MessageEvent<WhisperWorkerResponse>) => {
        const message = event.data;
        if (message.type === 'progress') {
          this.callbacks.onStatus(message.message);
          return;
        }
        if (message.type === 'ready') {
          this.ready = true;
          this.callbacks.onStatus(
            message.device === 'webgpu'
              ? 'Modelo local pronto (GPU)'
              : 'Modelo local pronto (CPU)'
          );
          resolve();
          return;
        }
        if (message.type === 'transcript') {
          const pending = this.pending.get(message.id);
          if (pending) {
            this.pending.delete(message.id);
            pending.resolve(message.text);
          }
          return;
        }
        if (message.type === 'error') {
          if (message.id !== undefined) {
            const pending = this.pending.get(message.id);
            if (pending) {
              this.pending.delete(message.id);
              pending.reject(new Error(message.message));
            }
          } else {
            reject(new Error(message.message));
          }
        }
      };

      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', (event) => {
        reject(new Error(event.message || 'Falha ao carregar o modelo local de voz.'));
      }, { once: true });

      worker.postMessage({ type: 'init' });
    });

    await this.workerReadyPromise;
    void this.processQueue();
  }

  private createRecorder(): MediaRecorder {
    if (!this.stream) throw new Error('O microfone não está ativo.');
    const preferredMime = 'audio/webm;codecs=opus';
    const options: MediaRecorderOptions = MediaRecorder.isTypeSupported(preferredMime)
      ? { mimeType: preferredMime, audioBitsPerSecond: 64000 }
      : { audioBitsPerSecond: 64000 };

    const recorder = new MediaRecorder(this.stream, options);
    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      this.recorders.delete(recorder);
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size >= 3000) {
        this.queue.push(blob);
        void this.processQueue();
      }
    }, { once: true });

    recorder.start();
    this.recorders.add(recorder);
    return recorder;
  }

  private scheduleRotation(): void {
    if (!this.recording) return;
    if (this.rotationTimer) clearTimeout(this.rotationTimer);

    this.rotationTimer = setTimeout(() => {
      if (!this.recording) return;
      const previous = this.currentRecorder;
      try {
        const next = this.createRecorder();
        this.currentRecorder = next;

        // Um segundo de sobreposição evita cortar palavras exatamente na troca do segmento.
        if (previous && previous.state !== 'inactive') {
          const stopTimer = setTimeout(() => {
            this.stopTimers.delete(stopTimer);
            this.stopRecorder(previous);
          }, 1000);
          this.stopTimers.add(stopTimer);
        }
        this.scheduleRotation();
      } catch (error) {
        this.callbacks.onError(
          error instanceof Error ? error.message : 'Não foi possível continuar a gravação local.'
        );
      }
    }, 7000);
  }

  private stopRecorder(recorder: MediaRecorder): Promise<void> {
    if (recorder.state === 'inactive') return Promise.resolve();
    return new Promise((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
  }

  private async stopCaptureAndFlush(): Promise<void> {
    this.recording = false;
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer);
      this.rotationTimer = null;
    }
    this.stopTimers.forEach((timer) => clearTimeout(timer));
    this.stopTimers.clear();

    const recorders = Array.from(this.recorders);
    await Promise.all(recorders.map((recorder) => this.stopRecorder(recorder)));
    this.currentRecorder = null;

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    await this.waitForQueueIdle();
  }

  private waitForQueueIdle(): Promise<void> {
    if (!this.processing && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async processQueue(): Promise<void> {
    if (this.processing || !this.ready || !this.worker || this.disposed) return;
    this.processing = true;

    try {
      while (this.queue.length > 0 && !this.disposed) {
        const blob = this.queue.shift();
        if (!blob) continue;
        try {
          this.callbacks.onStatus('Transcrevendo trecho de áudio localmente…');
          const audio = await this.decodeAndResample(blob);
          if (audio.length < 16000) continue;
          const text = await this.transcribe(audio);
          const freshText = this.removeOverlap(text);
          if (freshText) this.callbacks.onTranscript(freshText);
        } catch (error) {
          this.callbacks.onError(
            error instanceof Error ? error.message : 'Falha ao transcrever um trecho de áudio.'
          );
        }
      }
    } finally {
      this.processing = false;
      this.idleWaiters.splice(0).forEach((resolve) => resolve());
      if (this.queue.length > 0 && this.ready && !this.disposed) {
        void this.processQueue();
      } else if (this.recording) {
        this.callbacks.onStatus('Ditado local ativo');
      }
    }
  }

  private async decodeAndResample(blob: Blob): Promise<Float32Array> {
    const AudioContextConstructor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error('Este navegador não oferece decodificação de áudio necessária ao ditado local.');
    }

    const audioContext = new AudioContextConstructor();
    try {
      const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
      const channels: Float32Array[] = [];
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        channels.push(decoded.getChannelData(channel));
      }

      const mono = new Float32Array(decoded.length);
      for (let index = 0; index < decoded.length; index += 1) {
        let sum = 0;
        for (const channel of channels) sum += channel[index] || 0;
        mono[index] = sum / Math.max(1, channels.length);
      }

      if (decoded.sampleRate === 16000) return mono;
      const outputLength = Math.floor(mono.length * 16000 / decoded.sampleRate);
      const output = new Float32Array(outputLength);
      const ratio = decoded.sampleRate / 16000;
      for (let index = 0; index < outputLength; index += 1) {
        const sourcePosition = index * ratio;
        const lower = Math.floor(sourcePosition);
        const upper = Math.min(lower + 1, mono.length - 1);
        const fraction = sourcePosition - lower;
        output[index] = mono[lower] * (1 - fraction) + mono[upper] * fraction;
      }
      return output;
    } finally {
      await audioContext.close().catch(() => undefined);
    }
  }

  private transcribe(audio: Float32Array): Promise<string> {
    if (!this.worker) return Promise.reject(new Error('O mecanismo local não está carregado.'));
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const transferable = audio.buffer.slice(
        audio.byteOffset,
        audio.byteOffset + audio.byteLength
      );
      this.worker?.postMessage({ type: 'transcribe', id, audio: transferable }, [transferable]);
    });
  }

  private removeOverlap(text: string): string {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';

    const normalize = (word: string) =>
      word.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]/gu, '');

    const maxOverlap = Math.min(10, this.previousWords.length, words.length);
    let overlap = 0;
    for (let count = maxOverlap; count >= 1; count -= 1) {
      const previousTail = this.previousWords.slice(-count).map(normalize);
      const currentHead = words.slice(0, count).map(normalize);
      if (previousTail.every((word, index) => word && word === currentHead[index])) {
        overlap = count;
        break;
      }
    }

    const freshWords = words.slice(overlap);
    this.previousWords = [...this.previousWords, ...freshWords].slice(-14);
    return freshWords.join(' ').trim();
  }
}

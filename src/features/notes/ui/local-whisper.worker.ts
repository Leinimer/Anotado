import { env, pipeline } from '@huggingface/transformers';

type WorkerRequest =
  | { type: 'init' }
  | { type: 'transcribe'; id: number; audio: ArrayBuffer };

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: unknown) => void;
  navigator?: { gpu?: unknown };
};

const scope = self as unknown as WorkerScope;
const MODEL_ID = 'onnx-community/whisper-tiny';
let transcriber: ((audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text?: string }>) | null = null;
let initializing: Promise<void> | null = null;

env.allowRemoteModels = true;
env.useBrowserCache = true;
env.useWasmCache = true;

async function loadModel(): Promise<void> {
  if (transcriber) return;
  if (initializing) return initializing;

  initializing = (async () => {
    const perFile = new Map<string, { loaded: number; total: number }>();

    const reportProgress = (info: Record<string, unknown>) => {
      const status = String(info.status || '');
      const file = String(info.file || '');
      const progress = typeof info.progress === 'number' ? info.progress : null;
      const loaded = typeof info.loaded === 'number' ? info.loaded : 0;
      const total = typeof info.total === 'number' ? info.total : 0;

      // A biblioteca emite progress por arquivo (que recomeça em 0% a cada arquivo)
      // e progress_total para o agregado. Exibimos sempre o agregado.
      if (status === 'progress_total' && progress !== null) {
        scope.postMessage({
          type: 'progress',
          message: 'Baixando modelo Whisper',
          progress: Math.max(0, Math.min(100, progress)),
          loaded,
          total,
        });
        return;
      }

      if (status === 'initiate') {
        scope.postMessage({
          type: 'progress',
          message: 'Verificando arquivos do modelo no cache local…',
        });
        return;
      }

      if (status === 'progress' && file) {
        perFile.set(file, { loaded, total });
        const values = Array.from(perFile.values());
        const aggregateLoaded = values.reduce((sum, item) => sum + item.loaded, 0);
        const aggregateTotal = values.reduce((sum, item) => sum + item.total, 0);
        const aggregateProgress = aggregateTotal > 0
          ? Math.min(99, (aggregateLoaded / aggregateTotal) * 100)
          : progress;

        scope.postMessage({
          type: 'progress',
          message: 'Baixando arquivos do modelo Whisper',
          progress: aggregateProgress === null ? undefined : Math.max(0, aggregateProgress),
          loaded: aggregateLoaded,
          total: aggregateTotal,
        });
        return;
      }

      if (status === 'done' && file) {
        const current = perFile.get(file);
        if (current?.total) {
          perFile.set(file, { loaded: current.total, total: current.total });
        }
        scope.postMessage({
          type: 'progress',
          message: 'Arquivo preparado; verificando os próximos arquivos…',
        });
      }
    };

    const canUseWebGpu = Boolean(scope.navigator?.gpu);
    let selectedDevice: 'webgpu' | 'wasm' = 'wasm';
    if (canUseWebGpu) {
      try {
        transcriber = await pipeline(
          'automatic-speech-recognition',
          MODEL_ID,
          { device: 'webgpu', dtype: 'fp16', progress_callback: reportProgress }
        ) as unknown as typeof transcriber;
        selectedDevice = 'webgpu';
      } catch (error) {
        console.warn('[LocalWhisper] WebGPU indisponível; usando WASM:', error);
      }
    }

    if (!transcriber) {
      transcriber = await pipeline(
        'automatic-speech-recognition',
        MODEL_ID,
        { device: 'wasm', dtype: 'q8', progress_callback: reportProgress }
      ) as unknown as typeof transcriber;
    }

    scope.postMessage({ type: 'ready', device: selectedDevice });
  })().catch((error) => {
    initializing = null;
    throw error;
  });

  return initializing;
}

scope.onmessage = async (event) => {
  const message = event.data;
  if (message.type === 'init') {
    try {
      await loadModel();
    } catch (error) {
      scope.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível carregar o modelo local de voz.',
      });
    }
    return;
  }

  if (message.type === 'transcribe') {
    try {
      await loadModel();
      if (!transcriber) throw new Error('Modelo Whisper não inicializado.');
      const result = await transcriber(new Float32Array(message.audio), {
        language: 'portuguese',
        task: 'transcribe',
        return_timestamps: false,
      });
      scope.postMessage({ type: 'transcript', id: message.id, text: String(result.text || '').trim() });
    } catch (error) {
      scope.postMessage({
        type: 'error',
        id: message.id,
        message: error instanceof Error ? error.message : 'Falha ao transcrever o áudio.',
      });
    }
  }
};

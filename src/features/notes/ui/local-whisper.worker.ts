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

async function loadModel(): Promise<void> {
  if (transcriber) return;
  if (initializing) return initializing;

  initializing = (async () => {
    const reportProgress = (info: Record<string, unknown>) => {
      const status = String(info.status || '');
      const file = String(info.file || '');
      const progress = typeof info.progress === 'number' ? Math.round(info.progress) : null;
      if (status === 'progress' && progress !== null) {
        scope.postMessage({ type: 'progress', message: `Baixando modelo Whisper: ${progress}%` });
      } else if (status === 'initiate') {
        scope.postMessage({ type: 'progress', message: file ? `Baixando ${file}…` : 'Baixando modelo Whisper…' });
      } else if (status === 'done') {
        scope.postMessage({ type: 'progress', message: 'Preparando modelo de transcrição…' });
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

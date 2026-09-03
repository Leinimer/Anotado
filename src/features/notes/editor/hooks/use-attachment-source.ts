import { useState, useEffect, useRef } from 'react';
import {
  resolveAttachmentSource,
  getCachedAttachmentUrl,
} from '../utils/media-common';
import { markMediaAsLoaded } from '../utils/media-optimizer';

interface UseAttachmentSourceOptions {
  rawSrc: string;
  currentUserId?: string;
  isImage?: boolean;
  onRemoteResolved?: (remoteUrl: string) => void;
  transformInitialUrl?: (url: string) => string;
}

export function useAttachmentSource({
  rawSrc,
  currentUserId = 'anonymous',
  isImage = true,
  onRemoteResolved,
  transformInitialUrl,
}: UseAttachmentSourceOptions) {
  // Consulta síncrona se a mídia já foi resolvida anteriormente na sessão
  const cachedUrl = getCachedAttachmentUrl(rawSrc);

  const [resolvedSrc, setResolvedSrc] = useState<string>(() => {
    if (cachedUrl) {
      return transformInitialUrl ? transformInitialUrl(cachedUrl) : cachedUrl;
    }
    if (rawSrc.startsWith('attachment://') || rawSrc.startsWith('local-attachment://')) {
      return '';
    }
    return transformInitialUrl ? transformInitialUrl(rawSrc) : rawSrc;
  });

  const [hasError, setHasError] = useState(false);
  // Se já temos uma URL válida (do cache ou direta), NUNCA inicia em loading
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    if (cachedUrl) return false;
    return rawSrc.startsWith('attachment://') || rawSrc.startsWith('local-attachment://');
  });

  const currentResolvedSrcRef = useRef(resolvedSrc);
  const onRemoteResolvedRef = useRef(onRemoteResolved);
  const transformRef = useRef(transformInitialUrl);
  const isImageRef = useRef(isImage);

  useEffect(() => {
    currentResolvedSrcRef.current = resolvedSrc;
  }, [resolvedSrc]);

  useEffect(() => {
    onRemoteResolvedRef.current = onRemoteResolved;
  }, [onRemoteResolved]);

  useEffect(() => {
    transformRef.current = transformInitialUrl;
  }, [transformInitialUrl]);

  useEffect(() => {
    isImageRef.current = isImage;
  }, [isImage]);

  useEffect(() => {
    let isCancelled = false;

    async function resolve() {
      // 1. Caso 1: O src já é uma URL HTTP/HTTPS/data/blob direta
      if (!rawSrc.startsWith('attachment://') && !rawSrc.startsWith('local-attachment://')) {
        const transformed = transformRef.current ? transformRef.current(rawSrc) : rawSrc;

        // Se já é exatamente a mesma URL ativa, nada a fazer
        if (transformed === currentResolvedSrcRef.current) {
          setIsLoading(false);
          setHasError(false);
          return;
        }

        // Se já temos uma fonte visual estável sendo exibida e a nova é imagem remota, pré-carrega e decodifica em background
        const shouldPreloadImage =
          isImageRef.current &&
          Boolean(currentResolvedSrcRef.current) &&
          typeof Image !== 'undefined' &&
          (transformed.startsWith('http://') || transformed.startsWith('https://'));

        if (shouldPreloadImage) {
          const preloader = new Image();
          preloader.onload = async () => {
            if (isCancelled) return;
            if (preloader.decode) {
              try {
                await preloader.decode();
              } catch {
                // segue adiante se decode falhar
              }
            }
            if (!isCancelled) {
              markMediaAsLoaded(transformed);
              markMediaAsLoaded(rawSrc);
              setResolvedSrc(transformed);
              setIsLoading(false);
              setHasError(false);
            }
          };
          preloader.onerror = () => {
            // Em caso de erro na rede para a imagem remota, mantém a fonte anterior (ex: blob local) intacta
            if (!isCancelled) {
              if (!currentResolvedSrcRef.current) {
                setResolvedSrc(transformed);
              }
              setIsLoading(false);
            }
          };
          preloader.src = transformed;
          return;
        }

        // Troca direta para não-imagens (ex: PDFs) ou quando ainda não havia fonte
        markMediaAsLoaded(transformed);
        setResolvedSrc(transformed);
        setIsLoading(false);
        setHasError(false);
        return;
      }

      // 2. Caso 2: Anexo local attachment:// ou local-attachment://
      // REGRA DE OURO: Se já temos uma URL visual válida sendo exibida, NUNCA volta para isLoading = true
      if (!currentResolvedSrcRef.current) {
        setIsLoading(true);
      }

      const result = await resolveAttachmentSource(rawSrc, currentUserId);
      if (isCancelled) return;

      if (result.resolvedUrl) {
        const finalUrl = transformRef.current
          ? transformRef.current(result.resolvedUrl)
          : result.resolvedUrl;

        // Se já está exibindo exatamente esta URL, apenas finaliza loading
        if (finalUrl === currentResolvedSrcRef.current) {
          setIsLoading(false);
          setHasError(false);
          return;
        }

        // Se já existe uma fonte visual ativa e a nova é imagem remota, pré-carrega e decodifica
        const shouldPreloadImage =
          isImageRef.current &&
          Boolean(currentResolvedSrcRef.current) &&
          typeof Image !== 'undefined' &&
          (finalUrl.startsWith('http://') || finalUrl.startsWith('https://'));

        if (shouldPreloadImage) {
          const preloader = new Image();
          preloader.onload = async () => {
            if (isCancelled) return;
            if (preloader.decode) {
              try {
                await preloader.decode();
              } catch {
                // decode opcional
              }
            }
            if (!isCancelled) {
              markMediaAsLoaded(finalUrl);
              markMediaAsLoaded(rawSrc);
              setResolvedSrc(finalUrl);
              setIsLoading(false);
              setHasError(false);
              if (result.remoteUrl && onRemoteResolvedRef.current) {
                onRemoteResolvedRef.current(result.remoteUrl);
              }
            }
          };
          preloader.onerror = () => {
            if (!isCancelled) {
              if (!currentResolvedSrcRef.current) {
                setResolvedSrc(finalUrl);
              }
              setIsLoading(false);
              if (result.remoteUrl && onRemoteResolvedRef.current) {
                onRemoteResolvedRef.current(result.remoteUrl);
              }
            }
          };
          preloader.src = finalUrl;
          return;
        }

        // Transição direta (ex: Blob local ou PDFs)
        markMediaAsLoaded(finalUrl);
        markMediaAsLoaded(rawSrc);
        setResolvedSrc(finalUrl);
        setIsLoading(false);
        setHasError(false);

        if (result.remoteUrl && onRemoteResolvedRef.current) {
          onRemoteResolvedRef.current(result.remoteUrl);
        }
      } else {
        // Apenas marca erro se não existir nenhuma URL anterior válida
        if (!currentResolvedSrcRef.current) {
          setHasError(true);
        }
        setIsLoading(false);
      }
    }

    resolve();

    return () => {
      isCancelled = true;
    };
  }, [rawSrc, currentUserId]);

  return {
    resolvedSrc,
    setResolvedSrc,
    hasError,
    setHasError,
    isLoading,
  };
}

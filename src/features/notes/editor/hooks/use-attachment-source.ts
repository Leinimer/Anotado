import { useState, useEffect, useRef } from 'react';
import { resolveAttachmentSource } from '../utils/media-common';

interface UseAttachmentSourceOptions {
  rawSrc: string;
  currentUserId?: string;
  onRemoteResolved?: (remoteUrl: string) => void;
  transformInitialUrl?: (url: string) => string;
}

export function useAttachmentSource({
  rawSrc,
  currentUserId = 'anonymous',
  onRemoteResolved,
  transformInitialUrl,
}: UseAttachmentSourceOptions) {
  const [resolvedSrc, setResolvedSrc] = useState<string>(() => {
    if (rawSrc.startsWith('attachment://') || rawSrc.startsWith('local-attachment://')) {
      return '';
    }
    return transformInitialUrl ? transformInitialUrl(rawSrc) : rawSrc;
  });

  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(
    rawSrc.startsWith('attachment://') || rawSrc.startsWith('local-attachment://')
  );

  const localBlobUrlRef = useRef<string | null>(null);
  const onRemoteResolvedRef = useRef(onRemoteResolved);

  useEffect(() => {
    onRemoteResolvedRef.current = onRemoteResolved;
  }, [onRemoteResolved]);

  useEffect(() => {
    let isCancelled = false;

    async function resolve() {
      if (!rawSrc.startsWith('attachment://') && !rawSrc.startsWith('local-attachment://')) {
        setResolvedSrc(transformInitialUrl ? transformInitialUrl(rawSrc) : rawSrc);
        setIsLoading(false);
        setHasError(false);
        return;
      }

      setIsLoading(true);
      const result = await resolveAttachmentSource(rawSrc, currentUserId);

      if (isCancelled) {
        if (result.blobUrl) URL.revokeObjectURL(result.blobUrl);
        return;
      }

      if (result.resolvedUrl) {
        if (result.blobUrl) {
          if (localBlobUrlRef.current) URL.revokeObjectURL(localBlobUrlRef.current);
          localBlobUrlRef.current = result.blobUrl;
        }

        const finalUrl = transformInitialUrl
          ? transformInitialUrl(result.resolvedUrl)
          : result.resolvedUrl;

        setResolvedSrc(finalUrl);
        setHasError(false);
        setIsLoading(false);

        if (result.remoteUrl && onRemoteResolvedRef.current) {
          onRemoteResolvedRef.current(result.remoteUrl);
        }
      } else {
        setHasError(true);
        setIsLoading(false);
      }
    }

    resolve();

    return () => {
      isCancelled = true;
      if (localBlobUrlRef.current) {
        URL.revokeObjectURL(localBlobUrlRef.current);
        localBlobUrlRef.current = null;
      }
    };
  }, [rawSrc, currentUserId, transformInitialUrl]);

  return {
    resolvedSrc,
    setResolvedSrc,
    hasError,
    setHasError,
    isLoading,
  };
}

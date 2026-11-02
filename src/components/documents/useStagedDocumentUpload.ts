import { useRef } from 'react';
import { endpoints } from '@/lib/api';

/** Keeps an unclaimed upload for retries after a failed document write. */
export function useStagedDocumentUpload() {
  const pending = useRef<{ file: File; uploadId: string } | null>(null);

  const stageFile = async (file: File, fallbackMessage: string): Promise<string> => {
    if (pending.current?.file === file) return pending.current.uploadId;
    const { data, error } = await endpoints.files.upload([file]);
    if (error) throw error;
    const uploadId = data?.[0]?.upload_id;
    if (!uploadId) throw new Error(fallbackMessage);
    pending.current = { file, uploadId };
    return uploadId;
  };

  const clearUpload = () => { pending.current = null; };
  return { stageFile, clearUpload };
}

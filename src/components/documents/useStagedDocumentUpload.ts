import { useRef } from 'react';
import { endpoints } from '@/lib/api';
import type { DraftReference } from '@/lib/documentDraftSession';

/** Keeps an unclaimed upload for retries after a failed document write. */
export function useStagedDocumentUpload() {
  const pending = useRef<{ file: File; uploadId: string } | null>(null);

  const stageFile = async (file: File, fallbackMessage: string, draft?: DraftReference): Promise<string> => {
    if (pending.current?.file === file) return pending.current.uploadId;
    const { data, error } = await endpoints.files.upload([file], draft);
    if (error) throw error;
    const uploadId = data?.[0]?.upload_id;
    if (!uploadId) throw new Error(fallbackMessage);
    pending.current = { file, uploadId };
    return uploadId;
  };

  const clearUpload = () => { pending.current = null; };
  return { stageFile, clearUpload };
}

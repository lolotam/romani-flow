import { useRef } from 'react';
import { endpoints } from '@/lib/api';
import type { DraftReference } from '@/lib/documentDraftSession';

/** Keeps an unclaimed upload for retries after a failed document write. */
export function useStagedDocumentUpload() {
  const pending = useRef<{ file: File; uploadId: string; identity: string } | null>(null);

  const stageFile = async (file: File, fallbackMessage: string, draft?: DraftReference): Promise<string> => {
    const identity = JSON.stringify(draft ?? null);
    if (pending.current?.file === file && pending.current.identity === identity) return pending.current.uploadId;
    const { data, error } = await endpoints.files.upload([file], draft);
    if (error) throw error;
    const uploadId = data?.[0]?.upload_id;
    if (!uploadId) throw new Error(fallbackMessage);
    pending.current = { file, uploadId, identity };
    return uploadId;
  };

  const clearUpload = () => { pending.current = null; };
  return { stageFile, clearUpload };
}

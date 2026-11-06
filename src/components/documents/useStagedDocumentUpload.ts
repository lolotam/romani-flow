import { useRef } from 'react';
import { endpoints } from '@/lib/api';
import type { DraftReference } from '@/lib/documentDraftSession';
import { ApiRequestError, request } from '@/lib/api/http';

/** Keeps an unclaimed upload for retries after a failed document write. */
export function useStagedDocumentUpload() {
  const pending = useRef<{ file: File; uploadId: string; context: string } | null>(null);

  const stageFile = async (file: File, fallbackMessage: string, draft?: DraftReference): Promise<string> => {
    const context = JSON.stringify([draft?.account, draft?.scope]);
    if (draft && pending.current?.file === file && pending.current.context === context) {
      const validated = await request<{ upload_id: string }>(`/api/files/uploads/${encodeURIComponent(pending.current.uploadId)}/validate`, { method: 'POST', body: { draft }, draftAccount: draft.account });
      if (validated.data) return validated.data.upload_id;
      if (!(validated.error instanceof ApiRequestError) || validated.error.code !== 'invalid_upload') throw validated.error ?? new Error(fallbackMessage);
      pending.current = null;
    }
    const { data, error } = await endpoints.files.upload([file], draft);
    if (error) throw error;
    const uploadId = data?.[0]?.upload_id;
    if (!uploadId) throw new Error(fallbackMessage);
    pending.current = { file, uploadId, context };
    return uploadId;
  };

  const clearUpload = () => { pending.current = null; };
  const abandonUpload = async (reference: () => Promise<DraftReference>): Promise<boolean> => {
    const upload = pending.current;
    if (!upload) return false;
    const draft = await reference();
    const result = await request<{ cleanupPending: boolean }>(`/api/files/uploads/${encodeURIComponent(upload.uploadId)}`, {
      method: 'DELETE', body: { draft }, draftAccount: draft.account,
    });
    if (result.error || !result.data) throw result.error ?? new Error('Upload could not be abandoned.');
    if (pending.current === upload) pending.current = null;
    return result.data.cleanupPending;
  };
  return { stageFile, clearUpload, abandonUpload };
}

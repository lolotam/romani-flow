import { format } from 'date-fns';
import { api, type Document, type Ministry } from '@/lib/api';
import type { DocumentFormData } from './documentFormSchema';
import type { DraftReference } from '@/lib/documentDraftSession';

/** Writes editable metadata; file paths and status remain server-owned. */
export async function saveDocument(
  data: DocumentFormData,
  documentId: string | undefined,
  uploadId: string | undefined,
  t: (key: string) => string,
  draft?: DraftReference,
): Promise<void> {
  // Prepare data based on beneficiary type
  const documentData: Partial<Document> & { upload_id?: string; draft?: DraftReference } = {
    title: data.title,
    issue_date: data.issue_date ? format(data.issue_date, 'yyyy-MM-dd') : null,
    expiry_date: format(data.expiry_date, 'yyyy-MM-dd'),
    notes: data.notes || null,
    document_type_id: data.document_type_id,
    company_id: data.beneficiary_type === 'company' ? data.company_id : null,
    employee_id: data.beneficiary_type === 'employee' ? data.employee_id : null,
    ministry_id: data.beneficiary_type === 'company' ? data.ministry_id : null,
    ...(uploadId ? { upload_id: uploadId } : {}),
    ...(draft ? { draft } : {}),
  };

  // Handle ministry or create custom entity
  if (data.beneficiary_type === 'company' && data.ministry_id === 'other' && data.entity_name) {
    // Create or find custom ministry for "Other"
    const { data: existingMinistries, error } = await api.from<Ministry>('ministries')
      .select('*').eq('name_ar', data.entity_name).execute();
    if (error) throw error;
    if (existingMinistries?.length) {
      documentData.ministry_id = existingMinistries[0].id;
    } else {
      const { data: created, error: ministryError } = await api.insert<Ministry>('ministries', {
        name: data.entity_name,
        name_ar: data.entity_name,
      });
      if (ministryError || !created?.[0]) {
        throw new Error(t('documents.messages.ministryCreateError'));
      }
      // Always reference the id returned by the server.
      documentData.ministry_id = created[0].id;
    }
  }

  // An update with upload_id swaps metadata and the attachment atomically.
  // Omitting upload_id preserves the attachment under the API contract.
  const { error } = documentId
    ? await api.update<Document>('documents', documentId, documentData)
    : await api.insert<Document>('documents', documentData);
  if (error) {
    const key = documentId ? 'documents.messages.updateError' : 'documents.messages.saveError';
    throw new Error(`${t(key)}: ${error.message}`);
  }
}

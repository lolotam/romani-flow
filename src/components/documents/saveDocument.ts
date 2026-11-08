import { format } from 'date-fns';
import { api, type Document } from '@/lib/api';
import type { DocumentFormData } from './documentFormSchema';
import type { DraftReference } from '@/lib/documentDraftSession';
import { documentNumber } from '../../../server/contracts/documentNumber';

/** Writes editable metadata; file paths and status remain server-owned. */
export async function saveDocument(
  data: DocumentFormData,
  documentId: string | undefined,
  uploadId: string | undefined,
  _t: (key: string) => string,
  draft?: DraftReference,
): Promise<void> {
  // Prepare data based on beneficiary type
  const documentData: Partial<Document> & { upload_id?: string; draft?: DraftReference; entity_name?: string } = {
    title: data.title,
    issue_date: data.issue_date ? format(data.issue_date, 'yyyy-MM-dd') : null,
    expiry_date: format(data.expiry_date, 'yyyy-MM-dd'),
    notes: data.notes || null,
    // An absent number is left out of the request, so a stored number survives
    // an update that never touched it. An explicit empty or null number is
    // sent and clears the stored value.
    ...(data.document_number !== undefined
      ? { document_number: documentNumber.parse(data.document_number) }
      : {}),
    document_type_id: data.document_type_id,
    company_id: data.beneficiary_type === 'company' ? data.company_id : null,
    employee_id: data.beneficiary_type === 'employee' ? data.employee_id : null,
    ministry_id: data.beneficiary_type === 'company' ? data.ministry_id : null,
    ...(uploadId ? { upload_id: uploadId } : {}),
    ...(draft ? { draft } : {}),
  };

  // Handle ministry or create custom entity
  if (data.beneficiary_type === 'company' && data.ministry_id === 'other') {
    documentData.entity_name = data.entity_name;
  }

  // An update with upload_id swaps metadata and the attachment atomically.
  // Omitting upload_id preserves the attachment under the API contract.
  const { error } = documentId
    ? await api.update<Document>('documents', documentId, documentData)
    : await api.insert<Document>('documents', documentData);
  if (error) {
    throw error;
  }
}

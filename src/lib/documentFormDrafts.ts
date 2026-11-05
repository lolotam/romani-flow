import { restoreFormDate } from './formDefaults';
import type { DraftValues } from './documentDraftSession';

/** An empty draft restores the selected filename rather than erasing its title. */
export function employeeDocumentDraft(saved: DraftValues | null, fileName?: string) {
  return {
    title: saved?.title ?? fileName?.replace(/\.[^/.]+$/, '') ?? '',
    document_type_id: saved?.document_type_id ?? '', ministry_id: saved?.ministry_id ?? '', notes: saved?.notes ?? '',
    issue_date: restoreFormDate(saved?.issue_date) ?? null, expiry_date: restoreFormDate(saved?.expiry_date) ?? null,
  };
}

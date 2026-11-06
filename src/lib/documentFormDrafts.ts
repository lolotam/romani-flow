import { restoreFormDate } from './formDefaults';
import type { DraftValues } from './documentDraftSession';

/** Only a blank new title or an unchanged filename-derived title follows a new file. */
export function nextDocumentFileTitle(title: string, generatedTitle: string | null, fileName: string, hasDraft: boolean): string | null {
  if (title && title !== generatedTitle || hasDraft && generatedTitle === null) return null;
  const next = fileName.replace(/\.[^/.]+$/, '').slice(0, 120);
  return next === title ? null : next;
}

/** A new document never inherits metadata or dates from the previous record. */
export function newDocumentDefaults(context: { employeeId?: string; companyId?: string; fallbackEmployeeId?: string }, fileName = '') {
  return {
    title: fileName.replace(/\.[^/.]+$/, '').slice(0, 120),
    beneficiary_type: (context.employeeId ? 'employee' : context.companyId ? 'company' : 'employee') as 'employee' | 'company',
    employee_id: context.employeeId || (context.companyId ? '' : context.fallbackEmployeeId || ''),
    company_id: context.companyId || '', document_type_id: '', ministry_id: '', entity_name: '',
    issue_date: undefined, expiry_date: undefined, notes: '',
  };
}

/** An empty draft restores the selected filename rather than erasing its title. */
export function employeeDocumentDraft(saved: DraftValues | null, fileName?: string) {
  return {
    title: saved?.title ?? fileName?.replace(/\.[^/.]+$/, '').slice(0, 120) ?? '',
    document_type_id: saved?.document_type_id ?? '', ministry_id: saved?.ministry_id ?? '', notes: saved?.notes ?? '',
    issue_date: restoreFormDate(saved?.issue_date) ?? null, expiry_date: restoreFormDate(saved?.expiry_date) ?? null,
  };
}

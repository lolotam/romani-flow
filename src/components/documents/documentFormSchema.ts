import { z } from 'zod';

// Create schema factory function that accepts translation function
export const createDocumentSchema = (t: (key: string) => string) => z.object({
  title: z.string().min(3, t('documents.form.validation.titleMinLength')).max(120, t('documents.form.validation.titleMaxLength')),
  beneficiary_type: z.enum(['company', 'employee'], { required_error: t('documents.form.validation.beneficiaryTypeRequired') }),
  company_id: z.string().optional(),
  employee_id: z.string().optional(),
  document_type_id: z.string().optional(),
  ministry_id: z.string().optional(),
  entity_name: z.string().max(100, t('documents.form.validation.entityNameTooLong')).optional(),
  notes: z.string().max(5000, t('documents.form.validation.notesTooLong')).optional(),
  document_number: z.string().trim().max(128, t('extraction.numberTooLong')).optional(),
}).superRefine((data, ctx) => {
  // Attach required-field errors to rendered controls, never an invisible root error.
  const required = data.beneficiary_type === 'company'
    ? ['company_id', 'ministry_id', 'document_type_id'] as const
    : ['employee_id', 'document_type_id'] as const;
  for (const field of required) {
    if (!data[field]?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom,
      message: t('documents.form.validation.allFieldsRequired'), path: [field] });
  }
}).refine((data) => {
  // Entity name required when ministry is "أخرى"
  if (data.ministry_id && data.ministry_id === 'other') {
    return data.entity_name && data.entity_name.trim().length > 0;
  }
  return true;
}, {
  message: t('documents.form.validation.entityNameRequired'),
  path: ['entity_name']
}).and(z.object({
  // Parse dates independently so missing dates do not suppress selection errors.
  issue_date: z.date().optional(),
  expiry_date: z.date({ required_error: t('documents.form.validation.expiryDateRequired') }),
})).refine((data) => {
  // Date validation - expiry date should be >= issue date
  if (data.issue_date && data.expiry_date) {
    return data.expiry_date >= data.issue_date;
  }
  return true;
}, {
  message: t('documents.form.validation.invalidDateRange'),
  path: ['expiry_date']
});

export type DocumentFormData = z.infer<ReturnType<typeof createDocumentSchema>>;

export interface DocumentFormProps {
  registerDraftClose?: (handler: (() => Promise<void>) | null) => void;
  uploadedFile: File | null;
  fileName: string;
  onClose: () => void;
  onSuccess: () => void;
  documentTypes: Array<{ id: string; name: string; name_ar: string }>;
  companies: Array<{ id: string; name: string; name_ar: string }>;
  employees: Array<{ id: string; name: string; company_id?: string | null }>;
  ministries: Array<{ id: string; name: string; name_ar: string }>;
  preselectedCompanyId?: string;
  preselectedEmployeeId?: string;
  editingDocument?: {
    id: string;
    title: string;
    document_number?: string | null;
    document_type_id: string;
    ministry_id?: string;
    employee_id?: string;
    company_id?: string;
    issue_date?: string;
    expiry_date?: string;
    notes?: string;
    file_path?: string;
    file_name?: string;
    mime_type?: string;
  } | null;
}


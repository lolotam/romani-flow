import { z } from 'zod';

// Create schema factory function that accepts translation function
export const createDocumentSchema = (t: (key: string) => string) => z.object({
  title: z.string().min(3, t('documents.form.validation.titleMinLength')).max(120, t('documents.form.validation.titleMaxLength')),
  beneficiary_type: z.enum(['company', 'employee'], { required_error: t('documents.form.validation.beneficiaryTypeRequired') }),
  company_id: z.string().optional(),
  employee_id: z.string().optional(),
  document_type_id: z.string().optional(),
  ministry_id: z.string().optional(),
  entity_name: z.string().optional(),
  issue_date: z.date().optional(),
  expiry_date: z.date({ required_error: t('documents.form.validation.expiryDateRequired') }),
  notes: z.string().optional(),
}).refine((data) => {
  // Company validation
  if (data.beneficiary_type === 'company') {
    return data.company_id && data.ministry_id && data.document_type_id;
  }
  // Employee validation  
  if (data.beneficiary_type === 'employee') {
    return data.employee_id && data.document_type_id;
  }
  return false;
}, {
  message: t('documents.form.validation.allFieldsRequired'),
}).refine((data) => {
  // Date validation - expiry date should be >= issue date
  if (data.issue_date && data.expiry_date) {
    return data.expiry_date >= data.issue_date;
  }
  return true;
}, {
  message: t('documents.form.validation.invalidDateRange'),
  path: ['expiry_date']
}).refine((data) => {
  // Entity name required when ministry is "أخرى"
  if (data.ministry_id && data.ministry_id === 'other') {
    return data.entity_name && data.entity_name.trim().length > 0;
  }
  return true;
}, {
  message: t('documents.form.validation.entityNameRequired'),
  path: ['entity_name']
});

export type DocumentFormData = z.infer<ReturnType<typeof createDocumentSchema>>;

export interface DocumentFormProps {
  uploadedFile: File | null;
  fileName: string;
  onClose: () => void;
  onSuccess: () => void;
  documentTypes: Array<{ id: string; name: string; name_ar: string }>;
  companies: Array<{ id: string; name: string; name_ar: string }>;
  employees: Array<{ id: string; name: string; company_id: string }>;
  ministries: Array<{ id: string; name: string; name_ar: string }>;
  preselectedCompanyId?: string;
  preselectedEmployeeId?: string;
  editingDocument?: {
    id: string;
    title: string;
    document_type_id: string;
    ministry_id?: string;
    employee_id?: string;
    company_id?: string;
    issue_date?: string;
    expiry_date?: string;
    notes?: string;
    file_path?: string;
    file_name?: string;
  } | null;
}


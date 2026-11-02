import type { Company, Position } from '@/types';

/**
 * The employee shape the card renders.
 *
 * It is deliberately structural: every page that holds an employee row — with
 * or without the embedded company — can hand it to the card.
 */
export interface EmployeeCardEmployee {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  position?: string | null;
  hire_date?: string | null;
  company_id?: string | null;
  document_count?: number;
  companies?: { name?: string | null; name_ar?: string | null } | null;
}

/**
 * The shape of the employee form, shared by the page and the form dialog.
 *
 * Every field is a string (or a boolean) because the dialog edits plain form
 * state; the conversion to the API payload happens in the page.
 */
export interface EmployeeFormState {
  name: string;
  email: string;
  mobile_no: string;
  position: string;
  hire_date: string;
  birth_date: string;
  civil_id_no: string;
  residency_expiry_date: string;
  driving_license: boolean;
  driving_license_expiry_date: string;
  company_id: string;
  is_active: boolean;
}

export interface EmployeeFormOptions {
  companies: Company[];
  positions: Position[];
}

/** An empty form state, used when the add dialog opens and after a reset. */
export const EMPTY_EMPLOYEE_FORM: EmployeeFormState = {
  name: '',
  email: '',
  mobile_no: '',
  position: '',
  hire_date: '',
  birth_date: '',
  civil_id_no: '',
  residency_expiry_date: '',
  driving_license: false,
  driving_license_expiry_date: '',
  company_id: '',
  is_active: true,
};

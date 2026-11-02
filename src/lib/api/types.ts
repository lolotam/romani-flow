/**
 * Entity types shared by the API client and the UI.
 *
 * These used to live in `src/lib/jsonDatabase.ts`. They now describe the shape
 * the **server** returns, so the browser and the database agree on one contract.
 */

export type DocumentStatus = 'valid' | 'expiring_soon' | 'expired';

export type PositionType =
  | 'مدير'
  | 'مندوب طبي'
  | 'مندوب شؤون'
  | 'سائق'
  | 'محاسب'
  | 'سكرتير';

export interface Company {
  id: string;
  name: string;
  name_ar: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Ministry {
  id: string;
  name: string;
  name_ar: string;
  created_at: string;
  updated_at?: string;
}

export interface DocumentType {
  id: string;
  name: string;
  name_ar: string;
  created_at: string;
  updated_at?: string;
}

export interface Position {
  id: string;
  name: string;
  name_ar: string;
  value: PositionType;
}

export interface Employee {
  id: string;
  company_id?: string | null;
  name: string;
  phone?: string | null;
  mobile_no?: string | null;
  email?: string | null;
  hire_date?: string | null;
  birth_date?: string | null;
  civil_id_no?: string | null;
  residency_expiry_date?: string | null;
  position?: string | null;
  position_id?: string | null;
  is_active?: boolean;
  driving_license?: boolean;
  driving_license_expiry_date?: string | null;
  photo_path?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Document {
  id: string;
  title: string;
  file_name?: string | null;
  file_path?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  status?: DocumentStatus;
  issue_date?: string | null;
  expiry_date?: string | null;
  notes?: string | null;
  employee_id?: string | null;
  company_id?: string | null;
  document_type_id: string;
  ministry_id?: string | null;
  created_at: string;
  updated_at?: string;
}

/** An employee with its company embedded, as returned by the API. */
export interface EmployeeWithRelations extends Employee {
  companies?: Company | null;
}

/** A document with its relations embedded, as returned by the API. */
export interface DocumentWithRelations extends Document {
  employees?: (Employee & { companies?: Company | null }) | null;
  companies?: Company | null;
  document_types?: DocumentType | null;
  ministries?: Ministry | null;
}

/** The envelope every endpoint answers with. */
export interface ApiResult<T> {
  data: T | null;
  error: Error | null;
}

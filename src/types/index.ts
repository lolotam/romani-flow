// Centralized shared types — re-exported from jsonDatabase and extended
export type {
  DocumentStatus,
  Company,
  Ministry,
  DocumentType,
  Position,
  Employee,
  Document,
} from '@/lib/jsonDatabase';

// Extended interfaces with relationship data (used in pages)
export interface EmployeeWithRelations {
  id: string;
  name: string;
  email?: string;
  mobile_no?: string;
  phone?: string;
  position?: string;
  hire_date?: string;
  birth_date?: string;
  civil_id_no?: string;
  residency_expiry_date?: string;
  residency_status?: 'expired' | 'less_than_week' | 'less_than_month' | 'valid';
  driving_license?: boolean;
  driving_license_expiry_date?: string;
  driving_license_status?: 'expired' | 'less_than_week' | 'less_than_month' | 'valid';
  document_count?: number;
  company_id: string;
  created_at: string;
  updated_at?: string;
  is_active?: boolean;
  photo?: string;
  companies?: {
    name: string;
    name_ar: string;
    description?: string;
  };
}

export interface DocumentWithRelations {
  id: string;
  title: string;
  file_name?: string;
  file_path?: string;
  status?: 'valid' | 'expiring_soon' | 'expired';
  issue_date?: string;
  expiry_date?: string;
  notes?: string;
  employee_id?: string;
  company_id?: string;
  document_type_id: string;
  ministry_id?: string;
  created_at: string;
  updated_at: string;
  employees?: {
    name: string;
    companies?: {
      name: string;
      name_ar: string;
      description?: string;
    };
  };
  companies?: {
    name: string;
    name_ar: string;
    description?: string;
  };
  document_types?: {
    name: string;
    name_ar: string;
  };
  ministries?: {
    name: string;
    name_ar: string;
  };
}

export interface DashboardStats {
  totalDocuments: number;
  totalEmployees: number;
  totalCompanies: number;
  expiringDocuments: number;
  expiredDocuments: number;
}

export interface RecentActivity {
  id: string;
  type: 'employee_added' | 'document_added' | 'document_updated';
  description: string;
  date: string;
  user: string;
}

export interface ExpiringItem {
  id: string;
  title: string;
  type: 'employee' | 'company';
  entityName: string;
  expiryDate: string;
  daysLeft: number;
  status: 'expired' | 'critical' | 'warning';
  isPinned?: boolean;
  isDeleted?: boolean;
}

export type SortField = 'name' | 'position' | 'hire_date' | 'birth_date' | 'civil_id_no' | 'mobile_no' | 'residency_expiry_date';
export type SortDirection = 'asc' | 'desc';

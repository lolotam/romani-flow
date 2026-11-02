// Centralized shared types — re-exported from the API client and extended
export type {
  DocumentStatus,
  Company,
  Ministry,
  DocumentType,
  Position,
  PositionType,
  Employee,
  Document,
} from '@/lib/api/types';

import type {
  EmployeeWithRelations as ApiEmployeeWithRelations,
  DocumentWithRelations as ApiDocumentWithRelations,
} from '@/lib/api/types';

/** Expiry state of a date, derived in the browser from the expiry date. */
export type ExpiryStatus = 'expired' | 'less_than_week' | 'less_than_month' | 'valid';

// Extended interfaces with relationship data (used in pages)
export interface EmployeeWithRelations extends ApiEmployeeWithRelations {
  /** Computed in the browser from the employee's documents — never persisted. */
  document_count?: number;
  residency_status?: ExpiryStatus;
  driving_license_status?: ExpiryStatus;
}

export type DocumentWithRelations = ApiDocumentWithRelations;

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

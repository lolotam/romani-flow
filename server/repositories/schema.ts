/**
 * Table registry.
 *
 * Every table, column and relation the API can touch is declared here. User input
 * is never interpolated into SQL without passing through this allow-list, which is
 * what keeps the query layer free of injection.
 */

export interface RelationSpec {
  /** Table the relation points at. */
  table: string;
  /** Foreign key column on the owning table. */
  foreignKey: string;
  /** Relations nested inside the embedded object, keyed by relation name. */
  nested?: Record<string, RelationSpec>;
}

export interface TableSpec {
  name: string;
  columns: string[];
  relations?: Record<string, RelationSpec>;
  /** Columns that hold a boolean as 0 or 1. */
  booleanColumns?: string[];
  /** Columns the server owns and always overwrites. */
  managed?: string[];
}

export const TABLES: Record<string, TableSpec> = {
  companies: {
    name: 'companies',
    columns: ['id', 'name', 'name_ar', 'description', 'created_at', 'updated_at'],
  },
  ministries: {
    name: 'ministries',
    columns: ['id', 'name', 'name_ar', 'created_at', 'updated_at'],
  },
  document_types: {
    name: 'document_types',
    columns: ['id', 'name', 'name_ar', 'created_at', 'updated_at'],
  },
  positions: {
    name: 'positions',
    columns: ['id', 'name', 'name_ar', 'value', 'created_at', 'updated_at'],
  },
  employees: {
    name: 'employees',
    columns: [
      'id',
      'company_id',
      'name',
      'phone',
      'mobile_no',
      'email',
      'hire_date',
      'birth_date',
      'civil_id_no',
      'residency_expiry_date',
      'position',
      'position_id',
      'is_active',
      'whatsapp_notifications_enabled',
      'driving_license',
      'driving_license_expiry_date',
      'photo_path',
      'created_at',
      'updated_at',
    ],
    booleanColumns: ['is_active', 'driving_license', 'whatsapp_notifications_enabled'],
    relations: {
      companies: { table: 'companies', foreignKey: 'company_id' },
    },
  },
  documents: {
    name: 'documents',
    columns: [
      'id',
      'title',
      'file_name',
      'file_path',
      'file_size',
      'mime_type',
      'status',
      'issue_date',
      'expiry_date',
      'notes',
      'employee_id',
      'company_id',
      'document_type_id',
      'ministry_id',
      'created_at',
      'updated_at',
    ],
    relations: {
      employees: {
        table: 'employees',
        foreignKey: 'employee_id',
        nested: { companies: { table: 'companies', foreignKey: 'company_id' } },
      },
      companies: { table: 'companies', foreignKey: 'company_id' },
      document_types: { table: 'document_types', foreignKey: 'document_type_id' },
      ministries: { table: 'ministries', foreignKey: 'ministry_id' },
    },
  },
  admin_users: {
    name: 'admin_users',
    columns: [
      'id',
      'email',
      'name',
      'password_hash',
      'role',
      'is_active',
      'last_login_at',
      'created_at',
      'updated_at',
    ],
  },
};

/** Tables the SPA is allowed to read and write through the generic endpoints. */
export const PUBLIC_TABLES = [
  'companies',
  'ministries',
  'document_types',
  'positions',
  'employees',
  'documents',
] as const;

export type PublicTable = (typeof PUBLIC_TABLES)[number];

export function isPublicTable(name: string): name is PublicTable {
  return (PUBLIC_TABLES as readonly string[]).includes(name);
}

export function getTable(name: string): TableSpec | undefined {
  return TABLES[name];
}

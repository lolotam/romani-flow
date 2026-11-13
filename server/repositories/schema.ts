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
  /**
   * Foreign-key columns and the table they point at. A write may only reference
   * a row of the same workspace, so a foreign id behaves as if it did not exist.
   */
  references?: Record<string, string>;
  /**
   * Reference values that are sentinels instead of row ids, keyed by column.
   *
   * A sentinel carries no row of its own, so it is accepted as it is: it can
   * never point at the row of another workspace.
   */
  sentinelReferences?: Record<string, string[]>;
}

/**
 * Tables whose rows belong to one workspace. Every generic read and write of
 * these tables is filtered by the caller's workspace, and `workspace_id` is
 * never a column the client can filter on or write.
 */
export const TENANT_TABLES = new Set([
  'companies',
  'ministries',
  'document_types',
  'positions',
  'employees',
  'documents',
]);

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
    references: { company_id: 'companies', position_id: 'positions' },
    relations: {
      companies: { table: 'companies', foreignKey: 'company_id' },
    },
  },
  documents: {
    name: 'documents',
    columns: [
      'id',
      'title',
      'document_number',
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
    references: {
      employee_id: 'employees',
      company_id: 'companies',
      document_type_id: 'document_types',
      ministry_id: 'ministries',
    },
    // The storage columns belong to the server: only the metadata of an
    // uploaded file may fill them, never a value the client sends.
    managed: ['file_path', 'file_name', 'file_size', 'mime_type'],
    // `other` is the sentinel of a custom ministry; it names no row.
    sentinelReferences: { ministry_id: ['other'] },
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

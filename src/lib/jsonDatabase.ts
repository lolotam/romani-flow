// Browser-compatible JSON database implementation using localStorage
// Types based on the original Supabase schema
export type DocumentStatus = 'valid' | 'expiring_soon' | 'expired';
export type PositionType = 'مدير' | 'مندوب طبي' | 'مندوب شؤون' | 'سائق' | 'محاسب' | 'سكرتير';

export interface Company {
  id: string;
  name: string;
  name_ar: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface Ministry {
  id: string;
  name: string;
  name_ar: string;
  created_at: string;
}

export interface DocumentType {
  id: string;
  name: string;
  name_ar: string;
  created_at: string;
}

export interface Position {
  id: string;
  name: string;
  name_ar: string;
  value: PositionType;
}

export interface Employee {
  id: string;
  company_id: string;
  name: string;
  phone?: string;
  mobile_no?: string;
  email?: string;
  hire_date?: string;
  birth_date?: string;
  civil_id_no?: string;
  residency_expiry_date?: string;
  position?: PositionType;
  position_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  title: string;
  file_name?: string;
  file_path?: string;
  status?: DocumentStatus;
  issue_date?: string;
  expiry_date?: string;
  notes?: string;
  employee_id?: string;
  company_id?: string;
  document_type_id: string;
  ministry_id?: string;
  created_at: string;
  updated_at: string;
}


// Database structure
interface Database {
  companies: Record<string, Company>;
  ministries: Record<string, Ministry>;
  document_types: Record<string, DocumentType>;
  positions: Record<string, Position>;
  employees: Record<string, Employee>;
  documents: Record<string, Document>;
  indexes: {
    employees_by_company: Record<string, string[]>;
    documents_by_employee: Record<string, string[]>;
    documents_by_company: Record<string, string[]>;
  };
}

// Generate UUID v4 compatible ID
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Calculate document status based on expiry date
function calculateDocumentStatus(expiryDate?: string): DocumentStatus {
  if (!expiryDate) return 'valid';

  const expiry = new Date(expiryDate);
  const now = new Date();
  const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'expired';
  if (diffDays <= 30) return 'expiring_soon';
  return 'valid';
}

// Database storage key
const DB_STORAGE_KEY = 'romani_json_database';

// Load database from localStorage
function loadDatabase(): Database {
  try {
    const data = localStorage.getItem(DB_STORAGE_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading database from localStorage:', error);
  }

  // Return empty database structure if not found or corrupted
  return {
    companies: {},
    ministries: {},
    document_types: {},
    positions: {},
    employees: {},
    documents: {},
    
    indexes: {
      employees_by_company: {},
      documents_by_employee: {},
      documents_by_company: {}
    }
  };
}

// Save database to localStorage
function saveDatabase(db: Database): void {
  try {
    localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(db));
  } catch (error) {
    console.error('Error saving database to localStorage:', error);
    throw new Error('Failed to save database');
  }
}

// Initialize database with exported data
async function initializeDatabase(): Promise<void> {
  const existingData = localStorage.getItem(DB_STORAGE_KEY);
  if (existingData) {
    return; // Database already initialized
  }

  try {
    // Try to load the exported data
    const response = await fetch('/data/database.json');
    if (response.ok) {
      const exportedData = await response.json();
      localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(exportedData));
      console.log('Database initialized from exported data');
    } else {
      // If no exported data found, create empty database
      const emptyDb = loadDatabase();
      saveDatabase(emptyDb);
      console.log('Database initialized with empty structure');
    }
  } catch (error) {
    console.error('Error initializing database:', error);
    // Create empty database as fallback
    const emptyDb = loadDatabase();
    saveDatabase(emptyDb);
  }
}

// Update indexes for data consistency
function updateIndexes(db: Database): void {
  // Reset indexes
  db.indexes = {
    employees_by_company: {},
    documents_by_employee: {},
    documents_by_company: {}
  };

  // Rebuild employee indexes
  Object.values(db.employees).forEach(employee => {
    if (!db.indexes.employees_by_company[employee.company_id]) {
      db.indexes.employees_by_company[employee.company_id] = [];
    }
    db.indexes.employees_by_company[employee.company_id].push(employee.id);
  });

  // Rebuild document indexes
  Object.values(db.documents).forEach(document => {
    if (document.employee_id) {
      if (!db.indexes.documents_by_employee[document.employee_id]) {
        db.indexes.documents_by_employee[document.employee_id] = [];
      }
      db.indexes.documents_by_employee[document.employee_id].push(document.id);
    }

    if (document.company_id) {
      if (!db.indexes.documents_by_company[document.company_id]) {
        db.indexes.documents_by_company[document.company_id] = [];
      }
      db.indexes.documents_by_company[document.company_id].push(document.id);
    }
  });
}

// Query builder class
export class QueryBuilder<T = any> {
  private tableName: string;
  private selectFields: string = '*';
  private whereConditions: Array<(record: any) => boolean> = [];
  private orderByField?: string;
  private orderDirection: 'asc' | 'desc' = 'asc';
  private limitCount?: number;
  private offsetCount?: number;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  select(fields: string): QueryBuilder<T> {
    this.selectFields = fields;
    return this;
  }

  eq(field: string, value: any): QueryBuilder<T> {
    this.whereConditions.push((record: any) => record[field] === value);
    return this;
  }

  neq(field: string, value: any): QueryBuilder<T> {
    this.whereConditions.push((record: any) => record[field] !== value);
    return this;
  }

  gt(field: string, value: any): QueryBuilder<T> {
    this.whereConditions.push((record: any) => record[field] > value);
    return this;
  }

  gte(field: string, value: any): QueryBuilder<T> {
    this.whereConditions.push((record: any) => record[field] >= value);
    return this;
  }

  lt(field: string, value: any): QueryBuilder<T> {
    this.whereConditions.push((record: any) => record[field] < value);
    return this;
  }

  lte(field: string, value: any): QueryBuilder<T> {
    this.whereConditions.push((record: any) => record[field] <= value);
    return this;
  }

  like(field: string, pattern: string): QueryBuilder<T> {
    const regex = new RegExp(pattern.replace(/%/g, '.*'), 'i');
    this.whereConditions.push((record: any) => regex.test(record[field] || ''));
    return this;
  }

  in(field: string, values: any[]): QueryBuilder<T> {
    this.whereConditions.push((record: any) => values.includes(record[field]));
    return this;
  }

  order(field: string, direction: 'asc' | 'desc' = 'asc'): QueryBuilder<T> {
    this.orderByField = field;
    this.orderDirection = direction;
    return this;
  }

  limit(count: number): QueryBuilder<T> {
    this.limitCount = count;
    return this;
  }

  offset(count: number): QueryBuilder<T> {
    this.offsetCount = count;
    return this;
  }

  async execute(): Promise<{ data: T[] | null; error: Error | null }> {
    try {
      const db = loadDatabase();
      let records = Object.values((db as any)[this.tableName] || {});

      // Apply where conditions
      for (const condition of this.whereConditions) {
        records = records.filter(condition);
      }

      // Handle relationships (basic join simulation)
      if (this.selectFields.includes('(')) {
        records = await this.processRelationships(records, db);
      }

      // Apply ordering
      if (this.orderByField) {
        records.sort((a: any, b: any) => {
          const aVal = a[this.orderByField!];
          const bVal = b[this.orderByField!];

          if (aVal === bVal) return 0;

          const comparison = aVal > bVal ? 1 : -1;
          return this.orderDirection === 'asc' ? comparison : -comparison;
        });
      }

      // Apply pagination
      if (this.offsetCount) {
        records = records.slice(this.offsetCount);
      }
      if (this.limitCount) {
        records = records.slice(0, this.limitCount);
      }

      return { data: records as T[], error: null };
    } catch (error) {
      console.error('Query execution error:', error);
      return { data: null, error: error as Error };
    }
  }

  private async processRelationships(records: any[], db: Database): Promise<any[]> {
    return records.map(record => {
      const result = { ...record };

      // Handle company relationships
      if (record.company_id && this.selectFields.includes('companies')) {
        const company = db.companies[record.company_id];
        if (company) {
          result.companies = company;
        }
      }

      // Handle employee relationships
      if (record.employee_id && this.selectFields.includes('employees')) {
        const employee = db.employees[record.employee_id];
        if (employee) {
          result.employees = employee;

          // Handle nested company relationship for employees
          if (employee.company_id && this.selectFields.includes('companies')) {
            const company = db.companies[employee.company_id];
            if (company) {
              result.employees.companies = company;
            }
          }
        }
      }

      // Handle document type relationships
      if (record.document_type_id && this.selectFields.includes('document_types')) {
        const docType = db.document_types[record.document_type_id];
        if (docType) {
          result.document_types = docType;
        }
      }

      // Handle ministry relationships
      if (record.ministry_id && this.selectFields.includes('ministries')) {
        const ministry = db.ministries[record.ministry_id];
        if (ministry) {
          result.ministries = ministry;
        }
      }

      return result;
    });
  }
}

// Main database class
export class JSONDatabase {
  constructor() {
    // Initialize database on first use
    initializeDatabase().catch(console.error);
  }

  from<T = any>(tableName: string): QueryBuilder<T> {
    return new QueryBuilder<T>(tableName);
  }

  async insert<T>(tableName: string, records: Partial<T>[] | Partial<T>): Promise<{ data: T[] | null; error: Error | null }> {
    try {
      const db = loadDatabase();
      const table = (db as any)[tableName];
      if (!table) {
        throw new Error(`Table ${tableName} not found`);
      }

      const insertedRecords: T[] = [];
      const now = new Date().toISOString();

      // Ensure records is always an array
      const recordsArray = Array.isArray(records) ? records : [records];

      for (const record of recordsArray) {
        const id = generateId();
        const newRecord = {
          ...record,
          id,
          created_at: now,
          updated_at: now,
          // Auto-calculate document status for documents
          ...(tableName === 'documents' && (record as any).expiry_date
            ? { status: calculateDocumentStatus((record as any).expiry_date) }
            : {})
        };

        table[id] = newRecord;
        insertedRecords.push(newRecord as T);
      }

      updateIndexes(db);
      saveDatabase(db);

      return { data: insertedRecords, error: null };
    } catch (error) {
      console.error('Insert error:', error);
      return { data: null, error: error as Error };
    }
  }

  async update<T>(tableName: string, id: string, updates: Partial<T>): Promise<{ data: T | null; error: Error | null }> {
    try {
      const db = loadDatabase();
      const table = (db as any)[tableName];
      if (!table || !table[id]) {
        throw new Error(`Record with id ${id} not found in table ${tableName}`);
      }

      const updatedRecord = {
        ...table[id],
        ...updates,
        updated_at: new Date().toISOString(),
        // Auto-calculate document status for documents
        ...(tableName === 'documents' && (updates as any).expiry_date
          ? { status: calculateDocumentStatus((updates as any).expiry_date) }
          : {})
      };

      table[id] = updatedRecord;
      updateIndexes(db);
      saveDatabase(db);

      return { data: updatedRecord as T, error: null };
    } catch (error) {
      console.error('Update error:', error);
      return { data: null, error: error as Error };
    }
  }

  async delete(tableName: string, id: string): Promise<{ error: Error | null }> {
    try {
      const db = loadDatabase();
      const table = (db as any)[tableName];
      if (!table || !table[id]) {
        throw new Error(`Record with id ${id} not found in table ${tableName}`);
      }

      delete table[id];
      updateIndexes(db);
      saveDatabase(db);

      return { error: null };
    } catch (error) {
      console.error('Delete error:', error);
      return { error: error as Error };
    }
  }
}

// Export singleton instance
export const jsonDatabase = new JSONDatabase();
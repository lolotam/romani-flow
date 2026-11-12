import type { Db } from './connection.js';
import { insertRow, type Scope } from '../repositories/base.js';

/**
 * The generic catalog a new workspace starts with (plan D10, owner decision 2026-11-12).
 *
 * These are the general entries of the owner catalog in `ownerCatalogs.ts`. Romani's
 * own companies and document types are never part of it. Each workspace gets fresh
 * ids, so no row id is shared between workspaces.
 */
export const STARTER_MINISTRIES = [
  { name: 'Ministry of Interior', name_ar: 'وزارة الداخلية' },
  { name: 'Ministry of Justice', name_ar: 'وزارة العدل' },
  { name: 'Ministry of Health', name_ar: 'وزارة الصحة' },
  { name: 'Ministry of Public Works', name_ar: 'وزارة الأشغال العامة' },
];

export const STARTER_POSITIONS = [
  { name: 'Office Boy', name_ar: 'عامل مكتب', value: 'office-boy' },
  { name: 'Secretary', name_ar: 'سكرتيرة', value: 'secretary' },
  { name: 'Marketing Manager (Marketing)', name_ar: 'مدير ماركتنج', value: 'marketing-manager-marketing' },
  { name: 'Supervisor', name_ar: 'مشرف', value: 'supervisor' },
  { name: 'Driver', name_ar: 'سائق', value: 'driver' },
  { name: 'CEO', name_ar: 'الرئيس التنفيذي', value: 'ceo' },
  { name: 'Sales Manager', name_ar: 'مدير مبيعات', value: 'sales-manager' },
];

export function seedStarterCatalog(db: Db, scope: Scope): void {
  for (const ministry of STARTER_MINISTRIES) insertRow(db, scope, 'ministries', ministry);
  for (const position of STARTER_POSITIONS) insertRow(db, scope, 'positions', position);
}

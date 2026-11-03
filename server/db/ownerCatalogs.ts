import type { Db } from './connection.js';
import { getSetting, setSetting } from '../repositories/settings.js';

const CATALOG_SQL = `-- Owner-approved bilingual catalogs. Preserve existing records and never re-seed on restart.
INSERT INTO companies (id, name, name_ar, created_at, updated_at)
SELECT '74a6a189-2c4a-4408-addc-9f1fdf5ceaa7', 'CureMed', 'كيور ميد', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE trim(name_ar)='كيور ميد' OR lower(trim(name))=lower('CureMed'));

INSERT INTO companies (id, name, name_ar, created_at, updated_at)
SELECT '752f9857-1abe-48fe-82a8-4304cfa76a51', 'Cosmenix', 'كوزمينكس', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE trim(name_ar)='كوزمينكس' OR lower(trim(name))=lower('Cosmenix'));

INSERT INTO ministries (id, name, name_ar, created_at, updated_at)
SELECT '87ead4c6-5aa9-48d3-a26a-ad5cea5e7281', 'Ministry of Interior', 'وزارة الداخلية', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM ministries WHERE trim(name_ar)='وزارة الداخلية' OR lower(trim(name))=lower('Ministry of Interior'));

INSERT INTO ministries (id, name, name_ar, created_at, updated_at)
SELECT '6f787ae6-cda5-4d89-9dd6-736fdfde3446', 'Ministry of Justice', 'وزارة العدل', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM ministries WHERE trim(name_ar)='وزارة العدل' OR lower(trim(name))=lower('Ministry of Justice'));

INSERT INTO ministries (id, name, name_ar, created_at, updated_at)
SELECT 'd3390c0b-c21a-4a88-bd2d-b04b7b750132', 'Ministry of Health', 'وزارة الصحة', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM ministries WHERE trim(name_ar)='وزارة الصحة' OR lower(trim(name))=lower('Ministry of Health'));

INSERT INTO ministries (id, name, name_ar, created_at, updated_at)
SELECT '97871957-af28-41ec-a9c4-87e069181006', 'Ministry of Public Works', 'وزارة الأشغال العامة', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM ministries WHERE trim(name_ar)='وزارة الأشغال العامة' OR lower(trim(name))=lower('Ministry of Public Works'));

INSERT INTO positions (id, name, name_ar, value, created_at, updated_at)
SELECT 'b3754259-a42b-408f-bc80-37f65cbc0eff', 'Medical Representative', 'مندوب طبي', 'medical-representative', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM positions WHERE trim(name_ar)='مندوب طبي' OR value='medical-representative');

INSERT INTO positions (id, name, name_ar, value, created_at, updated_at)
SELECT 'd1ebdd14-758b-4f5d-83c1-eaab3f4bd15a', 'Marketing Manager', 'مدير تسويق', 'marketing-manager', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM positions WHERE trim(name_ar)='مدير تسويق' OR value='marketing-manager');

INSERT INTO positions (id, name, name_ar, value, created_at, updated_at)
SELECT 'f2e248e2-ab82-466b-8e6e-89bba7502ab3', 'Representative', 'مندوب', 'representative', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM positions WHERE trim(name_ar)='مندوب' OR value='representative');

INSERT INTO positions (id, name, name_ar, value, created_at, updated_at)
SELECT '628f5858-3479-44ba-b29c-53cde7739f46', 'Office Boy', 'عامل مكتب', 'office-boy', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM positions WHERE trim(name_ar)='عامل مكتب' OR value='office-boy');

INSERT INTO positions (id, name, name_ar, value, created_at, updated_at)
SELECT 'e5a61673-7d51-4ce9-b13a-6bdacf361299', 'Secretary', 'سكرتيرة', 'secretary', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM positions WHERE trim(name_ar)='سكرتيرة' OR value='secretary');

INSERT INTO positions (id, name, name_ar, value, created_at, updated_at)
SELECT 'e949cbb2-47a0-4868-b5ce-0ed47a6e870c', 'Marketing Manager (Marketing)', 'مدير ماركتنج', 'marketing-manager-marketing', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM positions WHERE trim(name_ar)='مدير ماركتنج' OR value='marketing-manager-marketing');

INSERT INTO positions (id, name, name_ar, value, created_at, updated_at)
SELECT '08306d9e-e18e-4d0d-a0e8-e4c4e9abc522', 'Supervisor', 'مشرف', 'supervisor', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM positions WHERE trim(name_ar)='مشرف' OR value='supervisor');

INSERT INTO positions (id, name, name_ar, value, created_at, updated_at)
SELECT '134bc4ca-d805-49cd-a6be-0aeca0969c82', 'Driver', 'سائق', 'driver', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM positions WHERE trim(name_ar)='سائق' OR value='driver');

INSERT INTO positions (id, name, name_ar, value, created_at, updated_at)
SELECT 'c6f1935c-4969-408d-81e2-d0aeea10c02b', 'CEO', 'الرئيس التنفيذي', 'ceo', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM positions WHERE trim(name_ar)='الرئيس التنفيذي' OR value='ceo');

INSERT INTO positions (id, name, name_ar, value, created_at, updated_at)
SELECT '0eb3c3e7-4343-4769-bd3b-31d5937cf764', 'Sales Manager', 'مدير مبيعات', 'sales-manager', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM positions WHERE trim(name_ar)='مدير مبيعات' OR value='sales-manager');

`;

/** Apply owner catalogs after optional private import, once, without replacing existing rows. */
export function applyOwnerCatalogs(db: Db): void {
  // A missing optional seed must remain importable until the operator finalizes that decision.
  if (getSetting(db, 'system.seed_version') !== '1') return;
  if (getSetting(db, 'system.owner_catalog_version') === '1') return;
  db.exec('BEGIN');
  try {
    db.exec(CATALOG_SQL);
    setSetting(db, 'system.owner_catalog_version', '1');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

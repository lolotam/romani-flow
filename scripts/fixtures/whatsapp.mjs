import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { runMigrations } from '../../server/db/migrator.ts';
import { insertRow } from '../../server/repositories/base.ts';
import { setSetting } from '../../server/repositories/settings.ts';

export const EMPLOYEE_PHONE='+99900000001', MANAGER_PHONE='+99900000002';
export function reminderFixture(file=':memory:') {
 const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');runMigrations(db,path.resolve('server/db/migrations'));
 const company=insertRow(db, { workspaceId: 'ws_legacy' }, 'companies',{name:'Synthetic company',name_ar:'شركة اختبار'});
 const type=insertRow(db, { workspaceId: 'ws_legacy' }, 'document_types',{name:'Synthetic',name_ar:'اختبار'});
 const employee=insertRow(db, { workspaceId: 'ws_legacy' }, 'employees',{name:'موظف اختبار',company_id:company.id,mobile_no:EMPLOYEE_PHONE,residency_expiry_date:'2026-01-01'});
 const document=insertRow(db, { workspaceId: 'ws_legacy' }, 'documents',{title:'وثيقة اختبار',employee_id:employee.id,document_type_id:type.id,expiry_date:'2026-01-01'});
 setSetting(db, { workspaceId: 'ws_legacy' }, 'whatsapp.enabled',true);
 const clock={now:new Date('2026-01-02T08:00:00Z')};
 return {db,company,type,employee,document,clock,close:()=>db.close()};
}

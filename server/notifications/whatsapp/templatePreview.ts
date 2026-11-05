import type { Request, Response, NextFunction } from 'express';
import { RepositoryError } from '../../repositories/base.js';
import { expiryReportSubject, expiryReportText, type ExpiryReport } from '../../services/templates/index.js';
import { reminderText } from './templates.js';

/** Synthetic previews use the delivery renderers without reading business data or sending. */
export function templatePreview(req: Request, res: Response, next: NextFunction): void {
  const { channel, language } = req.query;
  if ((channel !== 'whatsapp' && channel !== 'email') || (language !== 'ar' && language !== 'en')) {
    next(new RepositoryError('Choose a supported channel and language.', 'invalid_query', 400)); return;
  }
  const item = language === 'ar' ? 'تصريح العمل' : 'Work permit';
  const owner = language === 'ar' ? 'موظف مثال' : 'Example employee';
  const company = language === 'ar' ? 'شركة مثال' : 'Example company';
  const expiry = '2030-01-15';
  if (channel === 'whatsapp') {
    res.json({ data: { samples: [
      { kind: 'management', text: reminderText('management', item, owner, expiry, false, language) },
      { kind: 'company', text: reminderText('management', item, company, expiry, true, language) },
      { kind: 'employee', text: reminderText('employee', item, owner, expiry, false, language) },
    ] }, error: null }); return;
  }
  const report: ExpiryReport = {
    language, generatedAt: new Date('2030-01-08T08:00:00Z'), windowDays: 30, employees: [],
    documents: [{ id: 'preview', title: item, employeeName: owner, companyName: company,
      fileName: null, documentTypeName: null, ministryName: null, issueDate: null,
      expiryDate: expiry, daysRemaining: 7, isExpired: false, intervalDays: 7 }],
  };
  res.json({ data: { samples: [{ kind: 'email', subject: expiryReportSubject(report), text: expiryReportText(report) }] }, error: null });
}

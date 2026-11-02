import {
  arabicDays,
  expiryStatus,
  formatDate,
  remainingLabel,
  type EmailLanguage,
  type LocalisedText,
} from './shared.js';
import type { ExpiringDocument, ExpiringEmployee, ExpiryReport } from './reportTypes.js';

/**
 * The expiry reminder — subject line and plain-text body.
 *
 * The Arabic version is the default. The HTML body lives in
 * `expiryReportHtml.ts`; this module owns the text alternative, which carries
 * the very same details so the message stays complete in a text-only client.
 */

export type { ExpiringDocument, ExpiringEmployee, ExpiryReport };

export const COPY = {
  title: { ar: 'تنبيه انتهاء الصلاحية', en: 'Expiry reminder' } satisfies LocalisedText,
  subtitle: { ar: 'تقرير تلقائي من نظام روماني فلو', en: 'Automatic report from ROMANI Flow' } satisfies LocalisedText,
  generatedOn: { ar: 'تاريخ الإصدار', en: 'Generated on' } satisfies LocalisedText,
  window: { ar: 'مدة التنبيه', en: 'Notice period' } satisfies LocalisedText,
  documentsTitle: { ar: 'المستندات', en: 'Documents' } satisfies LocalisedText,
  employeesTitle: { ar: 'إقامات الموظفين', en: 'Employee residencies' } satisfies LocalisedText,
  nothingDue: {
    ar: 'لا توجد عناصر مستحقة في هذه الفترة.',
    en: 'Nothing is due in this period.',
  } satisfies LocalisedText,
  colDocument: { ar: 'المستند', en: 'Document' } satisfies LocalisedText,
  colType: { ar: 'النوع', en: 'Type' } satisfies LocalisedText,
  colOwner: { ar: 'الجهة', en: 'Owner' } satisfies LocalisedText,
  colExpiry: { ar: 'تاريخ الانتهاء', en: 'Expiry date' } satisfies LocalisedText,
  colRemaining: { ar: 'المتبقي', en: 'Remaining' } satisfies LocalisedText,
  colCompany: { ar: 'الشركة', en: 'Company' } satisfies LocalisedText,
  colEmployee: { ar: 'الموظف', en: 'Employee' } satisfies LocalisedText,
  footer: { ar: 'تم الإرسال تلقائياً من نظام روماني فلو.', en: 'Sent automatically by ROMANI Flow.' } satisfies LocalisedText,
} as const;

export function expiryReportSubject(report: ExpiryReport): string {
  const count = report.employees.length + report.documents.length;
  const language = report.language;

  if (count === 0) {
    return language === 'ar'
      ? 'تنبيه انتهاء الصلاحية — لا توجد عناصر مستحقة'
      : 'Expiry reminder — nothing due';
  }

  return language === 'ar'
    ? `تنبيه انتهاء الصلاحية — ${count} عنصر يحتاج إلى متابعة`
    : `Expiry reminder — ${count} item${count === 1 ? '' : 's'} need attention`;
}

/** The plain-text alternative — same details, no markup. */
export function expiryReportText(report: ExpiryReport): string {
  const language = report.language;
  const lines: string[] = [];
  const date = report.generatedAt.toISOString().slice(0, 10);

  if (language === 'ar') {
    lines.push('تنبيه انتهاء الصلاحية');
    lines.push('=======================');
    lines.push(`تاريخ الإصدار: ${date}`);
    lines.push(`مدة التنبيه: ${arabicDays(report.windowDays)}`);
    lines.push('');

    if (report.documents.length === 0 && report.employees.length === 0) {
      lines.push(COPY.nothingDue.ar);
      return lines.join('\n');
    }

    if (report.documents.length > 0) {
      lines.push(`المستندات (${report.documents.length})`);
      lines.push('-----------------');
      for (const document of report.documents) {
        const owner = document.employeeName || document.companyName || '—';
        lines.push(`• ${document.title} — ${document.documentTypeName || '—'} — ${owner}`);
        lines.push(`    الوزارة: ${document.ministryName || '—'}`);
        lines.push(
          `    تاريخ الإصدار: ${formatDate(document.issueDate)} — تاريخ الانتهاء: ${formatDate(document.expiryDate)}`,
        );
        lines.push(
          `    الحالة: ${expiryStatus(document, language)} — ${remainingLabel(document.daysRemaining, language)}`,
        );
      }
      lines.push('');
    }

    if (report.employees.length > 0) {
      lines.push(`إقامات الموظفين (${report.employees.length})`);
      lines.push('---------------------');
      for (const employee of report.employees) {
        lines.push(`• ${employee.name} — ${employee.companyName || '—'}`);
        lines.push(`    تاريخ الانتهاء: ${formatDate(employee.expiryDate)}`);
        lines.push(
          `    الحالة: ${expiryStatus(employee, language)} — ${remainingLabel(employee.daysRemaining, language)}`,
        );
      }
      lines.push('');
    }

    lines.push(COPY.footer.ar);
    return lines.join('\n');
  }

  lines.push('Expiry reminder');
  lines.push('===============');
  lines.push(`Generated on: ${date}`);
  lines.push(`Notice period: ${report.windowDays} days`);
  lines.push('');

  if (report.documents.length === 0 && report.employees.length === 0) {
    lines.push(COPY.nothingDue.en);
    return lines.join('\n');
  }

  if (report.documents.length > 0) {
    lines.push(`Documents (${report.documents.length})`);
    for (const document of report.documents) {
      const owner = document.employeeName || document.companyName || '—';
      lines.push(`• ${document.title} — ${document.documentTypeName || '—'} — ${owner}`);
      lines.push(`    Ministry: ${document.ministryName || '—'}`);
      lines.push(
        `    Issue date: ${formatDate(document.issueDate)} — Expiry date: ${formatDate(document.expiryDate)}`,
      );
      lines.push(
        `    Status: ${expiryStatus(document, language)} — ${remainingLabel(document.daysRemaining, language)}`,
      );
    }
    lines.push('');
  }

  if (report.employees.length > 0) {
    lines.push(`Employee residencies (${report.employees.length})`);
    for (const employee of report.employees) {
      lines.push(`• ${employee.name} — ${employee.companyName || '—'}`);
      lines.push(`    Expiry date: ${formatDate(employee.expiryDate)}`);
      lines.push(
        `    Status: ${expiryStatus(employee, language)} — ${remainingLabel(employee.daysRemaining, language)}`,
      );
    }
    lines.push('');
  }

  lines.push(COPY.footer.en);
  return lines.join('\n');
}

/** The reminder threshold an item was collected for, in days. */
export function intervalLabel(days: number, language: EmailLanguage): string {
  if (language === 'ar') return `قبل ${arabicDays(days)}`;
  return `${days} day${days === 1 ? '' : 's'} before`;
}

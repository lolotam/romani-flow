import {
  arabicDays,
  EMAIL_COLORS,
  escapeHtml,
  expiryStatus,
  formatDate,
  pick,
  remainingBadgeText,
  type EmailLanguage,
} from './shared.js';
import { COPY } from './expiryReport.js';
import type { ExpiringDocument, ExpiringEmployee, ExpiryReport } from './reportTypes.js';

/**
 * The HTML body of the expiry reminder.
 *
 * It is built for real mail clients, not for browsers:
 *
 * - every layout is a table, because Outlook does not do flexbox;
 * - the header gradient is layered on top of a solid background colour, so a
 *   client that strips `background-image` still shows the brand colour;
 * - the data tables scroll horizontally on a narrow screen instead of
 *   squeezing their columns into unreadable slivers;
 * - the text alternative in `expiryReport.ts` carries the same details.
 */

/** The status pill — always shows the status word *and* the days left. */
function badge(item: ExpiringDocument | ExpiringEmployee, language: EmailLanguage): string {
  const isExpired = item.isExpired;
  const status = expiryStatus(item, language);
  const remaining = remainingBadgeText(item.daysRemaining, language);

  const background = isExpired
    ? EMAIL_COLORS.dangerBg
    : item.daysRemaining <= 7
      ? EMAIL_COLORS.warningBg
      : EMAIL_COLORS.surface;
  const color = isExpired
    ? EMAIL_COLORS.danger
    : item.daysRemaining <= 7
      ? EMAIL_COLORS.warning
      : EMAIL_COLORS.primary;

  return `<span style="display:inline-block;background:${background};color:${color};font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;white-space:nowrap;">${escapeHtml(status)} · ${escapeHtml(remaining)}</span>`;
}

/** A small grey line under the main value of a cell. */
function subLine(label: string, value: string | null): string {
  if (!value) return '';
  return `<div style="font-size:12px;color:${EMAIL_COLORS.muted};margin-top:2px;">${escapeHtml(label)}: ${escapeHtml(value)}</div>`;
}

function summaryCell(label: string, value: number, accent: string, align: string): string {
  return `
    <td width="33%" style="width:33%;padding:0 6px 12px 6px;vertical-align:top;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_COLORS.surface};border:1px solid ${EMAIL_COLORS.border};border-radius:12px;">
        <tr>
          <td style="padding:14px 16px;text-align:${align};">
            <div style="font-size:12px;color:${EMAIL_COLORS.muted};margin-bottom:4px;">${escapeHtml(label)}</div>
            <div style="font-size:26px;font-weight:700;color:${accent};line-height:1.2;">${value}</div>
          </td>
        </tr>
      </table>
    </td>`;
}

/** The header of a data table. */
function headCell(label: string, align: string): string {
  return `<th style="padding:10px 14px;text-align:${align};font-size:12px;color:${EMAIL_COLORS.muted};font-weight:600;">${escapeHtml(label)}</th>`;
}

/** The document table — five columns, scrollable on a narrow screen. */
function documentTable(report: ExpiryReport, align: string, language: EmailLanguage): string {
  const rows = report.documents
    .map(
      (document) => `
        <tr>
          <td style="padding:12px 14px;border-bottom:1px solid #f1f5f9;text-align:${align};">
            <div style="font-weight:600;color:${EMAIL_COLORS.text};">${escapeHtml(document.title)}</div>
            ${document.fileName ? `<div style="font-size:12px;color:${EMAIL_COLORS.muted};margin-top:2px;">${escapeHtml(document.fileName)}</div>` : ''}
          </td>
          <td style="padding:12px 14px;border-bottom:1px solid #f1f5f9;text-align:${align};font-size:13px;">
            ${escapeHtml(document.documentTypeName || '—')}
            ${subLine(language === 'ar' ? 'الوزارة' : 'Ministry', document.ministryName)}
          </td>
          <td style="padding:12px 14px;border-bottom:1px solid #f1f5f9;text-align:${align};font-size:13px;">${escapeHtml(document.employeeName || document.companyName || '—')}</td>
          <td style="padding:12px 14px;border-bottom:1px solid #f1f5f9;text-align:${align};font-size:13px;white-space:nowrap;">
            ${escapeHtml(formatDate(document.expiryDate))}
            ${subLine(language === 'ar' ? 'تاريخ الإصدار' : 'Issued', formatDate(document.issueDate))}
          </td>
          <td style="padding:12px 14px;border-bottom:1px solid #f1f5f9;text-align:${align};">${badge(document, language)}</td>
        </tr>`,
    )
    .join('');

  return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <table width="100%" cellpadding="0" cellspacing="0" style="min-width:620px;border:1px solid #e2e8f0;border-radius:12px;border-collapse:separate;overflow:hidden;">
        <thead>
          <tr style="background:#f8fafc;">
            ${headCell(COPY.colDocument[language], align)}
            ${headCell(COPY.colType[language], align)}
            ${headCell(COPY.colOwner[language], align)}
            ${headCell(COPY.colExpiry[language], align)}
            ${headCell(COPY.colRemaining[language], align)}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/** The residency table. */
function employeeTable(report: ExpiryReport, align: string, language: EmailLanguage): string {
  const rows = report.employees
    .map(
      (employee) => `
        <tr>
          <td style="padding:12px 14px;border-bottom:1px solid #f1f5f9;text-align:${align};font-weight:600;color:${EMAIL_COLORS.text};">${escapeHtml(employee.name)}</td>
          <td style="padding:12px 14px;border-bottom:1px solid #f1f5f9;text-align:${align};font-size:13px;">${escapeHtml(employee.companyName || '—')}</td>
          <td style="padding:12px 14px;border-bottom:1px solid #f1f5f9;text-align:${align};font-size:13px;white-space:nowrap;">${escapeHtml(formatDate(employee.expiryDate))}</td>
          <td style="padding:12px 14px;border-bottom:1px solid #f1f5f9;text-align:${align};">${badge(employee, language)}</td>
        </tr>`,
    )
    .join('');

  return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <table width="100%" cellpadding="0" cellspacing="0" style="min-width:520px;border:1px solid #e2e8f0;border-radius:12px;border-collapse:separate;overflow:hidden;">
        <thead>
          <tr style="background:#f8fafc;">
            ${headCell(COPY.colEmployee[language], align)}
            ${headCell(COPY.colCompany[language], align)}
            ${headCell(COPY.colExpiry[language], align)}
            ${headCell(COPY.colRemaining[language], align)}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

export function expiryReportHtml(report: ExpiryReport): string {
  const language = report.language;
  const isRtl = language === 'ar';
  const direction = isRtl ? 'rtl' : 'ltr';
  const align = isRtl ? 'right' : 'left';
  const date = report.generatedAt.toISOString().slice(0, 10);
  const total = report.employees.length + report.documents.length;

  const emptyBlock =
    total === 0
      ? `<div style="padding:22px;background:${EMAIL_COLORS.surface};border:1px dashed ${EMAIL_COLORS.border};border-radius:12px;color:${EMAIL_COLORS.muted};text-align:center;font-size:14px;">${escapeHtml(pick(COPY.nothingDue, language))}</div>`
      : '';

  const windowText = isRtl ? arabicDays(report.windowDays) : `${report.windowDays} days`;

  return `<!doctype html>
<html lang="${language}" dir="${direction}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(pick(COPY.title, language))}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Tahoma,'Noto Naskh Arabic',Arial,sans-serif;color:${EMAIL_COLORS.text};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:960px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background-color:${EMAIL_COLORS.primary};background-image:linear-gradient(135deg,${EMAIL_COLORS.primary} 0%,${EMAIL_COLORS.primaryDark} 100%);padding:28px 28px 24px;">
              <h1 style="margin:0 0 6px;font-size:22px;color:#ffffff;font-weight:700;">${escapeHtml(pick(COPY.title, language))}</h1>
              <p style="margin:0;font-size:13px;color:#ccfbf1;">${escapeHtml(pick(COPY.subtitle, language))}</p>
              <p style="margin:14px 0 0;font-size:12px;color:#99f6e4;">
                ${escapeHtml(pick(COPY.generatedOn, language))}: ${escapeHtml(date)}
                &nbsp;·&nbsp;
                ${escapeHtml(pick(COPY.window, language))}: ${escapeHtml(windowText)}
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  ${summaryCell(COPY.documentsTitle[language], report.documents.length, EMAIL_COLORS.primary, align)}
                  ${summaryCell(COPY.employeesTitle[language], report.employees.length, EMAIL_COLORS.accent, align)}
                  ${summaryCell(isRtl ? 'الإجمالي' : 'Total', total, EMAIL_COLORS.primaryDark, align)}
                </tr>
              </table>

              ${emptyBlock}

              ${
                report.documents.length > 0
                  ? `<h2 style="font-size:16px;margin:28px 0 12px;color:${EMAIL_COLORS.text};">${escapeHtml(COPY.documentsTitle[language])} (${report.documents.length})</h2>
                     ${documentTable(report, align, language)}`
                  : ''
              }

              ${
                report.employees.length > 0
                  ? `<h2 style="font-size:16px;margin:28px 0 12px;color:${EMAIL_COLORS.text};">${escapeHtml(COPY.employeesTitle[language])} (${report.employees.length})</h2>
                     ${employeeTable(report, align, language)}`
                  : ''
              }
            </td>
          </tr>

          <tr>
            <td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:${EMAIL_COLORS.muted};">${escapeHtml(COPY.footer[language])}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

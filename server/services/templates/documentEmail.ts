import { EMAIL_COLORS, escapeHtml, type EmailLanguage } from './shared.js';

/**
 * The body used when an administrator emails one or many documents.
 */

export interface DocumentEmailOptions {
  documents: Array<{ title: string; fileName: string | null }>;
  message?: string;
  senderName?: string;
  language?: EmailLanguage;
}

const COPY = {
  heading: { ar: 'مستندات من نظام روماني فلو', en: 'Documents from ROMANI Flow' } as const,
  attached: { ar: 'المرفقات', en: 'Attached documents' } as const,
  footer: { ar: 'تم الإرسال من', en: 'Sent from' } as const,
};

export function documentEmailText(options: DocumentEmailOptions): string {
  const language = options.language ?? 'ar';
  const lines: string[] = [];

  if (options.message?.trim()) {
    lines.push(options.message.trim());
    lines.push('');
  }

  lines.push(language === 'ar' ? COPY.heading.ar : COPY.heading.en);
  lines.push(language === 'ar' ? COPY.attached.ar : COPY.attached.en);
  for (const document of options.documents) {
    lines.push(`- ${document.title}${document.fileName ? ` (${document.fileName})` : ''}`);
  }
  lines.push('');
  lines.push(`${language === 'ar' ? COPY.footer.ar : COPY.footer.en} ${options.senderName ?? 'ROMANI Flow'}`);

  return lines.join('\n');
}

export function documentEmailHtml(options: DocumentEmailOptions): string {
  const language = options.language ?? 'ar';
  const isRtl = language === 'ar';
  const direction = isRtl ? 'rtl' : 'ltr';
  const align = isRtl ? 'right' : 'left';

  const intro = options.message?.trim()
    ? `<p style="margin:0 0 18px;color:${EMAIL_COLORS.text};font-size:14px;line-height:1.7;">${escapeHtml(options.message.trim()).replace(/\n/g, '<br />')}</p>`
    : '';

  const items = options.documents
    .map(
      (document) =>
        `<li style="margin:0 0 8px;font-size:14px;color:#334155;">${escapeHtml(document.title)}${
          document.fileName ? ` <span style="color:${EMAIL_COLORS.muted};font-size:12px;">(${escapeHtml(document.fileName)})</span>` : ''
        }</li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="${language}" dir="${direction}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Tahoma,'Noto Naskh Arabic',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,${EMAIL_COLORS.primary} 0%,${EMAIL_COLORS.primaryDark} 100%);padding:24px 26px;">
              <h1 style="margin:0;font-size:19px;color:#ffffff;font-weight:700;">${escapeHtml(language === 'ar' ? COPY.heading.ar : COPY.heading.en)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 26px;">
              ${intro}
              <h2 style="font-size:14px;margin:0 0 10px;color:${EMAIL_COLORS.muted};font-weight:600;">${escapeHtml(language === 'ar' ? COPY.attached.ar : COPY.attached.en)}</h2>
              <ul style="margin:0 0 18px;padding-${isRtl ? 'right' : 'left'}:20px;">${items}</ul>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 26px;background:#f8fafc;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:${EMAIL_COLORS.muted};text-align:${align};">
                ${escapeHtml(language === 'ar' ? COPY.footer.ar : COPY.footer.en)} ${escapeHtml(options.senderName ?? 'ROMANI Flow')}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

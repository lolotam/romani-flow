import { useEffect, useId, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { request } from '@/lib/api/http';
import { Label } from '@/components/ui/label';

type Language = 'ar' | 'en';
interface Sample { kind: string; subject?: string; text: string }

/** Text-only synthetic preview: no customer records, HTML injection or delivery action. */
export function NotificationTemplate({ channel, language, disabled, onChange }: {
  channel: 'whatsapp' | 'email'; language: Language | null; disabled: boolean;
  onChange: (value: Language) => void;
}) {
  const { user } = useAuth();
  const { language: uiLanguage } = useLanguage();
  const ar = uiLanguage === 'ar';
  const id = useId();
  const key = user?.role === 'admin' && language ? `${user.id}:${channel}:${language}` : '';
  const [preview, setPreview] = useState<{ key: string; samples: Sample[]; failed: boolean } | null>(null);
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    void request<{ samples: Sample[] }>(`/api/whatsapp/template-preview?channel=${channel}&language=${language}`, { signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted) setPreview({ key, samples: result.data?.samples ?? [], failed: Boolean(result.error) });
      });
    return () => controller.abort();
  }, [key, channel, language]);
  const current = key && preview?.key === key ? preview : null;
  return <section className="space-y-3 rounded-md border p-3">
    <Label htmlFor={id}>{ar ? 'لغة الرسالة' : 'Message language'}</Label>
    <select id={id} className="h-10 w-full rounded-md border bg-background px-3" value={language ?? ''}
      disabled={disabled || !key} onChange={event => { if (event.target.value === 'ar' || event.target.value === 'en') onChange(event.target.value); }}>
      {language === null && <option value="">{ar ? 'اللغة غير متاحة' : 'Language unavailable'}</option>}
      <option value="ar">العربية</option><option value="en">English</option>
    </select>
    <p className="text-sm text-muted-foreground">{ar ? 'معاينة القالب ببيانات مثال فقط؛ لن تُرسل رسالة.' : 'Template preview with example data only; no message will be sent.'}</p>
    {key && !current && <p role="status">{ar ? 'جارٍ تحميل المعاينة…' : 'Loading preview…'}</p>}
    {current?.failed && <p role="alert">{ar ? 'تعذّر تحميل المعاينة.' : 'Preview unavailable.'}</p>}
    {!current?.failed && current?.samples.map(sample => <div key={sample.kind} dir={language === 'ar' ? 'rtl' : 'ltr'} className="space-y-1 rounded bg-muted p-3 text-start text-sm">
      <strong>{sample.kind === 'employee' ? (ar ? 'رسالة الموظف' : 'Employee message') : sample.kind === 'company' ? (ar ? 'وثيقة الشركة' : 'Company document') : sample.kind === 'management' ? (ar ? 'رسالة الإدارة' : 'Management message') : (ar ? 'تقرير البريد' : 'Email report')}</strong>
      {sample.subject && <p>{sample.subject}</p>}<p className="whitespace-pre-wrap">{sample.text}</p>
    </div>)}
  </section>;
}

import type { Dispatch, SetStateAction } from 'react';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { REMINDER_INTERVALS, type EmailForm } from '@/hooks/useEmailSettings';
import type { CronStatus, SmtpStatus } from '@/lib/api';
import { NotificationTemplate } from './NotificationTemplate';

interface EmailConfigCardProps {
  form: EmailForm;
  setForm: Dispatch<SetStateAction<EmailForm>>;
  smtp: SmtpStatus | null;
  cron: CronStatus | null;
  busy: 'save' | 'test' | 'report' | null;
  onToggleInterval: (days: number, selected: boolean) => void;
  onSave: () => void;
  onTest: () => void;
  /** False when the reminder cron expression is managed outside this workspace. */
  scheduleEditable?: boolean;
}

const INTERVAL_LABELS: Record<number, { ar: string; en: string }> = {
  90: { ar: 'قبل 3 أشهر', en: '3 months before' },
  30: { ar: 'قبل شهر واحد', en: '1 month before' },
  15: { ar: 'قبل 15 يوماً', en: '15 days before' },
  7: { ar: 'قبل أسبوع واحد', en: '1 week before' },
  1: { ar: 'قبل يوم واحد', en: '1 day before' },
};

export function EmailConfigCard({
  form,
  setForm,
  smtp,
  cron,
  busy,
  onToggleInterval,
  onSave,
  onTest,
  scheduleEditable = true,
}: EmailConfigCardProps) {
  const { language } = useLanguage();
  const L = (ar: string, en: string) => (language === 'ar' ? ar : en);
  const patch = (values: Partial<EmailForm>) => setForm((current) => ({ ...current, ...values }));

  return (
    <Card className="shadow-elegant">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          <span>{L('إعدادات البريد والتنبيهات', 'E-mail and reminder settings')}</span>
        </CardTitle>
        <CardDescription>
          {smtp?.configured
            ? L('SMTP مفعّل.', 'SMTP is configured.')
            : L(
                'SMTP غير مُعدّ. ضع بيانات الإرسال في متغيرات البيئة على الخادم (كلمة المرور لا تُحفظ هنا).',
                'SMTP is not configured. Set the sending credentials in the server environment (the password is never stored here).',
              )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <Label htmlFor="email_enabled">{L('تفعيل التنبيهات بالبريد', 'Enable e-mail reminders')}</Label>
          <Switch id="email_enabled" checked={form.enabled} onCheckedChange={(enabled) => patch({ enabled })} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="email_recipients">{L('المستلمون (افصل بفاصلة)', 'Recipients (comma separated)')}</Label>
            <Input
              id="email_recipients"
              dir="ltr"
              value={form.recipients}
              placeholder="admin@company.com"
              onChange={(event) => patch({ recipients: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="email_cc">{L('نسخة CC', 'CC')}</Label>
            <Input id="email_cc" dir="ltr" value={form.cc} onChange={(event) => patch({ cc: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="email_from_name">{L('اسم المُرسل', 'Sender name')}</Label>
            <Input
              id="email_from_name"
              value={form.fromName}
              onChange={(event) => patch({ fromName: event.target.value })}
            />
          </div>
          <NotificationTemplate channel="email" language={form.language} disabled={busy !== null} onChange={language => patch({ language })} />
        </div>

        <div className="space-y-3 border-t pt-4">
          <h4 className="font-medium">{L('مواعيد التنبيه قبل الانتهاء', 'Reminder thresholds')}</h4>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {REMINDER_INTERVALS.map((days) => (
              <label key={days} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                <Checkbox
                  checked={form.intervals.includes(days)}
                  onCheckedChange={(checked) => onToggleInterval(days, checked === true)}
                />
                <span>{language === 'ar' ? INTERVAL_LABELS[days].ar : INTERVAL_LABELS[days].en}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-4 border-t pt-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="cron_enabled">{L('الإرسال المجدول يومياً', 'Scheduled daily send')}</Label>
            <Switch id="cron_enabled" checked={form.cronEnabled} onCheckedChange={(cronEnabled) => patch({ cronEnabled })} />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="cron_schedule">{L('الجدول (cron بخمسة حقول)', 'Schedule (five-field cron)')}</Label>
              <Input
                id="cron_schedule"
                dir="ltr"
                value={form.cronSchedule}
                disabled={!scheduleEditable}
                onChange={(event) => patch({ cronSchedule: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cron_days">{L('نافذة التقرير (أيام)', 'Report window (days)')}</Label>
              <Input
                id="cron_days"
                type="number"
                min={1}
                max={365}
                value={form.cronDays}
                onChange={(event) => patch({ cronDays: Number(event.target.value) || 30 })}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.includeEmployees}
                onCheckedChange={(checked) => patch({ includeEmployees: checked === true })}
              />
              {L('تضمين إقامات الموظفين', 'Include employee residencies')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.includeDocuments}
                onCheckedChange={(checked) => patch({ includeDocuments: checked === true })}
              />
              {L('تضمين المستندات', 'Include documents')}
            </label>
          </div>
          {cron && (
            <p className="text-xs text-muted-foreground">
              {L('آخر تشغيل', 'Last run')}: {cron.lastRunAt || '-'} ({cron.lastRunResult || '-'}) ·{' '}
              {L('التشغيل القادم', 'Next run')}: {cron.nextRun ?? '-'}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <Button onClick={onSave} disabled={busy !== null} className="flex-1">
            {L('حفظ الإعدادات', 'Save settings')}
          </Button>
          <Button onClick={onTest} disabled={busy !== null || !smtp?.configured} variant="outline" className="flex-1">
            {busy === 'test' ? L('جارٍ الإرسال...', 'Sending...') : L('إرسال رسالة تجربة', 'Send a test message')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

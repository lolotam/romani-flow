import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useEmailSettings, type ActionResult } from '@/hooks/useEmailSettings';
import { SmtpConfigCard } from './SmtpConfigCard';
import { MemberSmtpCard } from './MemberSmtpCard';
import { NotificationSenderCard } from './NotificationSenderCard';
import { EmailConfigCard } from './EmailConfigCard';
import { EmailLogCard } from './EmailLogCard';
import { ExpiryPreviewCard } from './ExpiryPreviewCard';
import { Button } from '@/components/ui/button';

/**
 * The e-mail tab. All state is on the server; this component wires the
 * hook to the cards and tells the user how each action went.
 */
export default function EmailSettings() {
  const { language } = useLanguage();
  const { toast } = useToast();
  const { scheduleEditable } = useAuth();
  const state = useEmailSettings();
  const L = (ar: string, en: string) => (language === 'ar' ? ar : en);

  const report = (result: ActionResult, successTitle: string, failureTitle: string) => {
    toast(
      result.ok
        ? { title: successTitle }
        : { title: failureTitle, description: result.message, variant: 'destructive' },
    );
  };

  if (state.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">{L('جارٍ التحميل...', 'Loading...')}</p>;
  }
  if (!state.settingsReady) {
    return <div role="alert" className="space-y-3 p-6">
      <p>{L('تعذّر تحميل إعدادات البريد. أعد المحاولة قبل التعديل أو الإرسال.', 'Email settings could not be loaded. Retry before editing or sending.')}</p>
      <Button type="button" onClick={() => void state.reloadSettings()}>{L('إعادة المحاولة', 'Retry')}</Button>
    </div>;
  }

  return (
    <div className="space-y-6">
      <SmtpConfigCard
        details={state.smtpDetails}
        form={state.smtpForm}
        setForm={state.setSmtpForm}
        busy={state.busy}
        onSave={async (payload) => {
          const res = await state.saveSmtp(payload);
          report(
            res,
            L('تم حفظ وتفعيل إعدادات SMTP بنجاح', 'SMTP settings saved and verified'),
            L('تعذر حفظ إعدادات SMTP', 'Could not save SMTP settings'),
          );
        }}
        onDelete={async () => {
          const res = await state.deleteSmtp();
          report(
            res,
            L('تمت إزالة إعدادات SMTP المخصصة', 'Custom SMTP removed'),
            L('تعذر حذف إعدادات SMTP', 'Could not delete SMTP settings'),
          );
        }}
        onTest={async () => {
          const res = await state.sendTest();
          report(
            res,
            L('تم إرسال رسالة التجربة بنجاح', 'Test message sent successfully'),
            L('تعذر إرسال التجربة', 'The test could not be sent'),
          );
        }}
      />
      <MemberSmtpCard />
      <NotificationSenderCard />
      <EmailConfigCard
        form={state.form}
        setForm={state.setForm}
        smtp={state.smtp}
        cron={state.cron}
        busy={state.busy}
        onToggleInterval={state.toggleInterval}
        scheduleEditable={scheduleEditable}
        onSave={async () =>
          report(await state.save(), L('تم حفظ الإعدادات', 'Settings saved'), L('تعذر حفظ الإعدادات', 'Settings were not saved'))
        }
        onTest={async () =>
          report(await state.sendTest(), L('تم إرسال رسالة التجربة', 'Test message sent'), L('تعذر إرسال التجربة', 'The test could not be sent'))
        }
      />
      <ExpiryPreviewCard
        preview={state.preview}
        canSend={Boolean(state.smtp?.configured) && state.form.enabled}
        isSending={state.busy === 'report'}
        onRefresh={() => void state.refresh()}
        onSend={async () =>
          report(await state.sendReport(), L('تم إرسال التقرير', 'Report sent'), L('تعذر إرسال التقرير', 'The report could not be sent'))
        }
      />
      <EmailLogCard entries={state.log} />
    </div>
  );
}

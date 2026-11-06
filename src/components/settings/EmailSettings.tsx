import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { useEmailSettings, type ActionResult } from '@/hooks/useEmailSettings';
import { EmailConfigCard } from './EmailConfigCard';
import { EmailLogCard } from './EmailLogCard';
import { ExpiryPreviewCard } from './ExpiryPreviewCard';
import { Button } from '@/components/ui/button';

/**
 * The e-mail tab. All state is on the server; this component only wires the
 * hook to the three cards and tells the user how each action went.
 */
export default function EmailSettings() {
  const { language } = useLanguage();
  const { toast } = useToast();
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
      <EmailConfigCard
        form={state.form}
        setForm={state.setForm}
        smtp={state.smtp}
        cron={state.cron}
        busy={state.busy}
        onToggleInterval={state.toggleInterval}
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

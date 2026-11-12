import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWhatsAppSettings } from '@/hooks/useWhatsAppSettings';
import { WhatsAppRecipientsCard } from './WhatsAppRecipientsCard';
import { WhatsAppLogCard } from './WhatsAppLogCard';
import { NotificationTemplate } from './NotificationTemplate';
import { isOwner } from '@/lib/permissions';

export default function WhatsAppSettings({ refreshKey = 0 }: { refreshKey?: number }) {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();
  const state = useWhatsAppSettings(refreshKey);
  if (!isOwner(user?.role)) return null;
  return <div dir={isRTL ? 'rtl' : 'ltr'} className="space-y-5 text-start">
    <Card aria-busy={state.loading}><CardHeader><CardTitle>{t('settings.whatsappReminders.title')}</CardTitle></CardHeader><CardContent className="space-y-3">
      {state.loading && <p role="status">{t('settings.whatsappReminders.loading')}</p>}
      <div hidden={state.loading}><div className="flex items-center gap-3"><Switch id="wa-global-enabled" disabled={state.busy || state.loading || state.enabled === null} checked={state.enabled === true} onCheckedChange={value => void state.setEnabled(value)} /><Label htmlFor="wa-global-enabled">{t('settings.whatsappReminders.enabled')}</Label></div></div>
      {!state.loading && state.enabled === null && <p role="status">{t('settings.whatsappReminders.enabledUnknown')}</p>}
      <p className="text-sm text-muted-foreground">{t('settings.whatsappReminders.scheduleHelp')}</p>
      <Button type="button" variant="outline" disabled={state.busy || state.loading} onClick={state.reload}>{t('settings.whatsappReminders.refresh')}</Button>
      {state.busy && <p role="status">{t('settings.whatsappReminders.saving')}</p>}
      {state.error && <p role="alert" className="text-destructive">{t(`settings.whatsappReminders.${state.error}`)}</p>}
      <NotificationTemplate channel="whatsapp" language={state.language} disabled={state.busy || state.loading} onChange={value => void state.setLanguage(value)} />
    </CardContent></Card>
    <div hidden={state.loading} className="space-y-5">
      <WhatsAppRecipientsCard state={state} />
      <WhatsAppLogCard state={state} />
    </div>
  </div>;
}

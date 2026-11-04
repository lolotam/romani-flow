import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWhatsAppSettings } from '@/hooks/useWhatsAppSettings';
import { WhatsAppRecipientsCard } from './WhatsAppRecipientsCard';
import { WhatsAppLogCard } from './WhatsAppLogCard';

export default function WhatsAppSettings() {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();
  const state = useWhatsAppSettings();
  if (user?.role !== 'admin') return null;
  return <div dir={isRTL ? 'rtl' : 'ltr'} className="space-y-5 text-start">
    <Card><CardHeader><CardTitle>{t('settings.whatsappReminders.title')}</CardTitle></CardHeader><CardContent className="space-y-3">
      <div className="flex items-center gap-3"><Switch id="wa-global-enabled" disabled={state.busy || state.loading} checked={state.enabled} onCheckedChange={value => void state.setEnabled(value)} /><Label htmlFor="wa-global-enabled">{t('settings.whatsappReminders.enabled')}</Label></div>
      <p className="text-sm text-muted-foreground">{t('settings.whatsappReminders.scheduleHelp')}</p>
      <Button type="button" variant="outline" disabled={state.busy} onClick={state.reload}>{t('settings.whatsappReminders.refresh')}</Button>
      {state.busy && <p role="status">{t('settings.whatsappReminders.saving')}</p>}
      {state.error && <p role="alert" className="text-destructive">{t(`settings.whatsappReminders.${state.error}`)}</p>}
    </CardContent></Card>
    <WhatsAppRecipientsCard state={state} />
    <WhatsAppLogCard state={state} />
  </div>;
}

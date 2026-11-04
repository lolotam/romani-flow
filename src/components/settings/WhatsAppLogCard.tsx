import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { whatsappReminders } from '@/lib/api/whatsapp';
import type { useWhatsAppSettings } from '@/hooks/useWhatsAppSettings';
import { whatsappFailureKey } from '@/lib/whatsappFailureReason';

export function WhatsAppLogCard({ state }: { state: ReturnType<typeof useWhatsAppSettings> }) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState({ state: '', recipient: '', item: '' });
  const offset = state.filter.offset ?? 0;
  return <Card><CardHeader><CardTitle>{t('settings.whatsappReminders.log')}</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">{t('settings.whatsappReminders.deliveryLimit')}</p>
    <form className="grid gap-3 sm:grid-cols-3" onSubmit={e => { e.preventDefault(); state.setFilter({ ...filter, offset: 0 }); }}>
      <div><Label htmlFor="wa-log-state">{t('settings.whatsappReminders.state')}</Label><select id="wa-log-state" className="h-10 w-full rounded-md border bg-background px-3" value={filter.state} onChange={e => setFilter({ ...filter, state: e.target.value })}>
        <option value="">{t('settings.whatsappReminders.all')}</option>{['pending', 'sending', 'provider_accepted', 'retryable_failed', 'permanent_failed', 'unknown', 'cancelled'].map(value => <option key={value} value={value}>{t(`settings.whatsappReminders.states.${value}`)}</option>)}
      </select></div>
      <div><Label htmlFor="wa-log-recipient">{t('settings.whatsappReminders.phone')}</Label><Input id="wa-log-recipient" dir="ltr" value={filter.recipient} onChange={e => setFilter({ ...filter, recipient: e.target.value })} /></div>
      <div><Label htmlFor="wa-log-item">{t('settings.whatsappReminders.item')}</Label><Input id="wa-log-item" value={filter.item} onChange={e => setFilter({ ...filter, item: e.target.value })} /></div>
      <Button type="submit" variant="outline">{t('settings.whatsappReminders.filter')}</Button>
    </form>
    {state.log.length === 0 && <p>{t('settings.whatsappReminders.noLog')}</p>}
    {state.log.map(job => <article key={job.id} className="space-y-2 border-t pt-3">
      <p className="font-medium">{job.item_name} — {job.owner_name}</p>
      <p>{job.recipient_label} <bdi dir="ltr">{job.recipient}</bdi></p>
      <p>{t('settings.whatsappReminders.expiry')}: <bdi dir="ltr">{job.expiry_date.split('-').reverse().join('/')}</bdi></p>
      <p>{t(`settings.whatsappReminders.states.${job.state}`)} · {t('settings.whatsappReminders.attempts')}: {job.attempt_count}</p>
      {job.error_code && <p className="text-sm">{t('settings.whatsappReminders.failureReason')}: {t(`settings.whatsappReminders.errors.${whatsappFailureKey(job.error_code)}`)}</p>}
      {job.state === 'unknown' && <p className="text-sm">{t('settings.whatsappReminders.unknownHelp')}</p>}
      {job.attempts.length ? job.attempts.map(attempt => <details key={attempt.id} className="rounded-md bg-muted/30 p-2">
        <summary>{new Date(attempt.started_at).toLocaleString()} · {t(`settings.whatsappReminders.states.${attempt.state}`)}</summary>
        <p>{attempt.recipient_label} <bdi dir="ltr">{attempt.recipient}</bdi></p>
        {attempt.error_code && <p className="text-sm">{t('settings.whatsappReminders.failureReason')}: {t(`settings.whatsappReminders.errors.${whatsappFailureKey(attempt.error_code)}`)}</p>}
        <p className="whitespace-pre-wrap break-words pt-2">{attempt.text}</p>
      </details>) : <p className="whitespace-pre-wrap text-sm text-muted-foreground">{job.text}</p>}
      {job.retry_allowed && <Button type="button" disabled={state.busy} variant="outline" onClick={() => void state.act(() => whatsappReminders.retry(job.id))}>{t('settings.whatsappReminders.retry')}</Button>}
    </article>)}
    <div className="flex items-center gap-3"><Button type="button" variant="outline" disabled={offset === 0} onClick={() => state.setFilter({ ...state.filter, offset: Math.max(0, offset - 20) })}>{t('settings.whatsappReminders.previous')}</Button><span>{state.logTotal}</span><Button type="button" variant="outline" disabled={offset + 20 >= state.logTotal} onClick={() => state.setFilter({ ...state.filter, offset: offset + 20 })}>{t('settings.whatsappReminders.next')}</Button></div>
  </CardContent></Card>;
}

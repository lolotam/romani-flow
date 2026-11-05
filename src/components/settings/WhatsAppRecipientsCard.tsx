import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { whatsappReminders, type WhatsAppRecipient } from '@/lib/api/whatsapp';
import type { useWhatsAppSettings } from '@/hooks/useWhatsAppSettings';

export function WhatsAppRecipientsCard({ state }: { state: ReturnType<typeof useWhatsAppSettings> }) {
  const { t } = useLanguage();
  const empty = { label: '', phone: '', enabled: false };
  const [form, setForm] = useState<Omit<WhatsAppRecipient, 'id'>>(empty), [editId, setEditId] = useState<string>();
  const reset = () => { setForm(empty); setEditId(undefined); };
  return <Card><CardHeader><CardTitle>{t('settings.whatsappReminders.recipients')}</CardTitle></CardHeader><CardContent className="space-y-4">
    {!state.recipientsAvailable && <p role="status">{t('settings.whatsappReminders.recipientsUnavailable')}</p>}
    <div hidden={!state.recipientsAvailable} className="space-y-4">
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={async event => {
      event.preventDefault();
      if (await state.act(() => whatsappReminders.saveRecipient(form, editId))) reset();
    }}>
      <div className="space-y-1"><Label htmlFor="wa-label">{t('settings.whatsappReminders.label')}</Label><Input id="wa-label" required maxLength={100} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="wa-phone">{t('settings.whatsappReminders.phone')}</Label><Input id="wa-phone" required dir="ltr" inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /><p className="text-sm text-muted-foreground">{t('settings.whatsappReminders.phoneHelp')}</p></div>
      <div className="flex items-center gap-2"><Switch id="wa-recipient-enabled" checked={form.enabled} onCheckedChange={enabled => setForm({ ...form, enabled })} /><Label htmlFor="wa-recipient-enabled">{t('settings.whatsappReminders.recipientEnabled')}</Label></div>
      <div className="flex gap-2"><Button disabled={state.busy} type="submit">{t(editId ? 'settings.whatsappReminders.save' : 'settings.whatsappReminders.add')}</Button>{editId && <Button type="button" variant="outline" onClick={reset}>{t('settings.whatsappReminders.cancel')}</Button>}</div>
    </form>
    {state.recipients.length === 0 && <p>{t('settings.whatsappReminders.noRecipients')}</p>}
    {state.recipients.map(person => <div key={person.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
      <div><p>{person.label}</p><p dir="ltr" className="text-sm">{person.phone}</p></div>
      <div className="flex items-center gap-2"><Switch aria-label={`${t('settings.whatsappReminders.recipientEnabled')} ${person.label}`} disabled={state.busy} checked={person.enabled} onCheckedChange={value => void state.act(() => whatsappReminders.toggleRecipient(person.id, value))} />
        <Button type="button" variant="outline" disabled={state.busy} onClick={() => { setEditId(person.id); setForm({ label: person.label, phone: person.phone, enabled: person.enabled }); }}>{t('settings.whatsappReminders.edit')}</Button>
        <Button type="button" variant="outline" disabled={state.busy} onClick={() => { if (window.confirm(t('settings.whatsappReminders.removeConfirm'))) void state.act(() => whatsappReminders.removeRecipient(person.id)); }}>{t('settings.whatsappReminders.remove')}</Button>
      </div>
    </div>)}
    <div className="flex items-center gap-3"><Button type="button" variant="outline" disabled={state.recipientOffset === 0} onClick={() => state.setRecipientOffset(Math.max(0, state.recipientOffset - 20))}>{t('settings.whatsappReminders.previous')}</Button><span>{state.recipientTotal}</span><Button type="button" variant="outline" disabled={state.recipientOffset + 20 >= state.recipientTotal} onClick={() => state.setRecipientOffset(state.recipientOffset + 20)}>{t('settings.whatsappReminders.next')}</Button></div>
    </div>
  </CardContent></Card>;
}

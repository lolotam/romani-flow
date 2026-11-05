import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { whatsappPairing, type WhatsAppPairingStatus } from '@/lib/api/whatsapp';
import { CheckCircle2, LogOut, QrCode, RefreshCw } from 'lucide-react';

/** Transient QR only. Never stores credentials, QR codes, chats or session data. */
export default function WhatsAppPairingSettings({ onDisconnectSettled }: { onDisconnectSettled?: () => void }) {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();
  const [status, setStatus] = useState<WhatsAppPairingStatus | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [expired, setExpired] = useState(false);
  const mounted = useRef(false);
  const operation = useRef(0);
  const expiresAt = useRef(0);
  const requestBusy = useRef(false);

  const loadConnection = useCallback(async (action: 'status' | 'connect' | 'disconnect') => {
    if (user?.role !== 'admin' || requestBusy.current) return;
    requestBusy.current = true;
    const id = ++operation.current;
    setBusy(true);
    setError(false);
    if (action !== 'status') { setQr(null); setExpired(false); }
    if (action === 'disconnect') setStatus(null);
    try {
      const result = action === 'connect' ? await whatsappPairing.connect() : action === 'disconnect' ? await whatsappPairing.disconnect() : await whatsappPairing.status();
      if (!mounted.current || id !== operation.current) return;
      if (result.error || !result.data) { setError(true); setQr(null); setStatus(null); return; }
      setStatus({ configured: result.data.configured, state: result.data.state });
      if (result.data.state === 'connected' || !result.data.configured) { setQr(null); setExpired(false); }
      if ('qr' in result.data && typeof result.data.qr === 'string') {
        if (document.hidden) { setQr(null); setExpired(true); return; }
        expiresAt.current = Date.now() + 60_000;
        setQr(result.data.qr);
      }
    } catch {
      if (mounted.current && id === operation.current) { setError(true); setQr(null); setStatus(null); }
    } finally {
      if (id === operation.current) requestBusy.current = false;
      if (mounted.current && id === operation.current) {
        setBusy(false);
        if (action === 'disconnect') onDisconnectSettled?.();
      }
    }
  }, [user?.role, user?.id, onDisconnectSettled]);

  useEffect(() => {
    mounted.current = true;
    void loadConnection('status');
    return () => { mounted.current = false; operation.current += 1; requestBusy.current = false; setQr(null); setStatus(null); };
  }, [loadConnection]);

  useEffect(() => {
    if (!qr) return;
    const clear = () => { setQr(null); setExpired(true); };
    const onVisibility = () => { if (document.hidden) clear(); };
    const timer = window.setTimeout(clear, Math.max(0, expiresAt.current - Date.now()));
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [qr]);

  useEffect(() => {
    if (user?.role !== 'admin' || (!qr && status?.state !== 'connecting')) return;
    const until = Date.now() + 180_000;
    const check = () => {
      if (!document.hidden && Date.now() < until) void loadConnection('status');
    };
    const timer = window.setInterval(check, 3000);
    const stop = window.setTimeout(() => window.clearInterval(timer), 180_000);
    document.addEventListener('visibilitychange', check);
    return () => { window.clearInterval(timer); window.clearTimeout(stop); document.removeEventListener('visibilitychange', check); };
  }, [qr, status?.state, loadConnection, user?.role]);

  if (user?.role !== 'admin') return null;
  const stateText = {
    unconfigured: t('settings.whatsapp.unconfigured'),
    disconnected: t('settings.whatsapp.disconnected'),
    connecting: t('settings.whatsapp.connecting'),
    connected: t('settings.whatsapp.connected'),
    unknown: t('settings.whatsapp.unavailable'),
  };

  return (
    <Card dir={isRTL ? 'rtl' : 'ltr'} className="text-start">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><QrCode aria-hidden="true" className="h-5 w-5" />{t('settings.whatsapp.title')}</CardTitle>
        <CardDescription>{t('settings.whatsapp.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p role="status" aria-live="polite" className={status?.state === 'connected' && !error ? 'flex items-center gap-2 font-semibold text-green-700 dark:text-green-400' : undefined}>
          {status?.state === 'connected' && !error && <CheckCircle2 aria-hidden="true" className="h-5 w-5" />}
          {error ? t('settings.whatsapp.unavailable') : status?.state === 'connected' ? stateText.connected : busy ? t('settings.whatsapp.loading') : status ? stateText[status.state] : ''}
        </p>
        {error && <p role="alert" className="text-destructive">{t('settings.whatsapp.error')}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} variant="outline" onClick={() => void loadConnection('status')}>
            <RefreshCw aria-hidden="true" className="h-4 w-4 me-2" />{t('settings.whatsapp.refresh')}
          </Button>
          <Button type="button" className={status?.state === 'connected' ? 'bg-green-700 text-white disabled:opacity-100' : undefined} disabled={busy || !status?.configured || status.state === 'connected' || status.state === 'unknown'} onClick={() => void loadConnection('connect')}>
            {status?.state === 'connected' ? <><CheckCircle2 aria-hidden="true" className="h-4 w-4 me-2" />{t('settings.whatsapp.connected')}</> : busy ? t('settings.whatsapp.loading') : t('settings.whatsapp.showQr')}
          </Button>
          {status?.configured && status.state !== 'disconnected' && <Button type="button" variant="destructive" disabled={busy || status.state === 'unknown'} onClick={() => {
            if (window.confirm(t('settings.whatsapp.disconnectConfirm'))) void loadConnection('disconnect');
          }}><LogOut aria-hidden="true" className="h-4 w-4 me-2" />{t('settings.whatsapp.disconnect')}</Button>}
          {qr && <Button type="button" variant="outline" onClick={() => setQr(null)}>{t('settings.whatsapp.hideQr')}</Button>}
        </div>
        {qr && <div className="space-y-2">
          <img src={qr} alt={t('settings.whatsapp.qrAlt')} width={256} height={256} className="max-w-full bg-white p-2" />
          <p className="text-sm">{t('settings.whatsapp.scan')}</p>
          <p className="text-sm text-muted-foreground">{t('settings.whatsapp.expiry')}</p>
        </div>}
        {!qr && expired && <p>{t('settings.whatsapp.expired')}</p>}
        <p className="text-sm text-muted-foreground">{t('settings.whatsapp.privacy')}</p>
        <p className="text-sm text-muted-foreground">{t('settings.whatsapp.scope')}</p>
      </CardContent>
    </Card>
  );
}

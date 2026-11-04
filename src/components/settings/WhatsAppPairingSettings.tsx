import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { whatsappPairing, type WhatsAppPairingStatus } from '@/lib/api/whatsapp';
import { QrCode, RefreshCw } from 'lucide-react';

/** Transient QR only. Never stores credentials, QR codes, chats or session data. */
export default function WhatsAppPairingSettings() {
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

  const loadConnection = useCallback(async (action: 'status' | 'connect') => {
    if (user?.role !== 'admin') return;
    const id = ++operation.current;
    setBusy(true);
    setError(false);
    if (action === 'connect') { setQr(null); setExpired(false); }
    try {
      const result = action === 'connect' ? await whatsappPairing.connect() : await whatsappPairing.status();
      if (!mounted.current || id !== operation.current) return;
      if (result.error || !result.data) { setError(true); setQr(null); return; }
      setStatus(result.data);
      if (result.data.state === 'connected' || !result.data.configured) { setQr(null); setExpired(false); }
      if ('qr' in result.data && typeof result.data.qr === 'string') {
        if (document.hidden) { setQr(null); setExpired(true); return; }
        expiresAt.current = Date.now() + 60_000;
        setQr(result.data.qr);
      }
    } catch {
      if (mounted.current && id === operation.current) { setError(true); setQr(null); }
    } finally {
      if (mounted.current && id === operation.current) setBusy(false);
    }
  }, [user?.role]);

  useEffect(() => {
    mounted.current = true;
    void loadConnection('status');
    return () => { mounted.current = false; };
  }, [loadConnection]);

  useEffect(() => {
    if (!qr) return;
    const clear = () => { setQr(null); setExpired(true); };
    const onVisibility = () => { if (document.hidden) clear(); };
    const timer = window.setTimeout(clear, Math.max(0, expiresAt.current - Date.now()));
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [qr]);

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
        <p role="status" aria-live="polite">
          {busy ? t('settings.whatsapp.loading') : error ? t('settings.whatsapp.unavailable') : status ? stateText[status.state] : ''}
        </p>
        {error && <p role="alert" className="text-destructive">{t('settings.whatsapp.error')}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} variant="outline" onClick={() => void loadConnection('status')}>
            <RefreshCw aria-hidden="true" className="h-4 w-4 me-2" />{t('settings.whatsapp.refresh')}
          </Button>
          <Button type="button" disabled={busy || !status?.configured || status.state === 'connected' || status.state === 'unknown'} onClick={() => void loadConnection('connect')}>
            {busy ? t('settings.whatsapp.loading') : t('settings.whatsapp.showQr')}
          </Button>
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

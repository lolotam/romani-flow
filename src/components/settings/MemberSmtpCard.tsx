import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, RefreshCw, Send, Server, Trash2, UserCog } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { memberSmtp, type MemberSmtpDetails } from '@/lib/api/memberSmtp';
import { smtpGuidance } from './smtpGuidance';

interface MemberSmtpForm {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  senderAddress: string;
  senderName: string;
}

const EMPTY_FORM: MemberSmtpForm = {
  host: '',
  port: 587,
  secure: false,
  username: '',
  password: '',
  senderAddress: '',
  senderName: '',
};

/** The failure codes the server records for a test, with the copy that fits. */
const TEST_ERROR_KEYS: Record<string, string> = {
  smtp_not_configured: 'settings.memberSmtp.testErrors.smtp_not_configured',
  smtp_auth_failed: 'settings.memberSmtp.testErrors.smtp_auth_failed',
  smtp_tls_required: 'settings.memberSmtp.testErrors.smtp_tls_required',
  smtp_connection_failed: 'settings.memberSmtp.testErrors.smtp_connection_failed',
  smtp_sender_rejected: 'settings.memberSmtp.testErrors.smtp_sender_rejected',
  smtp_from_invalid: 'settings.memberSmtp.testErrors.smtp_from_invalid',
  encryption_not_configured: 'settings.memberSmtp.testErrors.encryption_not_configured',
  credential_authentication_failed: 'settings.memberSmtp.testErrors.credential_authentication_failed',
  no_recipients: 'settings.memberSmtp.testErrors.no_recipients',
  send_failed: 'settings.memberSmtp.testErrors.send_failed',
};

function formOf(details: MemberSmtpDetails | null): MemberSmtpForm {
  if (!details) return EMPTY_FORM;
  return {
    host: details.host ?? '',
    port: details.port ?? 587,
    secure: details.secure === true,
    username: details.username ?? '',
    password: '',
    senderAddress: details.senderAddress ?? '',
    senderName: details.senderName ?? '',
  };
}

/**
 * The relay of the signed-in account.
 *
 * The card never shows a stored password: the server only reports whether one
 * exists, and an empty password field keeps the stored one.
 */
export function MemberSmtpCard() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [details, setDetails] = useState<MemberSmtpDetails | null>(null);
  const [form, setForm] = useState<MemberSmtpForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'delete' | 'test' | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await memberSmtp.read();
    setLoading(false);
    if (error || !data) {
      // The message of the server is shown as it is; the card falls back to
      // its own copy when the server sent none.
      setLoadError(error?.message ?? '');
      return;
    }
    setLoadError(null);
    setDetails(data);
    setForm(formOf(data));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (values: Partial<MemberSmtpForm>) => setForm((current) => ({ ...current, ...values }));

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('save');
    const { data, error } = await memberSmtp.save({
      host: form.host.trim(),
      port: Number(form.port) || 587,
      secure: form.secure,
      username: form.username.trim(),
      // An empty field keeps the stored password, which is never sent back.
      ...(form.password ? { password: form.password } : {}),
      sender_address: form.senderAddress.trim(),
      ...(form.senderName.trim() ? { sender_name: form.senderName.trim() } : {}),
    });
    setBusy(null);
    if (error || !data) {
      toast({
        title: t('settings.memberSmtp.saveFailedTitle'),
        description: error?.message ?? '',
        variant: 'destructive',
      });
      return;
    }
    setDetails(data);
    setForm((current) => ({ ...current, password: '' }));
    toast({ title: t('settings.memberSmtp.saveSuccessTitle') });
  };

  const handleDelete = async () => {
    if (!window.confirm(t('settings.memberSmtp.deleteConfirm'))) return;
    setBusy('delete');
    const { error } = await memberSmtp.remove();
    setBusy(null);
    if (error) {
      toast({
        title: t('settings.memberSmtp.deleteFailedTitle'),
        description: error.message,
        variant: 'destructive',
      });
      return;
    }
    await load();
    toast({ title: t('settings.memberSmtp.deleteSuccessTitle') });
  };

  const handleTest = async () => {
    setBusy('test');
    const { data, error } = await memberSmtp.test();
    // The server records the outcome of the test, so the card reads it again.
    const { data: fresh } = await memberSmtp.read();
    setBusy(null);
    if (fresh) setDetails(fresh);
    if (error || !data?.sent) {
      toast({
        title: t('settings.memberSmtp.testFailedTitle'),
        description: error?.message ?? '',
        variant: 'destructive',
      });
      return;
    }
    toast({ title: t('settings.memberSmtp.testSuccessTitle'), description: t('settings.memberSmtp.testNote') });
  };

  const guidance = smtpGuidance(t);
  const isBusy = busy !== null;
  const lastTestCode = details?.lastTestErrorCode ?? null;
  const lastTestText = lastTestCode
    ? (TEST_ERROR_KEYS[lastTestCode]
      ? t(TEST_ERROR_KEYS[lastTestCode])
      : t('settings.memberSmtp.testErrorUnknown', { code: lastTestCode }))
    : '';

  return (
    <Card className="shadow-elegant">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            <span>{t('settings.memberSmtp.title')}</span>
          </CardTitle>
          <div>
            {details?.configured ? (
              <Badge variant="outline" className="border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                <CheckCircle2 className="me-1 h-3.5 w-3.5 text-emerald-600" />
                {t('settings.memberSmtp.activeBadge')}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                <Server className="me-1 h-3.5 w-3.5 text-blue-600" />
                {t('settings.memberSmtp.fallbackBadge')}
              </Badge>
            )}
          </div>
        </div>
        <CardDescription>{t('settings.memberSmtp.description')}</CardDescription>
      </CardHeader>

      <CardContent>
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">{t('settings.memberSmtp.loading')}</p>
        ) : loadError ? (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-destructive">{loadError || t('settings.memberSmtp.loadFailed')}</p>
            <Button type="button" variant="outline" onClick={() => void load()}>
              {t('settings.memberSmtp.retry')}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            {!details?.configured && (
              <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
                {t('settings.memberSmtp.notConfiguredNote')}
              </p>
            )}

            {details?.configured && (
              <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
                <p dir="ltr" className="font-medium">
                  {details.host}:{details.port}
                </p>
                <p dir="ltr">{details.username}</p>
                <p dir="ltr">{details.senderAddress}</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="member_smtp_host">{t('settings.memberSmtp.hostLabel')}</Label>
                <Input
                  id="member_smtp_host"
                  dir="ltr"
                  required
                  placeholder="smtp.gmail.com"
                  value={form.host}
                  onChange={(event) => patch({ host: event.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="member_smtp_port">{t('settings.memberSmtp.portLabel')}</Label>
                <Input
                  id="member_smtp_port"
                  type="number"
                  dir="ltr"
                  min={1}
                  max={65535}
                  required
                  placeholder="587"
                  value={form.port}
                  onChange={(event) => patch({ port: parseInt(event.target.value, 10) || 587 })}
                />
              </div>

              <div>
                <Label htmlFor="member_smtp_user">{t('settings.memberSmtp.usernameLabel')}</Label>
                <Input
                  id="member_smtp_user"
                  dir="ltr"
                  required
                  placeholder="your-email@gmail.com"
                  value={form.username}
                  onChange={(event) => patch({ username: event.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="member_smtp_pass">{t('settings.memberSmtp.passwordLabel')}</Label>
                <div className="relative">
                  <Input
                    id="member_smtp_pass"
                    type={showPassword ? 'text' : 'password'}
                    dir="ltr"
                    placeholder={details?.hasPassword ? '••••••••••••••••' : ''}
                    value={form.password}
                    onChange={(event) => patch({ password: event.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute inset-y-0 end-0 flex items-center pe-3 text-muted-foreground hover:text-foreground"
                    aria-label={t('settings.memberSmtp.togglePassword')}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {details?.hasPassword
                    ? t('settings.memberSmtp.passwordStored')
                    : t('settings.memberSmtp.passwordRequired')}
                </p>
              </div>

              <div>
                <Label htmlFor="member_smtp_from">{t('settings.memberSmtp.senderAddressLabel')}</Label>
                <Input
                  id="member_smtp_from"
                  dir="ltr"
                  type="email"
                  required
                  placeholder="notifications@company.com"
                  value={form.senderAddress}
                  onChange={(event) => patch({ senderAddress: event.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="member_smtp_from_name">{t('settings.memberSmtp.senderNameLabel')}</Label>
                <Input
                  id="member_smtp_from_name"
                  placeholder="ROMANI Flow"
                  value={form.senderName}
                  onChange={(event) => patch({ senderName: event.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="member_smtp_secure">{t('settings.memberSmtp.secureLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.memberSmtp.secureHelp')}</p>
              </div>
              <Switch
                id="member_smtp_secure"
                checked={form.secure}
                onCheckedChange={(secure) => patch({ secure })}
              />
            </div>

            {details?.lastTestStatus && (
              <p
                role="status"
                className={`flex items-center gap-2 text-xs ${
                  details.lastTestStatus === 'succeeded' ? 'text-emerald-600' : 'text-destructive'
                }`}
              >
                {details.lastTestStatus === 'succeeded' ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" />
                )}
                {details.lastTestStatus === 'succeeded'
                  ? t('settings.memberSmtp.lastTestSucceeded', { date: details.lastTestedAt ?? '-' })
                  : t('settings.memberSmtp.lastTestFailed')}
                {lastTestText ? ` — ${lastTestText}` : ''}
              </p>
            )}

            <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium">{guidance.title}</p>
              <ul className="space-y-1">
                {guidance.lines.map((line) => (
                  <li key={line}>• {line}</li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="submit" disabled={isBusy} className="flex-1 min-w-[140px]">
                {busy === 'save' ? (
                  <>
                    <RefreshCw className="me-2 h-4 w-4 animate-spin" />
                    {t('settings.memberSmtp.saving')}
                  </>
                ) : (
                  t('settings.memberSmtp.saveButton')
                )}
              </Button>

              {details?.configured && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => void handleDelete()}
                  className="text-destructive hover:bg-destructive/10"
                >
                  {busy === 'delete' ? (
                    <RefreshCw className="me-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="me-2 h-4 w-4" />
                  )}
                  {t('settings.memberSmtp.deleteButton')}
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                disabled={isBusy || !details?.configured}
                onClick={() => void handleTest()}
              >
                {busy === 'test' ? (
                  <RefreshCw className="me-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="me-2 h-4 w-4" />
                )}
                {t('settings.memberSmtp.testButton')}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">{t('settings.memberSmtp.testNote')}</p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

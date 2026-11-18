import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Server, Eye, EyeOff, CheckCircle2, AlertCircle, RefreshCw, Trash2, Send } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SmtpDetails } from '@/lib/api';
import type { SmtpForm } from '@/hooks/useEmailSettings';

interface SmtpConfigCardProps {
  details: SmtpDetails | null;
  form: SmtpForm;
  setForm: Dispatch<SetStateAction<SmtpForm>>;
  busy: 'save' | 'test' | 'report' | 'smtp_save' | 'smtp_delete' | null;
  onSave: (payload: SmtpForm) => Promise<void>;
  onDelete: () => Promise<void>;
  onTest: () => Promise<void>;
}

export function SmtpConfigCard({
  details,
  form,
  setForm,
  busy,
  onSave,
  onDelete,
  onTest,
}: SmtpConfigCardProps) {
  const { t, language } = useLanguage();
  const [showPassword, setShowPassword] = useState(false);
  const patch = (values: Partial<SmtpForm>) => setForm((curr) => ({ ...curr, ...values }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void onSave(form);
  };

  const isSaving = busy === 'smtp_save';
  const isDeleting = busy === 'smtp_delete';
  const isTesting = busy === 'test';
  const isBusy = busy !== null;

  return (
    <Card className="shadow-elegant">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            <span>{t('settings.email.smtpTitle')}</span>
          </CardTitle>
          <div>
            {details?.isCustom ? (
              <Badge variant="outline" className="border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                <CheckCircle2 className="me-1 h-3.5 w-3.5 text-emerald-600" />
                {t('settings.email.smtpCustomActive')}
              </Badge>
            ) : details?.configured ? (
              <Badge variant="outline" className="border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                <CheckCircle2 className="me-1 h-3.5 w-3.5 text-blue-600" />
                {t('settings.email.smtpPlatformDefault')}
              </Badge>
            ) : (
              <Badge variant="destructive">
                <AlertCircle className="me-1 h-3.5 w-3.5" />
                {t('settings.email.smtpNotConfigured')}
              </Badge>
            )}
          </div>
        </div>
        <CardDescription>
          {t('settings.email.smtpDescription')}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="smtp_host">{t('settings.email.smtpHostLabel')}</Label>
              <Input
                id="smtp_host"
                dir="ltr"
                required
                placeholder="smtp.gmail.com"
                value={form.host}
                onChange={(e) => patch({ host: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="smtp_port">{t('settings.email.smtpPortLabel')}</Label>
              <Input
                id="smtp_port"
                type="number"
                dir="ltr"
                min={1}
                max={65535}
                required
                placeholder="587"
                value={form.port}
                onChange={(e) => patch({ port: parseInt(e.target.value, 10) || 587 })}
              />
            </div>

            <div>
              <Label htmlFor="smtp_user">{t('settings.email.smtpUserLabel')}</Label>
              <Input
                id="smtp_user"
                dir="ltr"
                autoComplete="off"
                required
                placeholder="your-email@gmail.com"
                value={form.user}
                onChange={(e) => patch({ user: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="smtp_pass">{t('settings.email.smtpPassLabel')}</Label>
              <div className="relative">
                <Input
                  id="smtp_pass"
                  type={showPassword ? 'text' : 'password'}
                  // The browser must not fill the site login password into the SMTP app password.
                  autoComplete="new-password"
                  dir="ltr"
                  placeholder={details?.isCustom ? '••••••••••••••••' : ''}
                  value={form.pass}
                  onChange={(e) => patch({ pass: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 end-0 flex items-center pe-3 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="smtp_from">{t('settings.email.smtpFromLabel')}</Label>
              <Input
                id="smtp_from"
                dir="ltr"
                required
                placeholder="Company Name <notifications@company.com>"
                value={form.from}
                onChange={(e) => patch({ from: e.target.value })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="smtp_secure">{t('settings.email.smtpSecureLabel')}</Label>
              <p className="text-xs text-muted-foreground">
                {language === 'ar' ? 'فعّل هذا الخيار لمنفذ 465 (SSL)، وعطّله لمنفذ 587 (STARTTLS)' : 'Enable for port 465 (SSL), disable for port 587 (STARTTLS)'}
              </p>
            </div>
            <Switch
              id="smtp_secure"
              checked={form.secure}
              onCheckedChange={(secure) => patch({ secure })}
            />
          </div>

          <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
            {t('settings.email.smtpHelpGoogle')}
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="submit" disabled={isBusy} className="flex-1 min-w-[140px]">
              {isSaving ? (
                <>
                  <RefreshCw className="me-2 h-4 w-4 animate-spin" />
                  {language === 'ar' ? 'جارٍ الحفظ والتحقق...' : 'Saving...'}
                </>
              ) : (
                t('settings.email.smtpSaveButton')
              )}
            </Button>

            {details?.isCustom && (
              <Button
                type="button"
                variant="outline"
                disabled={isBusy}
                onClick={() => {
                  if (window.confirm(t('settings.email.smtpDeleteConfirm'))) {
                    void onDelete();
                  }
                }}
                className="text-destructive hover:bg-destructive/10"
              >
                {isDeleting ? (
                  <RefreshCw className="me-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="me-2 h-4 w-4" />
                )}
                {t('settings.email.smtpDeleteButton')}
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              disabled={isBusy || !details?.configured}
              onClick={() => void onTest()}
            >
              {isTesting ? (
                <RefreshCw className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="me-2 h-4 w-4" />
              )}
              {language === 'ar' ? 'اختبار الإرسال' : 'Test Email'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, Save, Send, UserCog } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { isOwner } from '@/lib/permissions';
import { notificationSender, type NotificationSenderMember } from '@/lib/api/memberSmtp';
import { smtpGuidance } from './smtpGuidance';

/** The value of the selection that means "no designated sender". */
const SENDER_NONE = 'none';

/**
 * The account that sends the scheduled reminders of the workspace.
 *
 * Naming an account says who sends the reminders; it changes no relay. When
 * the named account has a relay of its own that relay is used, otherwise the
 * relay of the workspace sends the reminders as before.
 *
 * The card is for workspace administrators only.
 */
export function NotificationSenderCard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();
  const admin = isOwner(user?.role);
  const [members, setMembers] = useState<NotificationSenderMember[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>(SENDER_NONE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await notificationSender.read();
    setLoading(false);
    if (error || !data) {
      // The message of the server is shown as it is; the card falls back to
      // its own copy when the server sent none.
      setLoadError(error?.message ?? '');
      return;
    }
    setLoadError(null);
    setMembers(data.members);
    setCurrentId(data.accountId);
    setSelectedId(data.accountId ?? SENDER_NONE);
  }, []);

  useEffect(() => {
    if (!admin) {
      setLoading(false);
      return;
    }
    void load();
  }, [admin, load]);

  const save = async (accountId: string | null) => {
    setBusy(true);
    const { data, error } = await notificationSender.save(accountId);
    setBusy(false);
    if (error || !data) {
      toast({
        title: t('settings.notificationSender.failedTitle'),
        description: error?.message ?? '',
        variant: 'destructive',
      });
      return;
    }
    setCurrentId(data.accountId);
    setSelectedId(data.accountId ?? SENDER_NONE);
    toast({
      title: accountId
        ? t('settings.notificationSender.savedTitle')
        : t('settings.notificationSender.clearedTitle'),
    });
  };

  if (!admin) return null;

  const guidance = smtpGuidance(t);
  const current = members.find((member) => member.accountId === currentId) ?? null;

  return (
    <Card className="shadow-elegant">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            <span>{t('settings.notificationSender.title')}</span>
          </CardTitle>
          <div>
            {current ? (
              <Badge variant="outline" className="border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                <CheckCircle2 className="me-1 h-3.5 w-3.5 text-emerald-600" />
                {t('settings.notificationSender.chosenBadge')}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                <UserCog className="me-1 h-3.5 w-3.5 text-blue-600" />
                {t('settings.notificationSender.noneBadge')}
              </Badge>
            )}
          </div>
        </div>
        <CardDescription>{t('settings.notificationSender.description')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('settings.notificationSender.loading')}
          </p>
        ) : loadError ? (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-destructive">{loadError || t('settings.notificationSender.loadFailed')}</p>
            <Button type="button" variant="outline" onClick={() => void load()}>
              {t('settings.notificationSender.retry')}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {current
                ? t('settings.notificationSender.currentLabel', { name: current.displayName })
                : t('settings.notificationSender.currentNone')}
            </p>

            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('settings.notificationSender.noMembers')}</p>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="notification_sender">{t('settings.notificationSender.label')}</Label>
                <Select value={selectedId} onValueChange={setSelectedId} disabled={busy}>
                  <SelectTrigger id="notification_sender">
                    <SelectValue placeholder={t('settings.notificationSender.noneOption')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SENDER_NONE}>{t('settings.notificationSender.noneOption')}</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.accountId} value={member.accountId}>
                        {member.displayName} — {member.email}
                        {member.hasCompleteSmtp ? ` (${t('settings.notificationSender.hasOwnServer')})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t('settings.notificationSender.selectHelp')}</p>
              </div>
            )}

            <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium">{guidance.title}</p>
              <ul className="space-y-1">
                {guidance.lines.map((line) => (
                  <li key={line}>• {line}</li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy || members.length === 0}
                onClick={() => void save(selectedId === SENDER_NONE ? null : selectedId)}
              >
                {busy ? (
                  <>
                    <RefreshCw className="me-2 h-4 w-4 animate-spin" />
                    {t('settings.notificationSender.saving')}
                  </>
                ) : (
                  <>
                    <Save className="me-2 h-4 w-4" />
                    {t('settings.notificationSender.saveButton')}
                  </>
                )}
              </Button>

              {current && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void save(null)}
                >
                  {t('settings.notificationSender.clearButton')}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

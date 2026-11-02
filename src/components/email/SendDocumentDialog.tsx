import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { endpoints, missingAttachments } from '@/lib/api';
import type { DocumentWithRelations } from '@/lib/api/types';

/**
 * Sends one or many documents by email.
 *
 * The dialog works for a single document and for a bulk selection. The files are
 * attached by the server, so the attachment size is checked here before the
 * request is made — the browser knows the sizes, the server knows the truth.
 */

const MAX_ATTACHMENT_MB = 20;

interface SendDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documents: DocumentWithRelations[];
  onSent?: () => void;
}

function splitAddresses(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SendDocumentDialog({
  open,
  onOpenChange,
  documents,
  onSent,
}: SendDocumentDialogProps) {
  const { t, isRTL } = useLanguage();
  const { toast } = useToast();

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Falls back to the built-in copy when a translation key is missing. */
  const label = (key: string, ar: string, en: string): string => {
    const value = t(key);
    return value === key ? (isRTL ? ar : en) : value;
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubject((current) => current || label('email.sendDialog.defaultSubject', 'مستندات من روماني فلو', 'Documents from ROMANI Flow'));
  }, [open, isRTL]);

  const recipients = useMemo(() => splitAddresses(to), [to]);
  const ccRecipients = useMemo(() => splitAddresses(cc), [cc]);
  const bccRecipients = useMemo(() => splitAddresses(bcc), [bcc]);

  const totalBytes = useMemo(
    () => documents.reduce((sum, document) => sum + Number(document.file_size ?? 0), 0),
    [documents],
  );

  const missingFiles = useMemo(
    () => documents.filter((document) => !document.file_path).map((document) => document.title),
    [documents],
  );

  const overLimit = totalBytes > MAX_ATTACHMENT_MB * 1024 * 1024;
  const canSend = recipients.length > 0 && documents.length > 0 && !overLimit && !isSending;

  const handleSend = async () => {
    if (!canSend) return;

    setIsSending(true);
    setError(null);

    const { data, error: sendError } = await endpoints.email.sendDocuments({
      document_ids: documents.map((document) => document.id),
      to: recipients,
      cc: ccRecipients.length > 0 ? ccRecipients : undefined,
      bcc: bccRecipients.length > 0 ? bccRecipients : undefined,
      subject: subject.trim() || undefined,
      message: message.trim() || undefined,
    });

    setIsSending(false);

    if (sendError || !data?.sent) {
      // The server refuses the whole batch when a document has no stored file,
      // and names them in the error payload.
      const refused = missingAttachments(sendError);
      const reason =
        refused.length > 0
          ? refused.map((entry) => entry.title).join('، ')
          : (sendError?.message ?? data?.rejected?.join(', ') ?? 'unknown_error');

      setError(reason);
      toast({
        title: label('email.sendDialog.failed', 'تعذر إرسال المستندات', 'The documents could not be sent'),
        description: reason,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: label('email.sendDialog.sent', 'تم إرسال المستندات', 'Documents sent'),
      description: label(
        'email.sendDialog.sentDescription',
        `تم الإرسال إلى ${data.recipients.length} مستلم مع ${data.attachments} مرفق.`,
        `Sent to ${data.recipients.length} recipients with ${data.attachments} attachment(s).`,
      ),
    });

    setTo('');
    setCc('');
    setBcc('');
    setSubject('');
    setMessage('');
    onOpenChange(false);
    onSent?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" dir={isRTL ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle>
            {label('email.sendDialog.title', 'إرسال مستندات بالبريد', 'Send documents by email')}
          </DialogTitle>
          <DialogDescription>
            {label(
              'email.sendDialog.description',
              'اختر المستلمين وأرفق المستندات المحددة في رسالة واحدة.',
              'Choose the recipients and attach the selected documents in a single message.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {missingFiles.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                {label(
                  'email.sendDialog.missingFiles',
                  `بعض المستندات ليس لها ملف مرفوع: ${missingFiles.join('، ')}`,
                  `Some documents have no uploaded file: ${missingFiles.join(', ')}`,
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="send-to">
              {label('email.sendDialog.to', 'المستلمون', 'Recipients')}
            </Label>
            <Input
              id="send-to"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="name@example.com, another@example.com"
              dir="ltr"
            />
            {recipients.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {recipients.map((recipient) => (
                  <Badge key={recipient} variant="secondary" dir="ltr">
                    {recipient}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="send-cc">{label('email.sendDialog.cc', 'نسخة إلى', 'Cc')}</Label>
              <Input id="send-cc" value={cc} onChange={(event) => setCc(event.target.value)} dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="send-bcc">{label('email.sendDialog.bcc', 'نسخة مخفية', 'Bcc')}</Label>
              <Input
                id="send-bcc"
                value={bcc}
                onChange={(event) => setBcc(event.target.value)}
                dir="ltr"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="send-subject">
              {label('email.sendDialog.subject', 'الموضوع', 'Subject')}
            </Label>
            <Input
              id="send-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              dir="ltr"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="send-message">
              {label('email.sendDialog.message', 'نص الرسالة', 'Message')}
            </Label>
            <Textarea
              id="send-message"
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-medium">
              {label('email.sendDialog.attachments', 'المرفقات', 'Attachments')} ({documents.length})
            </div>
            <ul className="max-h-32 space-y-1 overflow-auto text-sm text-muted-foreground">
              {documents.map((document) => (
                <li key={document.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{document.title}</span>
                  <span className="shrink-0">{formatSize(Number(document.file_size ?? 0))}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 text-sm">
              {label('email.sendDialog.totalSize', 'الحجم الإجمالي', 'Total size')}:{' '}
              <span className={overLimit ? 'font-semibold text-destructive' : ''}>
                {formatSize(totalBytes)} / {MAX_ATTACHMENT_MB} MB
              </span>
            </div>
          </div>

          {overLimit && (
            <Alert variant="destructive">
              <AlertDescription>
                {label(
                  'email.sendDialog.tooLarge',
                  'حجم المرفقات يتجاوز الحد المسموح. اختر عدداً أقل من المستندات.',
                  'The attachments exceed the allowed size. Select fewer documents.',
                )}
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
            {label('email.sendDialog.cancel', 'إلغاء', 'Cancel')}
          </Button>
          <Button onClick={handleSend} disabled={!canSend}>
            {isSending
              ? label('email.sendDialog.sending', 'جارٍ الإرسال…', 'Sending…')
              : label('email.sendDialog.send', 'إرسال', 'Send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SendDocumentDialog;

/**
 * A button that opens the dialog for a given set of documents.
 *
 * It is used both for the single row action and for the bulk action bar, so
 * both paths share the same behaviour and the same validation.
 */
interface DocumentEmailButtonProps {
  documents: DocumentWithRelations[];
  label?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  onSent?: () => void;
}

export function DocumentEmailButton({
  documents,
  label,
  variant = 'outline',
  size = 'sm',
  onSent,
}: DocumentEmailButtonProps) {
  const [open, setOpen] = useState(false);

  if (documents.length === 0) return null;

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        {label ?? `Email${documents.length > 1 ? ` (${documents.length})` : ''}`}
      </Button>
      <SendDocumentDialog
        open={open}
        onOpenChange={setOpen}
        documents={documents}
        onSent={onSent}
      />
    </>
  );
}

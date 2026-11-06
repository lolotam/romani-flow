import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import type { DraftStatus } from '@/lib/documentDraftSession';

export function DocumentDraftStatus({ status, restored, needsFile, onDiscard }: {
  status: DraftStatus; restored: boolean; needsFile: boolean; onDiscard: () => void;
}) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const copy: Record<DraftStatus, string> = ar
    ? { loading: 'جارٍ تحميل المسودة…', saved: 'المسودة محفوظة على حسابك', saving: 'جارٍ حفظ المسودة…', discarding: 'جارٍ تجاهل المسودة…', failed: 'تعذّر حفظ المسودة. أعد فتح الفورم قبل المتابعة.', conflict: 'فيه مسودة أحدث على جهاز تاني. أعد فتح الفورم قبل المتابعة.' }
    : { loading: 'Loading draft…', saved: 'Draft saved to your account', saving: 'Saving draft…', discarding: 'Discarding draft…', failed: 'Draft unavailable. Reopen this form before continuing.', conflict: 'A newer draft exists on another device. Reopen this form before continuing.' };
  return <div className="space-y-2 rounded border p-3 text-sm">
    <p role={status === 'failed' || status === 'conflict' ? 'alert' : 'status'}>{copy[status]}</p>
    {restored && needsFile && <p>{ar ? 'المسودة بتحفظ الحقول فقط. اختار ملف الوثيقة مرة تانية.' : 'Drafts keep fields only. Select the document file again.'}</p>}
    <Button type="button" variant="outline" disabled={status !== 'saved'} onClick={onDiscard}>{ar ? 'تجاهل المسودة وابدأ من جديد' : 'Discard draft and start again'}</Button>
  </div>;
}

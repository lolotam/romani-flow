import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { endpoints } from '@/lib/api';
import type { DocumentFormProps } from './documentFormSchema';
import { createDocumentPreview } from '@/lib/documentPreview';

type Props = Pick<DocumentFormProps, 'uploadedFile' | 'editingDocument'>;

export function DocumentAttachment({ uploadedFile, editingDocument }: Props) {
  const { t, language } = useLanguage();
  const ar = language === 'ar';
  const [local, setLocal] = useState<{ file: File; url: string } | null>(null);
  const localType = uploadedFile?.type;
  const allowed = localType === 'application/pdf' || localType === 'image/png' || localType === 'image/jpeg';
  useEffect(() => {
    if (!uploadedFile || !allowed) return;
    const preview = createDocumentPreview(uploadedFile);
    if (!preview) return;
    setLocal(preview);
    return preview.release;
  }, [uploadedFile, allowed]);
  const source = uploadedFile ? (local?.file === uploadedFile && allowed ? local.url : null)
    : editingDocument?.file_path ? endpoints.files.previewUrl(editingDocument.id) : null;
  const name = uploadedFile?.name ?? editingDocument?.file_name ?? '';
  const type = uploadedFile ? uploadedFile.type : editingDocument?.mime_type ?? (/\.pdf$/i.test(name) ? 'application/pdf' : /\.(png|jpe?g|gif|webp)$/i.test(name) ? 'image/jpeg' : '');
  return <section className="space-y-3 rounded-lg border bg-muted/20 p-3 lg:sticky lg:top-4" aria-label={t('documents.actions.preview')}>
    {/* File Upload Info */}
    <div className="flex items-center gap-2"><FileText className="h-5 w-5 shrink-0" /><span className="break-all text-sm">{name || (ar ? '?? ??? ?????? ???' : 'No file selected')}</span></div>
    {source && type.startsWith('image/') ? <img src={source} alt={t('documents.actions.preview')} className="max-h-[65vh] w-full rounded border object-contain" />
      : source && type === 'application/pdf' ? <iframe src={source} title={t('documents.actions.preview') + ': ' + name} className="h-[55vh] min-h-72 w-full rounded border" />
      : <p className="text-sm text-muted-foreground">{ar ? '????? ??? PDF ?? ???? ???? ???????? ????? ??? ????????.' : 'Select a PDF or image to preview while filling the fields.'}</p>}
    {source && <a href={source} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-primary underline">{ar ? '??? ????? ?? ????? ???? ?? ???????? ??? ?????' : 'Open file in a new tab if preview is unavailable'}</a>}
  </section>;
}

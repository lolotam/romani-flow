import { useRef, useState } from 'react';
import { api, endpoints, type DocumentWithRelations } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';

export function useDocumentActions(removeDocuments: (ids: string[]) => void, deleteConfirmation?: string) {
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const deleting = useRef(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteDocuments = async (ids: string[]) => {
    if (deleting.current || ids.length === 0) return;
    const message = ids.length === 1
      ? deleteConfirmation ?? t('documents.messages.deleteConfirm')
      : t('documents.bulk.deleteConfirm', { count: ids.length });
    if (!window.confirm(message)) return;

    deleting.current = true;
    setIsDeleting(true);
    const deleted: string[] = [];
    const failures: string[] = [];
    try {
      for (const id of ids) {
        const { error } = await api.delete('documents', id);
        if (error) failures.push(error.message);
        else deleted.push(id);
      }
    } catch (cause) {
      failures.push(cause instanceof Error ? cause.message : String(cause));
    } finally {
      // Refresh documents list and employees (to update document counts).
      // Successful deletions remain removed even if another deletion fails.
      if (deleted.length > 0) removeDocuments(deleted);
      deleting.current = false;
      setIsDeleting(false);
    }

    toast({
      title: t(failures.length ? 'documents.messages.error' : 'documents.messages.success'),
      description: failures.length
        ? `${t('documents.bulk.deleteSuccess', { count: deleted.length })}. ${t('documents.bulk.deleteError')}: ${failures[0]}`
        : t('documents.bulk.deleteSuccess', { count: deleted.length }),
      variant: failures.length ? 'destructive' : 'default',
    });
  };

  const downloadDocument = async (doc: DocumentWithRelations) => {
    if (!doc.file_path) {
      toast({ title: t('documents.messages.error'), description: t('documents.messages.noFileError'), variant: 'destructive' });
      return;
    }
    let downloadUrl: string | undefined;
    try {
      const response = await fetch(endpoints.files.downloadUrl(doc.id), { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Request failed (${response.status}).`);
      downloadUrl = URL.createObjectURL(await response.blob());

      // Create download link.
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = doc.file_name || 'document';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (cause) {
      toast({
        title: t('documents.messages.error'),
        description: `${t('documents.messages.downloadError')}: ${cause instanceof Error ? cause.message : String(cause)}`,
        variant: 'destructive',
      });
    } finally {
      // Clean up blob URL if created, after the browser has started the download.
      if (downloadUrl) {
        const url = downloadUrl;
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    }
  };

  return {
    isDeleting, deleteDocuments, downloadDocument,
    emailLabel: language === 'ar' ? 'إرسال بالبريد الإلكتروني' : 'Send by email',
  };
}

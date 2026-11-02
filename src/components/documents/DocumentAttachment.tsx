import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { endpoints } from '@/lib/api';
import type { DocumentFormProps } from './documentFormSchema';

type Props = Pick<DocumentFormProps, 'uploadedFile' | 'editingDocument'>;

export function DocumentAttachment({ uploadedFile, editingDocument }: Props) {
  const { t } = useLanguage();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!uploadedFile?.type.startsWith('image/')) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(uploadedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [uploadedFile]);

  return (
    <>
      {/* File Upload Info */}
      {(uploadedFile || editingDocument) && (
        <div className="p-4 bg-primary/5 rounded-lg border">
          <div className="flex items-center space-x-3">
            <FileText className="h-8 w-8 text-primary ml-2" />
            <div className="flex-1">
              <h3 className="font-medium text-sm">
                {editingDocument ? t('documents.form.file') : t('documents.form.file')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {uploadedFile ? uploadedFile.name : editingDocument?.file_name}
              </p>
              {uploadedFile && (
                <p className="text-xs text-muted-foreground">
                  {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              )}
            </div>
            {uploadedFile && uploadedFile.type.startsWith('image/') && (
              <img
                src={previewUrl || undefined}
                alt={t('documents.actions.preview')}
                className="h-12 w-12 object-cover rounded border"
              />
            )}
            {!uploadedFile && editingDocument?.file_path && /\.(png|jpe?g|gif|webp)$/i.test(editingDocument.file_name || '') && (
              <img
                src={endpoints.files.previewUrl(editingDocument.id)}
                alt={t('documents.actions.preview')}
                className="h-12 w-12 object-cover rounded border"
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
